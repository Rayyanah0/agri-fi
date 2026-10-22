import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export type ObligationStatus =
  'pending' | 'included_in_cycle' | 'netted' | 'settled' | 'excluded';

export type ObligationType =
  | 'deal_payout'
  | 'escrow_release'
  | 'platform_fee'
  | 'secondary_trade'
  | 'harvest_settlement';

@Entity('netting_obligations')
@Index(['payerId', 'status'])
@Index(['payeeId', 'status'])
@Index(['cycleId'])
export class NettingObligation {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Netting obligation UUID' })
  id: string;

  @Column({ name: 'payer_id', type: 'uuid' })
  @ApiProperty({ description: 'Debtor party UUID' })
  payerId: string;

  @Column({ name: 'payer_name' })
  @ApiProperty({ description: 'Debtor display name' })
  payerName: string;

  @Column({ name: 'payee_id', type: 'uuid' })
  @ApiProperty({ description: 'Creditor party UUID' })
  payeeId: string;

  @Column({ name: 'payee_name' })
  @ApiProperty({ description: 'Creditor display name' })
  payeeName: string;

  @Column({ name: 'deal_id', type: 'uuid', nullable: true })
  @ApiProperty({ description: 'Associated trade deal UUID', nullable: true })
  dealId: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 2 })
  @ApiProperty({
    description: 'Gross obligation amount in USD',
    example: 15000.0,
  })
  amountUsd: number;

  @Column({ length: 16, default: 'USD' })
  @ApiProperty({ description: 'Currency ISO or Stellar token', default: 'USD' })
  currency: string;

  @Column({ name: 'obligation_type', type: 'varchar', length: 32 })
  @ApiProperty({
    enum: [
      'deal_payout',
      'escrow_release',
      'platform_fee',
      'secondary_trade',
      'harvest_settlement',
    ],
  })
  obligationType: ObligationType;

  @Column({ type: 'varchar', length: 32, default: 'pending' })
  @ApiProperty({
    enum: ['pending', 'included_in_cycle', 'netted', 'settled', 'excluded'],
    default: 'pending',
  })
  status: ObligationStatus;

  @Column({ name: 'cycle_id', type: 'uuid', nullable: true })
  cycleId: string | null;

  @Column({ name: 'due_date', type: 'timestamptz' })
  dueDate: Date;

  @Column({
    name: 'netted_amount_usd',
    type: 'decimal',
    precision: 18,
    scale: 2,
    nullable: true,
  })
  nettedAmountUsd: number | null;

  @Column({ name: 'settlement_tx_hash', type: 'varchar', nullable: true })
  settlementTxHash: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
