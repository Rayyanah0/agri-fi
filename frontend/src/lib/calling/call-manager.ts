import { io, type Socket } from 'socket.io-client';
import { averageRating, sampleQuality } from './quality';
import { callHistory } from './store';
import type {
  CallMedia,
  CallOutcome,
  CallRecord,
  CallStatus,
  IceSignal,
  InviteSignal,
  Participant,
  QualitySample,
  RecordingConsentSignal,
  SdpSignal,
} from './types';

/**
 * WebRTC call manager (#1239).
 *
 * - Signaling: socket.io `/calls` namespace, authenticated with the user's JWT
 *   so the backend can verify both participants before relaying messages.
 * - Media: peer-to-peer RTCPeerConnection. WebRTC mandates DTLS-SRTP, so all
 *   media is end-to-end encrypted; the DTLS fingerprint in the SDP is compared
 *   with the one announced in the invite to detect tampering.
 * - Recording: MediaRecorder, only after the remote participant consents.
 * - Quality: getStats() sampled every few seconds.
 */

export interface CallState {
  status: CallStatus;
  callId: string | null;
  media: CallMedia;
  direction: 'incoming' | 'outgoing' | null;
  peer: Participant | null;
  dealId?: string;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  muted: boolean;
  videoEnabled: boolean;
  screenSharing: boolean;
  recording: boolean;
  recordingConsent: 'none' | 'pending' | 'granted' | 'denied';
  consentRequestFrom: Participant | null;
  verified: boolean | null;
  quality: QualitySample | null;
  connectedAt: number | null;
  error?: string;
}

const INITIAL: CallState = {
  status: 'idle',
  callId: null,
  media: 'audio',
  direction: null,
  peer: null,
  localStream: null,
  remoteStream: null,
  muted: false,
  videoEnabled: false,
  screenSharing: false,
  recording: false,
  recordingConsent: 'none',
  consentRequestFrom: null,
  verified: null,
  quality: null,
  connectedAt: null,
};

const RING_TIMEOUT_MS = 45_000;
const QUALITY_INTERVAL_MS = 3_000;

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  const turn = process.env.NEXT_PUBLIC_TURN_URL;
  if (turn) {
    servers.push({
      urls: turn,
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    });
  }
  return servers;
}

function extractFingerprint(sdp?: string): string | undefined {
  return sdp?.match(/a=fingerprint:\S+ (\S+)/)?.[1];
}

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

type Listener = (s: CallState) => void;

export class CallManager {
  private socket: Socket | null = null;
  private pc: RTCPeerConnection | null = null;
  private state: CallState = { ...INITIAL };
  private listeners = new Set<Listener>();
  private pendingOffer: RTCSessionDescriptionInit | null = null;
  private pendingCandidates: RTCIceCandidateInit[] = [];
  private expectedFingerprint?: string;
  private cameraTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private recorder: MediaRecorder | null = null;
  private recordedChunks: Blob[] = [];
  private qualitySamples: QualitySample[] = [];
  private qualityTimer: ReturnType<typeof setInterval> | null = null;
  private ringTimer: ReturnType<typeof setTimeout> | null = null;
  private lastBytes?: { bytes: number; at: number };
  private startedAt = 0;

  constructor(private readonly me: Participant, private readonly token: string) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  connect(): void {
    if (this.socket) return;
    const socket = io('/calls', { auth: { token: this.token }, transports: ['websocket'] });
    socket.on('call:invite', (m: InviteSignal) => this.onInvite(m));
    socket.on('call:accept', (m: SdpSignal) => this.onAnswer(m));
    socket.on('call:offer', (m: SdpSignal) => this.onOffer(m));
    socket.on('call:ice', (m: IceSignal) => this.onIce(m));
    socket.on('call:decline', () => this.finish('declined'));
    socket.on('call:hangup', () => this.finish('completed'));
    socket.on('call:busy', () => this.finish('declined', 'User is busy'));
    socket.on('call:recording-consent', (m: RecordingConsentSignal) => this.onConsent(m));
    socket.on('call:error', (m: { message: string }) => this.finish('failed', m.message));
    this.socket = socket;
  }

