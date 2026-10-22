import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type OracleDataType = 'commodity' | 'weather' | 'fx';
export type OracleProviderName = 'chainlink' | 'band';

/**
 * A configured oracle data feed (#1235). Describes which providers to use, the
 * on-chain price-feed contract it writes to, validation bounds and cost budget.
 */
@Entity('oracle_feeds')
export class OracleFeed {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Human/business identifier, e.g. "COCOA/USD" or "RAINFALL/KE". */
  @Index({ unique: true })
  @Column({ name: 'feed_id', length: 64 })
  feedId: string;

  @Column({ name: 'description', length: 200, nullable: true })
  description: string | null;

  @Column({ name: 'data_type', type: 'varchar', length: 16, default: 'commodity' })
  dataType: OracleDataType;

  /** Ordered provider list — the first is the primary, the rest are fallbacks. */
  @Column({ name: 'providers', type: 'simple-json' })
  providers: OracleProviderName[];

  @Column({ name: 'quorum', type: 'int', default: 1 })
  quorum: number;

  @Column({ name: 'decimals', type: 'int', default: 7 })
  decimals: number;

  /** Expected maximum age between rounds, in seconds. */
  @Column({ name: 'heartbeat_seconds', type: 'int', default: 3600 })
  heartbeatSeconds: number;

  /** Maximum accepted move between rounds, in basis points. */
  @Column({ name: 'max_deviation_bps', type: 'int', default: 1000 })
  maxDeviationBps: number;

  /** Deployed PriceFeed Soroban contract id. */
  @Column({ name: 'contract_id', length: 64, nullable: true })
  contractId: string | null;

  /** Stellar account used to submit readings on-chain. */
  @Column({ name: 'oracle_address', length: 64, nullable: true })
  oracleAddress: string | null;

  /** Maximum expected on-chain cost per day, in XLM. Null = unlimited. */
  @Column({
    name: 'max_daily_cost_xlm',
    type: 'decimal',
    precision: 18,
    scale: 7,
    nullable: true,
  })
  maxDailyCostXlm: number | null;

  @Column({ name: 'enabled', default: true })
  enabled: boolean;

  @Column({
    name: 'last_value',
    type: 'decimal',
    precision: 36,
    scale: 7,
    nullable: true,
  })
  lastValue: number | null;

  @Column({ name: 'last_round_id', type: 'bigint', nullable: true })
  lastRoundId: string | null;

  @Column({ name: 'last_observed_at', type: 'timestamptz', nullable: true })
  lastObservedAt: Date | null;

  /** Governance: actor that last changed the feed configuration. */
  @Column({ name: 'last_changed_by', type: 'uuid', nullable: true })
  lastChangedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
