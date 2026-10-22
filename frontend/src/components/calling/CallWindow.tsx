'use client';

import { useEffect, useRef, useState } from 'react';
import type { CallManager, CallState } from '@/lib/calling/call-manager';
import { rateQuality } from '@/lib/calling/quality';

const QUALITY_COLORS = {
  excellent: 'bg-green-500',
  good: 'bg-lime-500',
  fair: 'bg-yellow-500',
  poor: 'bg-red-500',
  unknown: 'bg-slate-400',
};

function useStream(ref: React.RefObject<HTMLVideoElement | HTMLAudioElement>, stream: MediaStream | null) {
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [ref, stream]);
}

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function CallWindow({ manager, state }: { manager: CallManager; state: CallState }) {
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const [now, setNow] = useState(Date.now());
  useStream(localRef, state.localStream);
  useStream(remoteRef, state.remoteStream);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const rating = rateQuality(state.quality);
  const showVideo = state.media === 'video' || state.screenSharing;
  const statusText =
    state.status === 'connected' && state.connectedAt
      ? formatDuration(now - state.connectedAt)
      : state.status === 'failed'
        ? state.error ?? 'Call failed'
        : state.status === 'ended'
          ? 'Call ended'
          : state.status === 'calling'
            ? 'Ringing…'
            : 'Connecting…';

  return (
    <div role="dialog" aria-label="Active call" className="fixed bottom-4 right-4 z-[55] w-[min(28rem,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-slate-900 text-white shadow-2xl">
      <div className="relative aspect-video bg-black">
        {/* Remote media (video element also plays audio) */}
        <video ref={remoteRef} autoPlay playsInline className={`h-full w-full object-contain ${showVideo ? '' : 'hidden'}`} />
        {!showVideo && (
          <div className="flex h-full flex-col items-center justify-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-slate-700 text-3xl">
              {state.peer?.name?.[0]?.toUpperCase() ?? '?'}
            </div>
          </div>
        )}
        {state.media === 'video' && (
          <video ref={localRef} autoPlay playsInline muted className="absolute bottom-2 right-2 h-24 w-32 rounded-lg border border-white/30 object-cover" />
        )}
        <div className="absolute left-2 top-2 flex items-center gap-2 text-xs">
          {state.recording && <span className="flex items-center gap-1 rounded bg-red-600 px-2 py-0.5">● REC</span>}
          {state.verified && <span className="rounded bg-green-700/80 px-2 py-0.5" title="DTLS-SRTP encrypted, participant verified">🔒 Encrypted</span>}
          {state.verified === false && <span className="rounded bg-red-700 px-2 py-0.5">⚠ Unverified</span>}
        </div>
        {state.status === 'connected' && (
          <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-black/50 px-2 py-0.5 text-xs" title={state.quality ? `RTT ${Math.round(state.quality.rttMs ?? 0)}ms · loss ${(state.quality.packetLossPct ?? 0).toFixed(1)}% · ${state.quality.bitrateKbps ?? 0}kbps` : 'Measuring…'}>
            <span className={`h-2 w-2 rounded-full ${QUALITY_COLORS[rating]}`} />
            {rating}
          </div>
        )}
      </div>

      <div className="px-4 py-3">
        <p className="font-semibold">{state.peer?.name}</p>
        <p className="text-xs text-slate-400">{statusText}</p>

        {state.consentRequestFrom && (
          <div className="mt-2 rounded bg-slate-800 p-2 text-sm">
            {state.consentRequestFrom.name} wants to record this call.
            <div className="mt-1 flex gap-2">
              <button className="rounded bg-green-600 px-2" onClick={() => manager.respondToRecording(true)}>Allow</button>
              <button className="rounded bg-slate-600 px-2" onClick={() => manager.respondToRecording(false)}>Deny</button>
            </div>
          </div>
        )}
        {state.recordingConsent === 'pending' && <p className="mt-2 text-xs text-slate-400">Waiting for recording consent…</p>}
        {state.recordingConsent === 'denied' && <p className="mt-2 text-xs text-red-400">Recording consent denied.</p>}

        <div className="mt-3 flex flex-wrap justify-center gap-2">
          <CtrlButton label={state.muted ? 'Unmute' : 'Mute'} active={state.muted} onClick={() => manager.toggleMute()} icon={state.muted ? '🔇' : '🎙️'} />
          <CtrlButton label={state.videoEnabled ? 'Turn off camera' : 'Turn on camera'} active={!state.videoEnabled} onClick={() => manager.toggleVideo()} icon={state.videoEnabled ? '📹' : '🚫'} disabled={state.status !== 'connected'} />
          <CtrlButton label={state.screenSharing ? 'Stop sharing' : 'Share screen'} active={state.screenSharing} onClick={() => manager.toggleScreenShare()} icon="🖥️" disabled={state.status !== 'connected'} />
          <CtrlButton
            label={state.recording ? 'Stop recording' : 'Record (with consent)'}
            active={state.recording}
            onClick={() => (state.recording ? manager.stopRecording() : manager.requestRecording())}
            icon="⏺"
            disabled={state.status !== 'connected' || state.recordingConsent === 'pending'}
          />
          <button aria-label="Hang up" onClick={() => manager.hangup()} className="rounded-full bg-red-600 px-4 py-2">📴</button>
        </div>
      </div>
    </div>
  );
}

function CtrlButton({ label, icon, active, disabled, onClick }: { label: string; icon: string; active?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button aria-label={label} title={label} aria-pressed={active} disabled={disabled} onClick={onClick} className={`rounded-full px-3 py-2 disabled:opacity-40 ${active ? 'bg-white text-slate-900' : 'bg-slate-700'}`}>
      {icon}
    </button>
  );
}
