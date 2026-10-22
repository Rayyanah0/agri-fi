import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  DeleteDateColumn,
} from 'typeorm';

@Entity('milestone_verifications')
export class MilestoneVerification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'milestone_id' })
  milestoneId: string;

  @Column({ name: 'verified_by' })
  verifiedBy: string;

  @Column({ name: 'verifier_role' })
  verifierRole: string; // 'farmer', 'logistics', 'investor', 'trader'

  @Column()
  status: 'verified' | 'rejected';

  @Column({ nullable: true })
  notes: string | null;

  @CreateDateColumn({ name: 'verified_at' })
  verifiedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date | null;
}
