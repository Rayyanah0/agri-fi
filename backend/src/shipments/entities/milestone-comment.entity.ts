import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
} from 'typeorm';
import { ShipmentMilestone } from './shipment-milestone.entity';

@Entity('milestone_comments')
export class MilestoneComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'milestone_id' })
  milestoneId: string;

  @ManyToOne(() => ShipmentMilestone)
  milestone: ShipmentMilestone;

  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'user_display_name' })
  userDisplayName: string;

  @Column('text')
  content: string;

  @Column({ nullable: true })
  role: string | null; // 'trader', 'farmer', 'logistics', 'investor'

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @DeleteDateColumn({ name: 'deleted_at', nullable: true })
  deletedAt: Date | null;
}
