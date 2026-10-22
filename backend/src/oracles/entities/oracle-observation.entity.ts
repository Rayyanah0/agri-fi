import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { OracleProviderName } from './oracle-feed.entity';

/**
 * A single fetched-and-validated oracle reading (#1235). Records the provider,
 * the value, validation outcome, on-chain submission details and cost so that
 * accuracy, latency and cost analytics can be computed.
 */
@Entity('oracle_observations')
@Index(['feedId', 'fetchedAt'])
export class OracleObservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'feed_id', length: 64 })
  feedId: string;

  @Column({ name: 'provider', length: 32 })
  provider: OracleProviderName;

  @Column({
    name: 'value',
    type: 'decimal',
    precision: 36,
    scale: 7,
    nullable: true,
  })
  value: number | null;

  @Column({ name: 'decimals', type: 'int', default: 7 })
  decimals: number;

  @Column({ name: 'round_id', type: 'bigint', nullable: true })
  roundId: string | null;

  /** Timestamp reported by the provider. */
  @Column({ name: 'observed_at', type: 'timestamptz', nullable: true })
  observedAt: Date | null;

  @Column({ name: 'fetched_at', type: 'timestamptz' })
  fetchedAt: Date;

  /** End-to-end latency of the fetch, in milliseconds. */
  @Column({ name: 'latency_ms', type: 'int', default: 0 })
  latencyMs: number;

  /** Signed difference vs the feed's previous value, in basis points. */
  @Column({
    name: 'deviation_bps',
    type: 'decimal',
    precision: 12,
    scale: 4,
    nullable: true,
  })
  deviationBps: number | null;

  @Column({ name: 'valid', default: false })
  valid: boolean;

  @Column({ name: 'validation_error', length: 128, nullable: true })
  validationError: string | null;

  /** True when this provider was only used because the primary failed. */
  @Column({ name: 'is_fallback', default: false })
  isFallback: boolean;

  /** True for the reading that was selected as the feed's consensus value. */
  @Column({ name: 'selected', default: false })
  selected: boolean;

  @Column({ name: 'on_chain', default: false })
  onChain: boolean;

  @Column({ name: 'stellar_tx_id', length: 128, nullable: true })
  stellarTxId: string | null;

  @Column({
    name: 'gas_cost_xlm',
    type: 'decimal',
    precision: 18,
    scale: 7,
    nullable: true,
  })
  gasCostXlm: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
