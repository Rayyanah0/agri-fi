import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { TradeDeal } from '../../trade-deals/entities/trade-deal.entity';
import { User } from '../../users/entities/user.entity';
import { AMMLiquidityPosition } from './amm-liquidity-position.entity';
import { AMMSwap } from './amm-swap.entity';

export enum PoolStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  DEPRECATED = 'deprecated',
}

export enum PricingModel {
  CONSTANT_PRODUCT = 'constant_product', // x*y=k
  STABLE_SWAP = 'stable_swap',
  LINEAR = 'linear',
}

@Entity('amm_pools')
@Index(['dealId', 'status'])
@Index(['creatorId'])
@Index(['status'])
export class AMMPool {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  dealId: string;

  @ManyToOne(() => TradeDeal, { eager: false })
  @JoinColumn({ name: 'dealId' })
  deal: TradeDeal;

  @Column()
  creatorId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'creatorId' })
  creator: User;

  // Pool composition - token amounts
  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  reserveToken0: string; // Deal token reserve

  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  reserveToken1: string; // Quote token reserve (USDC)

  // Fee parameters
  @Column('numeric', { precision: 5, scale: 4, default: 0.003 }) // 0.3% default
  feePercentage: number;

  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  accumulatedFees0: string;

  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  accumulatedFees1: string;

  // Pricing model configuration
  @Column({
    type: 'enum',
    enum: PricingModel,
    default: PricingModel.CONSTANT_PRODUCT,
  })
  pricingModel: PricingModel;

  // Pool parameters
  @Column('numeric', { precision: 20, scale: 8, default: 1 })
  amplificationFactor: number; // For stable swap pools

  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  minInitialLiquidity: string; // Minimum liquidity to create pool

  // Status
  @Column({
    type: 'enum',
    enum: PoolStatus,
    default: PoolStatus.ACTIVE,
  })
  status: PoolStatus;

  // Analytics
  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  totalLiquidity: string; // Total LP tokens outstanding

  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  totalVolume24h: string;

  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  totalFeeCollected: string;

  @Column('numeric', { precision: 10, scale: 2, default: 0 })
  currentApr: number; // Annual Percentage Return for LPs

  // Governance
  @Column({ default: false })
  governanceEnabled: boolean;

  @Column('numeric', { precision: 5, scale: 4, default: 0.5 })
  governanceThreshold: number; // % of LPs needed to approve changes

  // Security
  @Column({ default: true })
  pausedForMaintenance: boolean;

  @Column({ type: 'text', nullable: true })
  pauseReason: string;

  // Metadata
  @Column({ type: 'jsonb', default: {} })
  metadata: Record<string, any>;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  // Relations
  @OneToMany(() => AMMLiquidityPosition, (position) => position.pool, {
    cascade: true,
    eager: false,
  })
  liquidityPositions: AMMLiquidityPosition[];

  @OneToMany(() => AMMSwap, (swap) => swap.pool, {
    cascade: true,
    eager: false,
  })
  swaps: AMMSwap[];
}
