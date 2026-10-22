import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type CalendarEventKind = 'milestone' | 'deadline';
export type CalendarSyncStatus = 'pending' | 'synced' | 'conflict' | 'failed';

@Entity('calendar_events')
@Index(['connectionId', 'sourceId'], { unique: true })
@Index(['userId', 'startsAt'])
export class CalendarEvent {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'connection_id' }) connectionId: string;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ name: 'source_id' }) sourceId: string;
  @Column({ name: 'source_type', length: 16 }) sourceType: CalendarEventKind;
  @Column({ name: 'external_id', nullable: true }) externalId: string | null;
  @Column() title: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ name: 'starts_at', type: 'timestamptz' }) startsAt: Date;
  @Column({ name: 'ends_at', type: 'timestamptz' }) endsAt: Date;
  @Column({ name: 'reminder_minutes', type: 'int', default: 60 }) reminderMinutes: number;
  @Column({ type: 'varchar', length: 16, default: 'pending' }) status: CalendarSyncStatus;
  @Column({ name: 'external_updated_at', type: 'timestamptz', nullable: true }) externalUpdatedAt: Date | null;
  @Column({ name: 'last_error', type: 'text', nullable: true }) lastError: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}