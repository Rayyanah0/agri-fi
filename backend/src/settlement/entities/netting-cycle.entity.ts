import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export type NettingCycleStatus =
  'scheduled' | 'aggregating' | 'netted' | 'settling' | 'settled' | 'failed';

export type NettingCycleFrequency = 'daily' | 'weekly' | 'adhoc';

@Entity('netting_cycles')
export class NettingCycle {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Netting cycle UUID' })
  id: string;

  @Column({ name: 'cycle_number', unique: true })
  @ApiProperty({
    description: 'Human-readable cycle identifier',
    example: 'CYCLE-20261019-001',
  })
  cycleNumber: string;

  @Column({ type: 'varchar', length: 32, default: 'daily' })
  @ApiProperty({ enum: ['daily', 'weekly', 'adhoc'], default: 'daily' })
  frequency: NettingCycleFrequency;

  @Index()
  @Column({ type: 'varchar', length: 32, default: 'scheduled' })
  @ApiProperty({
    enum: [
      'scheduled',
      'aggregating',
      'netted',
      'settling',
      'settled',
      'failed',
    ],
    default: 'scheduled',
  })
  status: NettingCycleStatus;

  @Column({ name: 'scheduled_at', type: 'timestamptz' })
  scheduledAt: Date;

  @Column({ name: 'executed_at', type: 'timestamptz', nullable: true })
  executedAt: Date | null;

  @Column({ name: 'settled_at', type: 'timestamptz', nullable: true })
  settledAt: Date | null;

  @Column({ name: 'gross_obligations_count', type: 'int', default: 0 })
  grossObligationsCount: number;

  @Column({
    name: 'gross_total_amount_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  grossTotalAmountUsd: number;

  @Column({ name: 'net_settlement_count', type: 'int', default: 0 })
  netSettlementCount: number;

  @Column({
    name: 'net_total_amount_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  netTotalAmountUsd: number;

  @Column({
    name: 'transaction_reduction_pct',
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
  })
  transactionReductionPct: number;

  @Column({
    name: 'fee_savings_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    default: 0,
  })
  feeSavingsUsd: number;

  @Column({ name: 'settlement_batch_tx_hash', type: 'varchar', nullable: true })
  settlementBatchTxHash: string | null;

  @Column({ name: 'settlement_metadata', type: 'jsonb', nullable: true })
  settlementMetadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
