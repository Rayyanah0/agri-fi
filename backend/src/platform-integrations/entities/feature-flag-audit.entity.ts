import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('feature_flag_audit')
@Index(['flagId', 'createdAt'])
export class FeatureFlagAudit {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'flag_id' }) flagId: string;
  @Column({ name: 'actor_id' }) actorId: string;
  @Column({ length: 32 }) action: string;
  @Column({ type: 'jsonb', nullable: true }) changes: Record<string, unknown> | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}