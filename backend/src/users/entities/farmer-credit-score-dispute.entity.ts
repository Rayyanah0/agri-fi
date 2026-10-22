import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export type CreditScoreDisputeStatus =
  | 'open'
  | 'under_review'
  | 'resolved'
  | 'rejected';

/**
 * A farmer's challenge to their credit score (#1160).
 *
 * The farmer states which factor they believe was mis-measured; an
 * administrator reviews it and either corrects the score or rejects the
 * challenge with a reason.
 */
@Entity('farmer_credit_score_disputes')
@Index(['userId', 'status'])
export class FarmerCreditScoreDispute {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Dispute ID' })
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @ApiProperty({ description: 'Farmer whose score is disputed' })
  userId: string;

  @Column({ name: 'disputed_score', type: 'int' })
  @ApiProperty({ description: 'Score the farmer was shown when they filed' })
  disputedScore: number;

  @Column({ name: 'reason', type: 'text' })
  @ApiProperty({ description: "Farmer's explanation of the suspected error" })
  reason: string;

  /**
   * The scoring dimension the farmer believes was mis-measured.
   */
  @Column({ name: 'factor', type: 'varchar', length: 64, nullable: true })
  @ApiProperty({
    description: 'Scoring dimension the farmer disputes',
    nullable: true,
    example: 'onTimeRepayment',
  })
  factor: string | null;

  @Column({ type: 'varchar', length: 32, default: 'open' })
  @ApiProperty({ description: 'Dispute status', enum: ['open', 'under_review', 'resolved', 'rejected'] })
  status: CreditScoreDisputeStatus;

  @Column({ name: 'resolution', type: 'text', nullable: true })
  @ApiProperty({ description: "Administrator's resolution note", nullable: true })
  resolution: string | null;

  @Column({ name: 'corrected_score', type: 'int', nullable: true })
  @ApiProperty({
    description: 'Score applied when the dispute was upheld',
    nullable: true,
  })
  correctedScore: number | null;

  @Column({ name: 'resolved_by', type: 'uuid', nullable: true })
  @ApiProperty({ description: 'Administrator who handled the dispute', nullable: true })
  resolvedBy: string | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  @ApiProperty({ description: 'When the dispute was resolved', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  @ApiProperty({ description: 'When the dispute was filed' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}
