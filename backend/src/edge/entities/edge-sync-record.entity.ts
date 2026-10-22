import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('edge_sync_records')
@Index('IDX_edge_sync_node_created', ['nodeId', 'createdAt'])
export class EdgeSyncRecord {
  @PrimaryColumn({ name: 'event_id', type: 'varchar', length: 128 })
  eventId: string;

  @Column({ name: 'node_id', type: 'varchar', length: 100 })
  nodeId: string;

  @Column({ name: 'event_type', type: 'varchar', length: 100 })
  eventType: string;

  @Column({ name: 'payload', type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ name: 'payload_sha256', type: 'varchar', length: 64 })
  payloadSha256: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}