import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AuditArchiveRetrievalStatus =
  | 'pending'
  | 'approved'
  | 'fulfilled';

@Entity('audit_archive_retrieval_requests')
@Index(['status', 'requestedAt'])
export class AuditArchiveRetrievalRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'archive_record_id', type: 'uuid' })
  archiveRecordId: string;

  @Column({ name: 'requester_id', type: 'uuid' })
  requesterId: string;

  @Column({ name: 'approver_id', type: 'uuid', nullable: true })
  approverId: string | null;

  @Column({ type: 'text' })
  reason: string;

  @Column({ default: 'pending' })
  status: AuditArchiveRetrievalStatus;

  @CreateDateColumn({ name: 'requested_at', type: 'timestamptz' })
  requestedAt: Date;

  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt: Date | null;

  @Column({ name: 'fulfilled_at', type: 'timestamptz', nullable: true })
  fulfilledAt: Date | null;
}