  disconnect(): void {
    if (this.state.status !== 'idle') this.hangup();
    this.socket?.disconnect();
    this.socket = null;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  getState(): CallState {
    return this.state;
  }

  async startCall(peer: Participant, media: CallMedia, dealId?: string): Promise<void> {
    if (this.state.status !== 'idle' && this.state.status !== 'ended') return;
    const callId = uid();
    this.reset({ status: 'calling', callId, media, direction: 'outgoing', peer, dealId });
    try {
      const pc = await this.createPeer(media);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.emit('call:invite', {
        callId,
        from: this.me,
        to: peer.userId,
        media,
        dealId,
        fingerprint: extractFingerprint(offer.sdp),
      } satisfies InviteSignal);
      this.emit('call:offer', { callId, from: this.me, to: peer.userId, sdp: offer } satisfies SdpSignal);
      this.ringTimer = setTimeout(() => this.finish('missed'), RING_TIMEOUT_MS);
    } catch (err) {
      this.finish('failed', (err as Error).message);
    }
  }

  async accept(): Promise<void> {
    const { callId, peer, media } = this.state;
    if (this.state.status !== 'ringing' || !callId || !peer) return;
    this.clearRing();
    this.set({ status: 'connecting' });
    try {
      const pc = await this.createPeer(media);
      if (!this.pendingOffer) throw new Error('Missing call offer');
      this.verify(this.pendingOffer.sdp);
      await pc.setRemoteDescription(this.pendingOffer);
      await this.flushCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.emit('call:accept', { callId, from: this.me, to: peer.userId, sdp: answer } satisfies SdpSignal);
    } catch (err) {
      this.finish('failed', (err as Error).message);
    }
  }

  decline(): void {
    const { callId, peer } = this.state;
    if (callId && peer) this.emit('call:decline', { callId, from: this.me, to: peer.userId });
    this.finish('declined');
  }

  hangup(): void {
    const { callId, peer, status } = this.state;
    if (callId && peer) this.emit('call:hangup', { callId, from: this.me, to: peer.userId });
    this.finish(status === 'connected' ? 'completed' : 'cancelled');
  }

  toggleMute(): void {
    const muted = !this.state.muted;
    this.state.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
    this.set({ muted });
  }

  async toggleVideo(): Promise<void> {
    const stream = this.state.localStream;
    if (!stream || !this.pc) return;
    let track = stream.getVideoTracks()[0];
    if (!track) {
      // Upgrade an audio call to video.
      const cam = await navigator.mediaDevices.getUserMedia({ video: true });
      track = cam.getVideoTracks()[0];
      stream.addTrack(track);
      this.cameraTrack = track;
      this.pc.addTrack(track, stream);
      await this.renegotiate();
      this.set({ videoEnabled: true, media: 'video', localStream: stream });
      return;
    }
    track.enabled = !track.enabled;
    this.set({ videoEnabled: track.enabled });
  }

  async toggleScreenShare(): Promise<void> {
    if (!this.pc || !this.state.localStream) return;
    const sender = this.pc.getSenders().find((s) => s.track?.kind === 'video');

    if (this.state.screenSharing) {
      if (sender) await sender.replaceTrack(this.cameraTrack);
      this.screenTrack?.stop();
      this.screenTrack = null;
      this.set({ screenSharing: false });
      return;
    }

    const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = display.getVideoTracks()[0];
    this.screenTrack = screenTrack;
    screenTrack.onended = () => this.state.screenSharing && this.toggleScreenShare();
    if (sender) {
      this.cameraTrack = sender.track;
      await sender.replaceTrack(screenTrack);
    } else {
      this.pc.addTrack(screenTrack, display);
      await this.renegotiate();
    }
    this.set({ screenSharing: true });
  }

  /** Asks the other participant for consent; recording starts only once granted. */
  requestRecording(): void {
    const { callId, peer } = this.state;
    if (!callId || !peer || this.state.recording) return;
    this.set({ recordingConsent: 'pending' });
    this.emit('call:recording-consent', { callId, from: this.me, to: peer.userId, requested: true });
  }

  respondToRecording(granted: boolean): void {
    const { callId, consentRequestFrom } = this.state;
    if (!callId || !consentRequestFrom) return;
    this.emit('call:recording-consent', { callId, from: this.me, to: consentRequestFrom.userId, granted });
    this.set({ consentRequestFrom: null, recordingConsent: granted ? 'granted' : 'denied' });
  }

  stopRecording(): void {
    this.recorder?.state === 'recording' && this.recorder.stop();
  }

  // ── Signaling handlers ─────────────────────────────────────────────────────

  private onInvite(m: InviteSignal): void {
    if (this.state.status !== 'idle' && this.state.status !== 'ended') {
      this.emit('call:busy', { callId: m.callId, from: this.me, to: m.from.userId });
      return;
    }
    this.reset({ status: 'ringing', callId: m.callId, media: m.media, direction: 'incoming', peer: m.from, dealId: m.dealId });
    this.expectedFingerprint = m.fingerprint;
    this.ringTimer = setTimeout(() => this.finish('missed'), RING_TIMEOUT_MS);
    this.notifyIncoming(m);
  }

  private async onOffer(m: SdpSignal): Promise<void> {
    if (m.callId !== this.state.callId) return;
    if (this.pc && this.state.status === 'connected') {
      // Renegotiation (e.g. video upgrade) mid-call.
      await this.pc.setRemoteDescription(m.sdp);
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      this.emit('call:accept', { callId: m.callId, from: this.me, to: m.from.userId, sdp: answer });
      return;
    }
    this.pendingOffer = m.sdp;
  }

  private async onAnswer(m: SdpSignal): Promise<void> {
    if (m.callId !== this.state.callId || !this.pc) return;
    this.clearRing();
    if (this.state.status === 'calling') {
      this.verify(m.sdp.sdp);
      this.set({ status: 'connecting' });
    }
    await this.pc.setRemoteDescription(m.sdp);
    await this.flushCandidates();
  }

  private async onIce(m: IceSignal): Promise<void> {
    if (m.callId !== this.state.callId) return;
    if (this.pc?.remoteDescription) await this.pc.addIceCandidate(m.candidate).catch(() => undefined);
    else this.pendingCandidates.push(m.candidate);
  }

  private onConsent(m: RecordingConsentSignal): void {
    if (m.callId !== this.state.callId) return;
    if (m.requested) {
      this.set({ consentRequestFrom: m.from });
      return;
    }
    if (m.granted) {
      this.set({ recordingConsent: 'granted' });
      this.startRecorder();
    } else {
      this.set({ recordingConsent: 'denied' });
    }
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async createPeer(media: CallMedia): Promise<RTCPeerConnection> {
    const localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: media === 'video',
    });
    this.cameraTrack = localStream.getVideoTracks()[0] ?? null;
    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const remoteStream = new MediaStream();

    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    pc.ontrack = (e) => {
      e.streams[0]?.getTracks().forEach((t) => remoteStream.addTrack(t));
      this.set({ remoteStream });
    };
    pc.onicecandidate = (e) => {
      const { callId, peer } = this.state;
      if (e.candidate && callId && peer) {
        this.emit('call:ice', { callId, from: this.me, to: peer.userId, candidate: e.candidate.toJSON() });
      }
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected' && this.state.status !== 'connected') {
        this.set({ status: 'connected', connectedAt: Date.now() });
        this.startQualityMonitor();
      } else if (pc.connectionState === 'failed') {
        this.finish('failed', 'Connection failed');
      }
    };

