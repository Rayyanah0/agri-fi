import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('audit_archive_records')
@Index('uq_audit_archive_records_source', ['sourceTable', 'sourceId'], {
  unique: true,
})
export class AuditArchiveRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'source_table' })
  sourceTable: string;

  @Column({ name: 'source_id', type: 'uuid' })
  sourceId: string;

  @Column({ name: 'log_type' })
  logType: string;

  @Column({ name: 'source_created_at', type: 'timestamptz' })
  sourceCreatedAt: Date;

  @Column({ name: 'retention_until', type: 'timestamptz' })
  retentionUntil: Date;

  @Column({ name: 'storage_key' })
  storageKey: string;

  @Column({ name: 'version_id' })
  versionId: string;

  @Column()
  checksum: string;

  @CreateDateColumn({ name: 'archived_at', type: 'timestamptz' })
  archivedAt: Date;
}
