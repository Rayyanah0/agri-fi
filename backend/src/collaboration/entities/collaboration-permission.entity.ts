import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CollaborationResourceType } from './collaboration-session.entity';

/**
 * Who may observe presence for a resource (#1234 — collaboration permissions).
 *
 * - `visibility = 'everyone'`: any authenticated user with access to the
 *   resource sees presence for all participants that have not hidden it.
 * - `visibility = 'invited'`: only users with an explicit row where
 *   `canViewPresence = true` see presence.
 *
 * A row with a null `userId` stores the resource-level default policy. Rows
 * with a `userId` are per-user overrides / allow-list entries.
 */
export type CollaborationVisibility = 'everyone' | 'invited';

@Entity('collaboration_permissions')
@Index(['resourceType', 'resourceId', 'userId'], { unique: true })
export class CollaborationPermission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'resource_type', type: 'varchar', length: 16 })
  resourceType: CollaborationResourceType;

  @Column({ name: 'resource_id' })
  resourceId: string;

  /** Null means "resource default policy". */
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId: string | null;

  @Column({
    name: 'visibility',
    type: 'varchar',
    length: 16,
    default: 'everyone',
  })
  visibility: CollaborationVisibility;

  @Column({ name: 'can_view_presence', type: 'boolean', default: true })
  canViewPresence: boolean;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
