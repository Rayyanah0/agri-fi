'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiClient } from '@/lib/api';
import { getAuthToken } from '@/lib/auth-token';
import { CallManager, type CallState } from '@/lib/calling/call-manager';
import { callSchedule } from '@/lib/calling/store';
import type { ScheduledCall } from '@/lib/calling/types';
import CallWindow from './CallWindow';
import IncomingCallModal from './IncomingCallModal';

interface CallContextValue {
  manager: CallManager | null;
  state: CallState | null;
  reminders: ScheduledCall[];
  dismissReminder: (id: string) => void;
}

const CallContext = createContext<CallContextValue>({
  manager: null,
  state: null,
  reminders: [],
  dismissReminder: () => undefined,
});

export const useCall = () => useContext(CallContext);

/** Mounts the call manager once per dashboard session so incoming calls ring on any page. */
export default function CallProvider({ children }: { children: ReactNode }) {
  const [manager, setManager] = useState<CallManager | null>(null);
  const [state, setState] = useState<CallState | null>(null);
  const [reminders, setReminders] = useState<ScheduledCall[]>([]);

  useEffect(() => {
    const user = apiClient.getCurrentUser();
    const token = getAuthToken();
    if (!user || !token) return;
    const m = new CallManager({ userId: user.id, name: user.name ?? user.email, role: user.role }, token);
    m.connect();
    const unsub = m.subscribe(setState);
    setManager(m);
    return () => {
      unsub();
      m.disconnect();
    };
  }, []);

  // Scheduled-call reminders (checked every 30s).
  useEffect(() => {
    const check = () => {
      const due = callSchedule.dueSoon();
      if (due.length === 0) return;
      due.forEach((c) => {
        callSchedule.update(c.id, { reminderSent: true });
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('Upcoming call', { body: `${c.title} starts at ${new Date(c.scheduledFor).toLocaleTimeString()}` });
          }
        } catch {
          /* ignore */
        }
      });
      setReminders((r) => [...r, ...due]);
    };
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);

  const value = useMemo(
    () => ({
      manager,
      state,
      reminders,
      dismissReminder: (id: string) => setReminders((r) => r.filter((x) => x.id !== id)),
    }),
    [manager, state, reminders],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      {manager && state && state.status === 'ringing' && <IncomingCallModal manager={manager} state={state} />}
      {manager && state && !['idle', 'ringing'].includes(state.status) && <CallWindow manager={manager} state={state} />}
      {reminders.length > 0 && (
        <div className="fixed bottom-4 left-4 z-50 space-y-2" role="status">
          {reminders.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-lg bg-white p-3 text-sm shadow-lg dark:bg-slate-800">
              <span>
                📅 <strong>{r.title}</strong> at {new Date(r.scheduledFor).toLocaleTimeString()}
              </span>
              {manager && r.participants[0] && (
                <button
                  className="rounded bg-green-600 px-2 py-1 text-white"
                  onClick={() => {
                    manager.startCall(r.participants[0], r.media, r.dealId);
                    value.dismissReminder(r.id);
                  }}
                >
                  Join
                </button>
              )}
              <button aria-label="Dismiss" onClick={() => value.dismissReminder(r.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
    </CallContext.Provider>
  );
}
