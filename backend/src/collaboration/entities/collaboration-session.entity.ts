import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Resources that support real-time collaboration (#1234). */
export type CollaborationResourceType = 'deal' | 'document';

/**
 * A single collaboration session. One row is written every time a user joins a
 * collaboration room and finalised (left_at + duration) when they leave or
 * disconnect. Sessions drive the history and analytics views.
 */
@Entity('collaboration_sessions')
@Index(['resourceType', 'resourceId'])
@Index(['userId', 'joinedAt'])
export class CollaborationSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 16 })
  resourceType: CollaborationResourceType;

  @Index()
  @Column({ name: 'resource_id' })
  resourceId: string;

  @Index()
  @Column({ name: 'user_id' })
  userId: string;

  @Column({ name: 'display_name', type: 'varchar', length: 160 })
  displayName: string;

  @Column({ name: 'avatar_url', type: 'varchar', length: 512, nullable: true })
  avatarUrl: string | null;

  @Column({ name: 'presence_visible', type: 'boolean', default: true })
  presenceVisible: boolean;

  @Column({ name: 'joined_at', type: 'timestamptz' })
  joinedAt: Date;

  @Column({ name: 'left_at', type: 'timestamptz', nullable: true })
  leftAt: Date | null;

  @Column({ name: 'duration_seconds', type: 'int', nullable: true })
  durationSeconds: number | null;

  @Column({ name: 'cursor_updates', type: 'int', default: 0 })
  cursorUpdates: number;

  @Column({ name: 'typing_events', type: 'int', default: 0 })
  typingEvents: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
