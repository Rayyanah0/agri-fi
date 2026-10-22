import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('api_usage_events')
@Index('IDX_api_usage_owner_created', ['ownerId', 'createdAt'])
export class ApiUsageEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'api_key_id', type: 'uuid' })
  apiKeyId: string;

  @Column({ length: 10 })
  method: string;

  @Column({ length: 160 })
  endpoint: string;

  @Column({ name: 'status_code', type: 'integer' })
  statusCode: number;

  @Column({ name: 'data_transfer_bytes', type: 'bigint', default: 0 })
  dataTransferBytes: number;

  @Column({ name: 'compute_time_ms', type: 'integer', default: 0 })
  computeTimeMs: number;

  @Column({ default: false })
  anomalous: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}