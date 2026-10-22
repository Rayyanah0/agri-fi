import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('feature_flags')
@Index(['key'], { unique: true })
export class FeatureFlag {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ length: 120 }) key: string;
  @Column({ default: false }) enabled: boolean;
  @Column({ type: 'float', default: 100 }) rolloutPercentage: number;
  @Column({ type: 'jsonb', default: () => "'[]'" }) userIds: string[];
  @Column({ type: 'jsonb', default: () => "'[]'" }) segments: string[];
  @Column({ name: 'starts_at', type: 'timestamptz', nullable: true }) startsAt: Date | null;
  @Column({ name: 'ends_at', type: 'timestamptz', nullable: true }) endsAt: Date | null;
  @Column({ name: 'updated_by' }) updatedBy: string;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}