import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type VersionAction = 'upload' | 'restore';

@Entity('document_versions')
@Index(['documentId', 'versionNumber'], { unique: true })
export class DocumentVersion {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'document_id' })
  documentId: string;

  @Column({ name: 'version_number', type: 'int' })
  versionNumber: number;

  @Column({ name: 'ipfs_hash' })
  ipfsHash: string;

  @Column({ name: 'storage_url' })
  storageUrl: string;

  @Column({ name: 'mime_type', type: 'varchar', nullable: true })
  mimeType: string | null;

  @Column({ name: 'size_bytes', type: 'int', default: 0 })
  sizeBytes: number;

  @Column({ name: 'content_sha256', type: 'varchar', length: 64 })
  contentSha256: string;

  @Column({ type: 'text' })
  comment: string;

  @Column({ type: 'varchar', length: 16, default: 'upload' })
  action: VersionAction;

  @Column({ name: 'restored_from_version', type: 'int', nullable: true })
  restoredFromVersion: number | null;

  @Column({ name: 'created_by' })
  createdBy: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
