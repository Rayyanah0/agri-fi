import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type EmailFrequency = 'instant' | 'daily' | 'weekly' | 'off';
export type EmailCategory = 'payment' | 'kyc' | 'deal' | 'alert' | 'document' | 'marketing';
export type EmailStatus = 'scheduled' | 'sent' | 'failed' | 'suppressed';

@Entity('email_preferences')
export class EmailPreference {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 16, default: 'instant' })
  frequency: EmailFrequency;

  /** Per-category opt-out map, e.g. { marketing: false }. Missing = enabled. */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  categories: Partial<Record<EmailCategory, boolean>>;

  /** Preferred local hour (0-23) for scheduled / digest delivery. */
  @Column({ name: 'preferred_hour', type: 'int', nullable: true })
  preferredHour: number | null;

  @Column({ type: 'varchar', length: 64, default: 'UTC' })
  timezone: string;

  @Column({ name: 'unsubscribed_all', default: false })
  unsubscribedAll: boolean;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}

@Entity('email_messages')
@Index(['status', 'scheduledFor'])
export class EmailMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({ name: 'to_address' })
  toAddress: string;

  @Column({ type: 'varchar', length: 64 })
  template: string;

  @Column({ type: 'varchar', length: 32 })
  category: EmailCategory;

  @Column()
  subject: string;

  @Column({ type: 'text' })
  html: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'varchar', length: 16, default: 'scheduled' })
  status: EmailStatus;

  @Column({ name: 'scheduled_for', type: 'timestamptz' })
  scheduledFor: Date;

  @Column({ name: 'sent_at', type: 'timestamptz', nullable: true })
  sentAt: Date | null;

  @Column({ name: 'opened_at', type: 'timestamptz', nullable: true })
  openedAt: Date | null;

  @Column({ name: 'open_count', type: 'int', default: 0 })
  openCount: number;

  @Column({ name: 'click_count', type: 'int', default: 0 })
  clickCount: number;

  /** Token embedded in the Reply-To address for email-to-platform processing. */
  @Index({ unique: true })
  @Column({ name: 'reply_token', type: 'varchar', length: 64, nullable: true })
  replyToken: string | null;

  @Column({ type: 'jsonb', nullable: true })
  context: Record<string, any> | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
