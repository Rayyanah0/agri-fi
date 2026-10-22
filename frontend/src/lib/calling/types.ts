export type CallMedia = 'audio' | 'video';
export type CallStatus = 'idle' | 'ringing' | 'calling' | 'connecting' | 'connected' | 'ended' | 'failed';
export type CallOutcome = 'completed' | 'missed' | 'declined' | 'failed' | 'cancelled';

export interface Participant {
  userId: string;
  name: string;
  role?: string;
}

export interface QualitySample {
  at: number;
  rttMs: number | null;
  jitterMs: number | null;
  packetLossPct: number | null;
  bitrateKbps: number | null;
}

export type QualityRating = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown';

export interface CallRecord {
  id: string;
  media: CallMedia;
  direction: 'incoming' | 'outgoing';
  participants: Participant[];
  dealId?: string;
  startedAt: string;
  connectedAt?: string;
  endedAt?: string;
  durationSec: number;
  outcome: CallOutcome;
  recorded: boolean;
  avgQuality: QualityRating;
  notes?: string;
}

export interface ScheduledCall {
  id: string;
  title: string;
  media: CallMedia;
  participants: Participant[];
  dealId?: string;
  scheduledFor: string;
  durationMin: number;
  reminderSent?: boolean;
}

/** Signaling messages relayed by the backend `/calls` WebSocket namespace. */
export interface SignalEnvelope {
  callId: string;
  from: Participant;
  to: string;
}
export interface InviteSignal extends SignalEnvelope {
  media: CallMedia;
  dealId?: string;
  /** SHA-256 fingerprint of the caller's DTLS certificate, for participant verification. */
  fingerprint?: string;
}
export interface SdpSignal extends SignalEnvelope {
  sdp: RTCSessionDescriptionInit;
}
export interface IceSignal extends SignalEnvelope {
  candidate: RTCIceCandidateInit;
}
export interface RecordingConsentSignal extends SignalEnvelope {
  requested?: boolean;
  granted?: boolean;
}
