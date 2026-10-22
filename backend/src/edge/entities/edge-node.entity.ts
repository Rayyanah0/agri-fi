import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type EdgeNodeState = 'online' | 'degraded' | 'offline';

@Entity('edge_nodes')
export class EdgeNode {
  @PrimaryColumn({ name: 'node_id', type: 'varchar', length: 100 })
  nodeId: string;

  @Column({ name: 'region', type: 'varchar', length: 100 })
  region: string;

  @Column({ name: 'state', type: 'varchar', length: 16, default: 'offline' })
  state: EdgeNodeState;

  @Column({ name: 'last_seen_at', type: 'timestamptz', nullable: true })
  lastSeenAt: Date | null;

  @Column({ name: 'latency_ms', type: 'integer', nullable: true })
  latencyMs: number | null;

  @Column({ name: 'queued_items', type: 'integer', default: 0 })
  queuedItems: number;

  @Column({ name: 'bytes_synced', type: 'bigint', default: 0 })
  bytesSynced: number;

  @Column({ name: 'last_error', type: 'text', nullable: true })
  lastError: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}