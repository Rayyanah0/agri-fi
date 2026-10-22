import { OracleDataType, OracleProviderName } from '../entities/oracle-feed.entity';

export interface OracleFeedDescriptor {
  feedId: string;
  dataType: OracleDataType;
  decimals: number;
}

/** A single reading returned by a provider, before validation. */
export interface OracleReading {
  value: number;
  decimals: number;
  roundId?: string;
  observedAt: Date;
  provider: OracleProviderName;
  /** Raw provider payload, useful for debugging / provenance. */
  raw?: unknown;
}

/**
 * A pluggable oracle data source (#1235). Implementations fetch a reading for a
 * feed descriptor and throw when the source is unavailable so the caller can
 * fall back to another provider.
 */
export interface OracleProvider {
  readonly name: OracleProviderName;
  fetch(descriptor: OracleFeedDescriptor): Promise<OracleReading>;
}
