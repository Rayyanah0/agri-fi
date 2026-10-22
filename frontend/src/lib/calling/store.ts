import type { CallOutcome, CallRecord, QualityRating, ScheduledCall } from './types';

const HISTORY_KEY = 'agri-fi:call-history';
const SCHEDULE_KEY = 'agri-fi:scheduled-calls';
const MAX_HISTORY = 200;

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T[]) : [];
  } catch {
    return [];
  }
}
function write<T>(key: string, value: T[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export const callHistory = {
  list: () => read<CallRecord>(HISTORY_KEY),
  add(record: CallRecord) {
    write(HISTORY_KEY, [record, ...read<CallRecord>(HISTORY_KEY)].slice(0, MAX_HISTORY));
  },
  clear: () => write<CallRecord>(HISTORY_KEY, []),
};

export const callSchedule = {
  list: () =>
    read<ScheduledCall>(SCHEDULE_KEY).sort(
      (a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime(),
    ),
  add(call: ScheduledCall) {
    write(SCHEDULE_KEY, [...read<ScheduledCall>(SCHEDULE_KEY), call]);
  },
  update(id: string, patch: Partial<ScheduledCall>) {
    write(SCHEDULE_KEY, read<ScheduledCall>(SCHEDULE_KEY).map((c) => (c.id === id ? { ...c, ...patch } : c)));
  },
  remove(id: string) {
    write(SCHEDULE_KEY, read<ScheduledCall>(SCHEDULE_KEY).filter((c) => c.id !== id));
  },
  /** Calls starting within `windowMs` that haven't been reminded yet. */
  dueSoon(windowMs = 5 * 60 * 1000, now = Date.now()) {
    return read<ScheduledCall>(SCHEDULE_KEY).filter((c) => {
      const t = new Date(c.scheduledFor).getTime();
      return !c.reminderSent && t - now <= windowMs && t - now > -c.durationMin * 60_000;
    });
  },
};

export interface CallAnalytics {
  totalCalls: number;
  completed: number;
  avgDurationSec: number;
  totalTalkTimeSec: number;
  byOutcome: Record<CallOutcome, number>;
  byQuality: Record<QualityRating, number>;
  completionRate: number;
}

export function computeAnalytics(records: CallRecord[]): CallAnalytics {
  const byOutcome: Record<CallOutcome, number> = { completed: 0, missed: 0, declined: 0, failed: 0, cancelled: 0 };
  const byQuality: Record<QualityRating, number> = { excellent: 0, good: 0, fair: 0, poor: 0, unknown: 0 };
  let talk = 0;
  for (const r of records) {
    byOutcome[r.outcome] += 1;
    byQuality[r.avgQuality] += 1;
    talk += r.durationSec;
  }
  return {
    totalCalls: records.length,
    completed: byOutcome.completed,
    avgDurationSec: byOutcome.completed ? Math.round(talk / byOutcome.completed) : 0,
    totalTalkTimeSec: talk,
    byOutcome,
    byQuality,
    completionRate: records.length ? byOutcome.completed / records.length : 0,
  };
}
