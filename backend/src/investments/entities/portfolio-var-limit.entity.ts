import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('portfolio_var_limits')
@Index(['investorId', 'confidenceLevel', 'horizonDays'], { unique: true })
export class PortfolioVaRLimit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'investor_id', type: 'uuid' })
  investorId: string;

  @Column({ name: 'confidence_level', type: 'decimal', precision: 4, scale: 3 })
  confidenceLevel: number;

  @Column({ name: 'horizon_days', type: 'int' })
  horizonDays: number;

  @Column({ name: 'limit_usd', type: 'decimal', precision: 36, scale: 7 })
  limitUsd: number;

  @Column({ default: true })
  enabled: boolean;

  @Column({ name: 'last_breached', default: false })
  lastBreached: boolean;

  @Column({ name: 'last_alerted_at', type: 'timestamptz', nullable: true })
  lastAlertedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
