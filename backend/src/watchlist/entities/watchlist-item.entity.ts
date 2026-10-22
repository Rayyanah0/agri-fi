import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from '../../auth/entities/user.entity';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';

/** Funding thresholds an investor can be alerted on, in percent of deal value. */
export const WATCHLIST_THRESHOLD_MIN = 1;
export const WATCHLIST_THRESHOLD_MAX = 100;
export const MAX_WATCHLIST_THRESHOLDS = 8;

/**
 * Funding milestones alerted on when a watchlist item is created without an
 * explicit threshold list. 50% and full funding are the two points most
 * investors act on; anything finer has to be asked for.
 */
export const DEFAULT_WATCHLIST_THRESHOLDS = [50, 100];

/**
 * A deal an investor starred, together with the alert thresholds that should
 * push a notification to that investor. One row per (user, deal) pair.
 *
 * `alertedPct` / `alertedStatus` are watermarks, not audit history: they record
 * what this user has already been told about so a restart (or a second worker)
 * cannot re-send the same alert.
 */
@Entity('watchlist_item')
@Unique('UQ_watchlist_item_user_deal', ['userId', 'dealId'])
@Index('IDX_watchlist_item_deal', ['dealId'])
export class WatchlistItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Owning investor user UUID' })
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @ApiProperty({ description: 'Watched trade deal UUID' })
  @Column({ name: 'deal_id', type: 'uuid' })
  dealId: string;

  @ManyToOne(() => TradeDeal, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deal_id' })
  deal: TradeDeal;

  @ApiProperty({
    description: 'Funding percentages that trigger a notification',
    example: [50, 100],
  })
  @Column({
    name: 'notify_funding_pct',
    type: 'jsonb',
    default: () => "'[50, 100]'",
  })
  notifyFundingPct: number[];

  @ApiProperty({
    description: 'Notify when the deal moves to another lifecycle status',
    example: true,
  })
  @Column({ name: 'notify_status_change', type: 'boolean', default: true })
  notifyStatusChange: boolean;

  @ApiProperty({
    description: 'Highest funding percentage already notified to this user',
    example: 50,
  })
  @Column({ name: 'alerted_pct', type: 'integer', default: 0 })
  alertedPct: number;

  @ApiProperty({
    description: 'Last deal status already notified to this user',
    example: 'open',
    nullable: true,
  })
  @Column({ name: 'alerted_status', type: 'text', nullable: true })
  alertedStatus: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
