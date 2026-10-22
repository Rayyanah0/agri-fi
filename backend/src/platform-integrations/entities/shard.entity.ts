import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type ShardStatus = 'healthy' | 'draining' | 'failed';

@Entity('database_shards')
@Index(['shardKey'], { unique: true })
export class Shard {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'shard_key', length: 120 }) shardKey: string;
  @Column({ length: 512 }) connectionUrl: string;
  @Column({ type: 'varchar', length: 16, default: 'healthy' }) status: ShardStatus;
  @Column({ name: 'weight', type: 'int', default: 1 }) weight: number;
  @Column({ name: 'last_health_check', type: 'timestamptz', nullable: true }) lastHealthCheck: Date | null;
  @Column({ name: 'last_error', type: 'text', nullable: true }) lastError: string | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}