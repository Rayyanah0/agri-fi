import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AMMPool } from './amm-pool.entity';
import { User } from '../../users/entities/user.entity';

@Entity('amm_liquidity_positions')
@Index(['poolId', 'userId'])
@Index(['userId'])
@Index(['poolId'])
export class AMMLiquidityPosition {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  poolId: string;

  @ManyToOne(() => AMMPool, (pool) => pool.liquidityPositions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'poolId' })
  pool: AMMPool;

  @Column()
  userId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  // LP Token holdings
  @Column('numeric', { precision: 20, scale: 8 })
  lpTokenAmount: string;

  // Original deposit amounts
  @Column('numeric', { precision: 20, scale: 8 })
  depositToken0Amount: string;

  @Column('numeric', { precision: 20, scale: 8 })
  depositToken1Amount: string;

  // Current values based on pool state
  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  currentToken0Value: string;

  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  currentToken1Value: string;

  // Fees earned
  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  feesEarned0: string;

  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  feesEarned1: string;

  // Impermanent loss tracking
  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  impermanentLoss: string;

  @Column('numeric', { precision: 10, scale: 2, default: 0 })
  impermanentLossPercentage: number;

  // Mining rewards
  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  miningRewardsAccumulated: string;

  @Column('numeric', { precision: 20, scale: 8, default: 0 })
  miningRewardsClaimed: string;

  // Status
  @Column({ default: true })
  isActive: boolean;

  @Column({ nullable: true })
  removedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
