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

@Entity('amm_mining_rewards')
@Index(['poolId', 'userId'])
@Index(['userId'])
@Index(['poolId'])
@Index(['claimedAt'])
export class AMMMiningReward {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  poolId: string;

  @ManyToOne(() => AMMPool, { eager: false })
  @JoinColumn({ name: 'poolId' })
  pool: AMMPool;

  @Column()
  userId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  // Reward calculation
  @Column('numeric', { precision: 20, scale: 8 })
  rewardAmount: string;

  @Column('numeric', { precision: 10, scale: 2 })
  apy: number; // Annual Percentage Yield

  // Vesting schedule
  @Column({ default: false })
  isVested: boolean;

  @Column('numeric', { precision: 10, scale: 2, default: 100 })
  vestingPercentage: number; // 0-100

  @Column({ nullable: true })
  vestingStartDate: Date;

  @Column({ nullable: true })
  vestingEndDate: Date;

  // Claim status
  @Column({ default: false })
  isClaimed: boolean;

  @Column({ nullable: true })
  claimedAt: Date;

  @Column({ nullable: true })
  claimTxHash: string;

  // Reward period
  @Column()
  rewardPeriodStart: Date;

  @Column()
  rewardPeriodEnd: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
