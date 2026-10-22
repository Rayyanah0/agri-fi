import { Injectable } from '@nestjs/common';
import { OracleFeed } from './entities/oracle-feed.entity';
import { OracleReading } from './providers/oracle-provider.interface';

export interface ReadingValidation {
  valid: boolean;
  error?: string;
  deviationBps: number | null;
}

export interface ConsensusResult {
  ok: boolean;
  value: number | null;
  decimals: number;
  reason?: string;
  agreement: number;
}

/** Absolute move between two values expressed in basis points. */
export function deviationBps(next: number, previous: number): number | null {
  if (!Number.isFinite(next) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }
  return Math.abs((next - previous) / previous) * 10_000;
}

/**
 * Data-validation rules applied to every oracle reading before it is stored or
 * submitted on-chain (#1235): sanity, staleness and a deviation bound versus
 * the last accepted value.
 */
@Injectable()
export class OracleValidationService {
  validateReading(
    reading: OracleReading,
    feed: OracleFeed,
    previousValue: number | null,
    now: Date = new Date(),
  ): ReadingValidation {
    if (!Number.isFinite(reading.value) || reading.value <= 0) {
      return { valid: false, error: 'invalid_value', deviationBps: null };
    }

    const ageMs = now.getTime() - reading.observedAt.getTime();
    const maxAgeMs = feed.heartbeatSeconds * 1000;
    if (ageMs > maxAgeMs) {
      return { valid: false, error: 'stale_reading', deviationBps: null };
    }
    if (ageMs < -60_000) {
      // Reading claims to be from the future by more than a minute.
      return { valid: false, error: 'future_timestamp', deviationBps: null };
    }

    const dev = previousValue !== null ? deviationBps(reading.value, previousValue) : null;
    if (dev !== null && dev > feed.maxDeviationBps) {
      return { valid: false, error: 'deviation_too_high', deviationBps: dev };
    }

    return { valid: true, deviationBps: dev };
  }

  /**
   * Selects a consensus value across provider readings. Reads must agree within
   * the feed's deviation bound; at least `feed.quorum` must agree.
   */
  consensus(readings: OracleReading[], feed: OracleFeed): ConsensusResult {
    const usable = readings.filter(
      (r) => Number.isFinite(r.value) && r.value > 0,
    );
    if (usable.length === 0) {
      return { ok: false, value: null, decimals: feed.decimals, reason: 'no_readings', agreement: 0 };
    }

    const sorted = [...usable].sort((a, b) => a.value - b.value);
    const median = sorted[Math.floor(sorted.length / 2)].value;
    const agreeing = usable.filter((r) => {
      const dev = deviationBps(r.value, median);
      return dev === null || dev <= feed.maxDeviationBps;
    });

    if (agreeing.length < Math.max(1, feed.quorum)) {
      return {
        ok: false,
        value: null,
        decimals: feed.decimals,
        reason: 'quorum_not_met',
        agreement: agreeing.length,
      };
    }

    return {
      ok: true,
      value: median,
      decimals: feed.decimals,
      agreement: agreeing.length,
    };
  }
}
