import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { encryptionTransformer } from '../../common/encryption.transformer';

export type CalendarProvider = 'google' | 'outlook' | 'apple';

@Entity('calendar_connections')
@Index(['userId', 'provider'], { unique: true })
export class CalendarConnection {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'user_id' }) userId: string;
  @Column({ type: 'varchar', length: 16 }) provider: CalendarProvider;
  @Column({ name: 'calendar_id', length: 512 }) calendarId: string;
  @Column({ name: 'access_token', type: 'text', transformer: encryptionTransformer }) accessToken: string;
  @Column({ name: 'refresh_token', type: 'text', nullable: true, transformer: encryptionTransformer }) refreshToken: string | null;
  @Column({ length: 64, default: 'UTC' }) timezone: string;
  @Column({ type: 'jsonb', default: () => "'{\"milestones\":true,\"deadlines\":true}'" }) preferences: Record<string, boolean>;
  @Column({ name: 'last_synced_at', type: 'timestamptz', nullable: true }) lastSyncedAt: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}