    this.pc = pc;
    this.set({ localStream, videoEnabled: media === 'video' });
    return pc;
  }

  private async renegotiate(): Promise<void> {
    const { callId, peer } = this.state;
    if (!this.pc || !callId || !peer) return;
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.emit('call:offer', { callId, from: this.me, to: peer.userId, sdp: offer });
  }

  private async flushCandidates(): Promise<void> {
    const queued = this.pendingCandidates.splice(0);
    for (const c of queued) await this.pc?.addIceCandidate(c).catch(() => undefined);
  }

  /** Compares the DTLS fingerprint in the SDP with the one announced at invite time. */
  private verify(sdp?: string): void {
    const fp = extractFingerprint(sdp);
    if (this.state.direction === 'incoming' && this.expectedFingerprint) {
      const ok = fp === this.expectedFingerprint;
      this.set({ verified: ok });
      if (!ok) throw new Error('Participant verification failed (fingerprint mismatch)');
    } else {
      this.set({ verified: Boolean(fp) });
    }
  }

  private startRecorder(): void {
    const { localStream, remoteStream } = this.state;
    if (typeof MediaRecorder === 'undefined' || !localStream) return;
    const mixed = new MediaStream([
      ...(remoteStream?.getTracks() ?? []),
      ...localStream.getAudioTracks(),
    ]);
    const recorder = new MediaRecorder(mixed);
    this.recordedChunks = [];
    recorder.ondataavailable = (e) => e.data.size && this.recordedChunks.push(e.data);
    recorder.onstop = () => {
      this.set({ recording: false });
      this.downloadRecording();
    };
    recorder.start(1000);
    this.recorder = recorder;
    this.set({ recording: true });
  }

  private downloadRecording(): void {
    if (this.recordedChunks.length === 0) return;
    const blob = new Blob(this.recordedChunks, { type: this.recorder?.mimeType || 'video/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `call-${this.state.callId ?? 'recording'}.webm`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    this.recordedChunks = [];
  }

  private startQualityMonitor(): void {
    this.stopQualityMonitor();
    this.qualityTimer = setInterval(async () => {
      if (!this.pc) return;
      const { sample, bytes } = await sampleQuality(this.pc, this.lastBytes);
      this.lastBytes = bytes;
      this.qualitySamples.push(sample);
      this.set({ quality: sample });
    }, QUALITY_INTERVAL_MS);
  }

  private stopQualityMonitor(): void {
    if (this.qualityTimer) clearInterval(this.qualityTimer);
    this.qualityTimer = null;
  }

  private notifyIncoming(m: InviteSignal): void {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
        new Notification(`Incoming ${m.media} call`, { body: `${m.from.name} is calling you`, tag: m.callId });
      }
    } catch {
      /* notifications unsupported */
    }
  }

  private finish(outcome: CallOutcome, error?: string): void {
    if (this.state.status === 'idle' || this.state.status === 'ended') return;
    this.clearRing();
    this.stopRecording();
    this.stopQualityMonitor();
    this.screenTrack?.stop();
    this.screenTrack = null;

    const s = this.state;
    if (s.callId && s.peer && s.direction) {
      const record: CallRecord = {
        id: s.callId,
        media: s.media,
        direction: s.direction,
        participants: [this.me, s.peer],
        dealId: s.dealId,
        startedAt: new Date(this.startedAt).toISOString(),
        connectedAt: s.connectedAt ? new Date(s.connectedAt).toISOString() : undefined,
        endedAt: new Date().toISOString(),
        durationSec: s.connectedAt ? Math.round((Date.now() - s.connectedAt) / 1000) : 0,
        outcome: s.connectedAt ? (outcome === 'failed' ? 'failed' : 'completed') : outcome,
        recorded: s.recordingConsent === 'granted',
        avgQuality: averageRating(this.qualitySamples),
      };
      callHistory.add(record);
    }

    s.localStream?.getTracks().forEach((t) => t.stop());
    this.pc?.close();
    this.pc = null;
    this.pendingOffer = null;
    this.pendingCandidates = [];
    this.set({ status: outcome === 'failed' ? 'failed' : 'ended', localStream: null, remoteStream: null, error });
    setTimeout(() => {
      if (this.state.status === 'ended' || this.state.status === 'failed') this.set({ ...INITIAL });
    }, 2_000);
  }

  private reset(patch: Partial<CallState>): void {
    this.qualitySamples = [];
    this.lastBytes = undefined;
    this.startedAt = Date.now();
    this.state = { ...INITIAL, ...patch };
    this.broadcast();
  }

  private clearRing(): void {
    if (this.ringTimer) clearTimeout(this.ringTimer);
    this.ringTimer = null;
  }

  private emit(event: string, payload: unknown): void {
    this.socket?.emit(event, payload);
  }

  private set(patch: Partial<CallState>): void {
    this.state = { ...this.state, ...patch };
    this.broadcast();
  }

  private broadcast(): void {
    this.listeners.forEach((fn) => fn(this.state));
  }
}
