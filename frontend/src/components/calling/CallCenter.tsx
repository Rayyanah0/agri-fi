'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCall } from './CallProvider';
import { callHistory, callSchedule, computeAnalytics } from '@/lib/calling/store';
import type { CallMedia, CallRecord, Participant, ScheduledCall } from '@/lib/calling/types';

const fmt = (sec: number) => `${Math.floor(sec / 60)}m ${sec % 60}s`;

export default function CallCenter() {
  const { manager, state } = useCall();
  const [history, setHistory] = useState<CallRecord[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledCall[]>([]);
  const [peerId, setPeerId] = useState('');
  const [peerName, setPeerName] = useState('');
  const [dealId, setDealId] = useState('');

  const refresh = () => {
    setHistory(callHistory.list());
    setScheduled(callSchedule.list());
  };
  useEffect(refresh, [state?.status]);
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined);
    }
  }, []);

  const analytics = useMemo(() => computeAnalytics(history), [history]);
  const peer: Participant | null = peerId.trim() ? { userId: peerId.trim(), name: peerName.trim() || peerId.trim() } : null;
  const busy = state && state.status !== 'idle';

  const call = (p: Participant, media: CallMedia, deal?: string) => manager?.startCall(p, media, deal);

  return (
    <div className="space-y-6">
      {!manager && <p className="rounded bg-yellow-50 p-3 text-sm text-yellow-800">Sign in to place calls.</p>}

      {/* Quick call */}
      <section className="rounded-lg border p-4 dark:border-slate-700">
        <h2 className="mb-3 font-semibold">Start a call</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <input aria-label="Participant user ID" placeholder="Participant user ID" className="rounded border px-2 py-1 dark:bg-slate-800" value={peerId} onChange={(e) => setPeerId(e.target.value)} />
          <input aria-label="Participant name" placeholder="Display name" className="rounded border px-2 py-1 dark:bg-slate-800" value={peerName} onChange={(e) => setPeerName(e.target.value)} />
          <input aria-label="Deal ID" placeholder="Deal ID (optional)" className="rounded border px-2 py-1 dark:bg-slate-800" value={dealId} onChange={(e) => setDealId(e.target.value)} />
          <div className="flex gap-2">
            <button disabled={!peer || !manager || !!busy} onClick={() => peer && call(peer, 'audio', dealId || undefined)} className="flex-1 rounded bg-green-600 px-3 py-1 text-white disabled:opacity-40">📞 Audio</button>
            <button disabled={!peer || !manager || !!busy} onClick={() => peer && call(peer, 'video', dealId || undefined)} className="flex-1 rounded bg-green-700 px-3 py-1 text-white disabled:opacity-40">📹 Video</button>
          </div>
        </div>
      </section>

      <ScheduleForm participant={peer} dealId={dealId} onScheduled={refresh} />

      {/* Upcoming */}
      <section className="rounded-lg border p-4 dark:border-slate-700">
        <h2 className="mb-3 font-semibold">Scheduled calls</h2>
        {scheduled.length === 0 ? (
          <p className="text-sm text-slate-500">No upcoming calls.</p>
        ) : (
          <ul className="divide-y text-sm dark:divide-slate-700">
            {scheduled.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <strong>{c.title}</strong> · {new Date(c.scheduledFor).toLocaleString()} · {c.durationMin} min · {c.media} with {c.participants.map((p) => p.name).join(', ')}
                </span>
                <span className="flex gap-2">
                  <button disabled={!manager || !!busy} className="rounded bg-green-600 px-2 text-white disabled:opacity-40" onClick={() => call(c.participants[0], c.media, c.dealId)}>Start</button>
                  <button className="text-red-600" onClick={() => { callSchedule.remove(c.id); refresh(); }}>Cancel</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Analytics */}
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat label="Total calls" value={analytics.totalCalls} />
        <Stat label="Completion rate" value={`${Math.round(analytics.completionRate * 100)}%`} />
        <Stat label="Avg duration" value={fmt(analytics.avgDurationSec)} />
        <Stat label="Total talk time" value={fmt(analytics.totalTalkTimeSec)} />
        <div className="rounded-lg border p-3 text-xs sm:col-span-4 dark:border-slate-700">
          <span className="font-semibold">Quality: </span>
          {Object.entries(analytics.byQuality).map(([k, v]) => `${k} ${v}`).join(' · ')}
          <span className="ml-4 font-semibold">Outcomes: </span>
          {Object.entries(analytics.byOutcome).map(([k, v]) => `${k} ${v}`).join(' · ')}
        </div>
      </section>

      {/* History */}
      <section className="rounded-lg border p-4 dark:border-slate-700">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Call history</h2>
          {history.length > 0 && <button className="text-xs text-slate-500" onClick={() => { callHistory.clear(); refresh(); }}>Clear</button>}
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-slate-500">No calls yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr><th className="py-1">When</th><th>Participants</th><th>Type</th><th>Duration</th><th>Outcome</th><th>Quality</th><th>Deal</th><th /></tr>
              </thead>
              <tbody className="divide-y dark:divide-slate-700">
                {history.map((h) => {
                  const other = h.participants[1];
                  return (
                    <tr key={h.id}>
                      <td className="py-1">{new Date(h.startedAt).toLocaleString()}</td>
                      <td>{h.direction === 'incoming' ? '↙' : '↗'} {h.participants.map((p) => p.name).join(' & ')}</td>
                      <td>{h.media}{h.recorded ? ' · ⏺' : ''}</td>
                      <td>{fmt(h.durationSec)}</td>
                      <td className="capitalize">{h.outcome}</td>
                      <td className="capitalize">{h.avgQuality}</td>
                      <td>{h.dealId?.slice(0, 8) ?? '—'}</td>
                      <td>{other && <button disabled={!manager || !!busy} className="text-green-700 disabled:opacity-40" onClick={() => call(other, h.media, h.dealId)}>Call back</button>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border p-3 dark:border-slate-700">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

function ScheduleForm({ participant, dealId, onScheduled }: { participant: Participant | null; dealId: string; onScheduled: () => void }) {
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [duration, setDuration] = useState(30);
  const [media, setMedia] = useState<CallMedia>('video');

  return (
    <form
      className="rounded-lg border p-4 dark:border-slate-700"
      onSubmit={(e) => {
        e.preventDefault();
        if (!participant || !when || new Date(when).getTime() < Date.now()) return;
        callSchedule.add({
          id: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()),
          title: title.trim() || `Call with ${participant.name}`,
          media,
          participants: [participant],
          dealId: dealId || undefined,
          scheduledFor: new Date(when).toISOString(),
          durationMin: duration,
        });
        setTitle('');
        setWhen('');
        onScheduled();
      }}
    >
      <h2 className="mb-1 font-semibold">Schedule a call</h2>
      <p className="mb-3 text-xs text-slate-500">Uses the participant entered above. You&apos;ll be reminded 5 minutes before.</p>
      <div className="grid gap-2 sm:grid-cols-5">
        <input aria-label="Call title" placeholder="Title" className="rounded border px-2 py-1 dark:bg-slate-800" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input aria-label="Scheduled time" type="datetime-local" className="rounded border px-2 py-1 dark:bg-slate-800" value={when} onChange={(e) => setWhen(e.target.value)} />
        <select aria-label="Duration" className="rounded border px-2 py-1 dark:bg-slate-800" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
          {[15, 30, 45, 60].map((d) => <option key={d} value={d}>{d} min</option>)}
        </select>
        <select aria-label="Call type" className="rounded border px-2 py-1 dark:bg-slate-800" value={media} onChange={(e) => setMedia(e.target.value as CallMedia)}>
          <option value="video">Video</option>
          <option value="audio">Audio</option>
        </select>
        <button type="submit" disabled={!participant || !when} className="rounded bg-slate-800 px-3 py-1 text-white disabled:opacity-40 dark:bg-slate-600">Schedule</button>
      </div>
    </form>
  );
}
