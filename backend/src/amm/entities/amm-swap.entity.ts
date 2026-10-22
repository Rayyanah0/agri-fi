import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AMMPool } from './amm-pool.entity';
import { User } from '../../users/entities/user.entity';

export enum SwapDirection {
  TOKEN0_TO_TOKEN1 = 'token0_to_token1',
  TOKEN1_TO_TOKEN0 = 'token1_to_token0',
}

export enum SwapStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Entity('amm_swaps')
@Index(['poolId', 'createdAt'])
@Index(['userId'])
@Index(['status'])
@Index(['txHash'])
export class AMMSwap {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  poolId: string;

  @ManyToOne(() => AMMPool, (pool) => pool.swaps, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'poolId' })
  pool: AMMPool;

  @Column()
  userId: string;

  @ManyToOne(() => User, { eager: false })
  @JoinColumn({ name: 'userId' })
  user: User;

  // Swap details
  @Column({
    type: 'enum',
    enum: SwapDirection,
  })
  direction: SwapDirection;

  @Column('numeric', { precision: 20, scale: 8 })
  amountIn: string;

  @Column('numeric', { precision: 20, scale: 8 })
  amountOut: string;

  // Price info
  @Column('numeric', { precision: 20, scale: 8 })
  executionPrice: string;

  @Column('numeric', { precision: 10, scale: 2 })
  priceImpact: number; // Percentage

  @Column('numeric', { precision: 20, scale: 8 })
  feesPaid: string;

  // Slippage protection
  @Column('numeric', { precision: 20, scale: 8, nullable: true })
  minimumAmountOut: string;

  @Column({ default: false })
  slippageExceeded: boolean;

  // Status
  @Column({
    type: 'enum',
    enum: SwapStatus,
    default: SwapStatus.PENDING,
  })
  status: SwapStatus;

  // Blockchain details
  @Column({ nullable: true })
  txHash: string;

  @Column({ nullable: true })
  blockNumber: number;

  // Anti-frontrunning measures
  @Column({ nullable: true })
  nonce: string;

  @Column({ nullable: true })
  signature: string;

  @CreateDateColumn()
  createdAt: Date;
}
