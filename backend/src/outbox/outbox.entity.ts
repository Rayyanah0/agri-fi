import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export interface OutboxEvent {
  eventType: string;
  payload: Record<string, unknown>;
  processed: boolean;
  retryCount: number;
  lastError: string | null;
}

@Entity('outbox')
// Matches migration 2100000000000-AlignOutboxPendingIndex and the
// `publishPending` worker query
// (WHERE processed = FALSE AND retry_count < 10 ORDER BY created_at).
@Index('idx_outbox_pending_scan', ['processed', 'retryCount', 'createdAt'], {
  where: '"processed" = FALSE',
})
export class OutboxEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  eventType: string;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ default: false })
  processed: boolean;

  @Column({ default: 0, name: 'retry_count' })
  retryCount: number;

  @Column({ nullable: true, name: 'last_error' })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @Column({ nullable: true, name: 'processed_at' })
  processedAt: Date | null;
}
