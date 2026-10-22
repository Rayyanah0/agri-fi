import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('liquidity_snapshots')
@Index(['investorId', 'createdAt'])
export class LiquiditySnapshot {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Snapshot UUID' })
  id: string;

  @Column({ name: 'investor_id', type: 'varchar' })
  investorId: string;

  @Column({
    name: 'total_portfolio_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
  })
  totalPortfolioUsd: number;

  @Column({
    name: 'liquidity_score',
    type: 'decimal',
    precision: 5,
    scale: 2,
  })
  liquidityScore: number;

  @Column({ name: 'liquidity_tier', type: 'varchar', length: 32 })
  liquidityTier: string;

  @Column({
    name: 'lcr_ratio_pct',
    type: 'decimal',
    precision: 6,
    scale: 2,
  })
  lcrRatioPct: number;

  @Column({
    name: 'convertible_30d_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
  })
  convertible30dUsd: number;

  @Column({
    name: 'convertible_30d_pct',
    type: 'decimal',
    precision: 5,
    scale: 2,
  })
  convertible30dPct: number;

  @Column({ name: 'snapshot_metadata', type: 'jsonb', nullable: true })
  snapshotMetadata: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
