import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { DocumentVersion } from './entities/document-version.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { DocumentsService } from '../documents/documents.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface Actor {
  id: string;
  role: string;
}

export interface DiffLine {
  type: 'same' | 'added' | 'removed';
  text: string;
}

/** Roles allowed to restore any document; uploaders may restore their own. */
export const RESTORE_ROLES = ['admin', 'compliance'];
const MIN_COMMENT_LENGTH = 3;
const TEXT_MIME = /^(text\/|application\/(json|xml|csv))/;
const MAX_DIFF_BYTES = 512 * 1024;

@Injectable()
export class DocumentVersionsService {
  constructor(
    @InjectRepository(DocumentVersion)
    private readonly versions: Repository<DocumentVersion>,
    @InjectRepository(Document)
    private readonly documents: Repository<Document>,
    private readonly documentsService: DocumentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private requireComment(comment?: string): string {
    const c = (comment ?? '').trim();
    if (c.length < MIN_COMMENT_LENGTH) {
      throw new BadRequestException('A change comment is required for every version change');
    }
    return c;
  }

  private async getDocument(documentId: string): Promise<Document> {
    const doc = await this.documents.findOne({ where: { id: documentId } });
    if (!doc) throw new NotFoundException('Document not found');
    return doc;
  }

  /** Ensures the original upload exists as version 1 before adding new versions. */
  private async ensureBaseline(doc: Document): Promise<void> {
    const count = await this.versions.count({ where: { documentId: doc.id } });
    if (count > 0) return;
    await this.versions.save(
      this.versions.create({
        documentId: doc.id,
        versionNumber: 1,
        ipfsHash: doc.ipfsHash,
        storageUrl: doc.storageUrl,
        mimeType: null,
        sizeBytes: 0,
        contentSha256: '',
        comment: 'Initial version',
        action: 'upload',
        createdBy: doc.uploaderId,
      }),
    );
  }

  private async nextVersion(documentId: string): Promise<number> {
    const row = await this.versions
      .createQueryBuilder('v')
      .select('COALESCE(MAX(v.version_number), 0)', 'max')
      .where('v.document_id = :documentId', { documentId })
      .getRawOne();
    return Number(row?.max ?? 0) + 1;
  }

  async uploadVersion(
    documentId: string,
    file: { buffer: Buffer; mimetype: string; size: number },
    comment: string,
    actor: Actor,
  ): Promise<DocumentVersion> {
    const c = this.requireComment(comment);
    const doc = await this.getDocument(documentId);
    if (doc.uploaderId !== actor.id && !RESTORE_ROLES.includes(actor.role)) {
      throw new ForbiddenException('Not allowed to version this document');
    }
    await this.ensureBaseline(doc);

    const storage = await this.documentsService.getStorageServicePublic();
    const stored = await storage.upload(file.buffer, file.mimetype);
    const version = await this.versions.save(
      this.versions.create({
        documentId,
        versionNumber: await this.nextVersion(documentId),
        ipfsHash: stored.hash,
        storageUrl: stored.url,
        mimeType: file.mimetype,
        sizeBytes: file.size,
        contentSha256: createHash('sha256').update(file.buffer).digest('hex'),
        comment: c,
        action: 'upload',
        createdBy: actor.id,
      }),
    );
    await this.documents.update(documentId, { ipfsHash: stored.hash, storageUrl: stored.url });
    await this.afterChange(doc, version, actor, 'document.version.created');
    return version;
  }

  async restoreVersion(
    documentId: string,
    versionNumber: number,
    comment: string,
    actor: Actor,
  ): Promise<DocumentVersion> {
    const c = this.requireComment(comment);
    const doc = await this.getDocument(documentId);
    if (!this.canRestore(doc, actor)) {
      throw new ForbiddenException('You do not have permission to restore versions of this document');
    }
    await this.ensureBaseline(doc);
    const source = await this.getVersion(documentId, versionNumber);
    const version = await this.versions.save(
      this.versions.create({
        documentId,
        versionNumber: await this.nextVersion(documentId),
        ipfsHash: source.ipfsHash,
        storageUrl: source.storageUrl,
        mimeType: source.mimeType,
        sizeBytes: source.sizeBytes,
        contentSha256: source.contentSha256,
        comment: c,
        action: 'restore',
        restoredFromVersion: source.versionNumber,
        createdBy: actor.id,
      }),
    );
    await this.documents.update(documentId, { ipfsHash: source.ipfsHash, storageUrl: source.storageUrl });
    await this.afterChange(doc, version, actor, 'document.version.restored');
    return version;
  }

  canRestore(doc: Document, actor: Actor): boolean {
    return RESTORE_ROLES.includes(actor.role) || doc.uploaderId === actor.id;
  }

  async history(documentId: string): Promise<DocumentVersion[]> {
    const doc = await this.getDocument(documentId);
    await this.ensureBaseline(doc);
    return this.versions.find({ where: { documentId }, order: { versionNumber: 'DESC' } });
  }

  async getVersion(documentId: string, versionNumber: number): Promise<DocumentVersion> {
    const v = await this.versions.findOne({ where: { documentId, versionNumber } });
    if (!v) throw new NotFoundException(`Version ${versionNumber} not found`);
    return v;
  }

  /** Side-by-side metadata comparison of two versions. */
  async compare(documentId: string, a: number, b: number) {
    const [va, vb] = await Promise.all([this.getVersion(documentId, a), this.getVersion(documentId, b)]);
    const fields: (keyof DocumentVersion)[] = [
      'ipfsHash', 'mimeType', 'sizeBytes', 'contentSha256', 'comment', 'action', 'createdBy', 'createdAt',
    ];
    return {
      left: va,
      right: vb,
      identicalContent:
        va.ipfsHash === vb.ipfsHash || (!!va.contentSha256 && va.contentSha256 === vb.contentSha256),
      changedFields: fields.filter((f) => String(va[f]) !== String(vb[f])),
    };
  }

  /** Line-level diff for text-based versions (LCS); binary files report hash/size changes only. */
  async diff(documentId: string, a: number, b: number) {
    const [va, vb] = await Promise.all([this.getVersion(documentId, a), this.getVersion(documentId, b)]);
    const isText = (v: DocumentVersion) => !!v.mimeType && TEXT_MIME.test(v.mimeType);
    if (!isText(va) || !isText(vb) || va.sizeBytes > MAX_DIFF_BYTES || vb.sizeBytes > MAX_DIFF_BYTES) {
      return {
        binary: true,
        sizeDelta: vb.sizeBytes - va.sizeBytes,
        hashChanged: va.ipfsHash !== vb.ipfsHash,
        lines: [] as DiffLine[],
      };
    }
    const storage = await this.documentsService.getStorageServicePublic();
    const [ba, bb] = await Promise.all([
      storage.fetchAndVerifyIpfsDocument(va.ipfsHash),
      storage.fetchAndVerifyIpfsDocument(vb.ipfsHash),
    ]);
    const lines = diffLines(ba.toString('utf8'), bb.toString('utf8'));
    return {
      binary: false,
      added: lines.filter((l) => l.type === 'added').length,
      removed: lines.filter((l) => l.type === 'removed').length,
      lines,
    };
  }

  /** Version frequency and restore-rate analytics (global or per document). */
  async analytics(documentId?: string) {
    const qb = this.versions.createQueryBuilder('v');
    if (documentId) qb.where('v.document_id = :documentId', { documentId });
    const row = await qb
      .select('COUNT(*)::int', 'total')
      .addSelect(`COUNT(*) FILTER (WHERE v.action = 'restore')::int`, 'restores')
      .addSelect('COUNT(DISTINCT v.document_id)::int', 'documents')
      .addSelect(`COUNT(*) FILTER (WHERE v.created_at > now() - interval '30 days')::int`, 'last30d')
      .getRawOne();
    const total = Number(row.total);
    return {
      totalVersions: total,
      documents: Number(row.documents),
      restores: Number(row.restores),
      restoreRate: total ? Number(row.restores) / total : 0,
      avgVersionsPerDocument: row.documents ? total / Number(row.documents) : 0,
      versionsLast30Days: Number(row.last30d),
    };
  }

  private async afterChange(doc: Document, v: DocumentVersion, actor: Actor, event: string) {
    await this.audit.logEvent({
      actorId: actor.id,
      actorRole: actor.role,
      route: event,
      statusCode: 200,
      requestDetails: {
        documentId: doc.id,
        versionNumber: v.versionNumber,
        action: v.action,
        restoredFromVersion: v.restoredFromVersion,
        comment: v.comment,
        ipfsHash: v.ipfsHash,
      },
    });
    const recipients = new Set([doc.uploaderId]);
    recipients.delete(actor.id);
    for (const userId of recipients) {
      await this.notifications.createNotification({
        userId,
        type: 'deal',
        title: v.action === 'restore' ? 'Document version restored' : 'New document version',
        message: `Version ${v.versionNumber} of a ${doc.docType} document: ${v.comment}`,
        linkUrl: `/documents/${doc.id}/versions`,
        metadataJson: { documentId: doc.id, versionNumber: v.versionNumber, event },
      });
    }
  }
}

/** Myers-style LCS line diff (O(n*m), bounded by MAX_DIFF_BYTES). */
export function diffLines(a: string, b: string): DiffLine[] {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) { out.push({ type: 'same', text: x[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: 'removed', text: x[i++] });
    else out.push({ type: 'added', text: y[j++] });
  }
  while (i < n) out.push({ type: 'removed', text: x[i++] });
  while (j < m) out.push({ type: 'added', text: y[j++] });
  return out;
}
