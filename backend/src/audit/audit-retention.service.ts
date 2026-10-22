import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  RestoreObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { createHash } from 'crypto';
import { Counter, Gauge } from 'prom-client';
import { DataSource, LessThanOrEqual, Repository } from 'typeorm';
import { AuditService } from './audit.service';
import { AuditLogType } from './audit-retention-policy';
import { AuditArchiveRecord } from './entities/audit-archive-record.entity';
import {
  AuditArchiveRetrievalRequest,
  AuditArchiveRetrievalStatus,
} from './entities/audit-archive-retrieval-request.entity';

const SOURCE_TABLES = [
  { name: 'system_audit_logs', timestamp: 'timestamp' },
  { name: 'audit_logs', timestamp: 'created_at' },
  { name: 'transaction_audit_log', timestamp: 'created_at' },
] as const;

const ARCHIVE_BATCH_SIZE = 100;
const DEFAULT_HOT_RETENTION_DAYS = 30;

interface AuditSourceRow {
  id: string;
  log_type: AuditLogType;
  retention_until: Date | string;
  source_created_at: Date | string;
  [key: string]: unknown;
}

export interface AuditRetentionRunResult {
  enabled: boolean;
  archived: number;
  deletedFromPrimary: number;
  deletedExpiredArchives: number;
}

@Injectable()
export class AuditRetentionService {
  private readonly logger = new Logger(AuditRetentionService.name);
  private readonly bucket: string;
  private readonly enabled: boolean;
  private readonly hotRetentionDays: number;
  private readonly s3: S3Client;

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
    @InjectRepository(AuditArchiveRecord)
    private readonly archiveRepository: Repository<AuditArchiveRecord>,
    @InjectRepository(AuditArchiveRetrievalRequest)
    private readonly requestRepository: Repository<AuditArchiveRetrievalRequest>,
    @InjectMetric('audit_retention_archived_total')
    private readonly archivedCounter: Counter<string>,
    @InjectMetric('audit_retention_runs_total')
    private readonly runsCounter: Counter<string>,
    @InjectMetric('audit_retention_job_last_success_timestamp_seconds')
    private readonly lastSuccessTimestamp: Gauge<string>,
  ) {
    const enabledValue = this.config.get('AUDIT_RETENTION_ENABLED', false);
    this.enabled = enabledValue === true || enabledValue === 'true';
    this.bucket = this.config.get<string>('AUDIT_ARCHIVE_S3_BUCKET', '');
    const configuredHotRetentionDays = this.config.get<unknown>(
      'AUDIT_LOG_HOT_RETENTION_DAYS',
      DEFAULT_HOT_RETENTION_DAYS,
    );
    this.hotRetentionDays =
      typeof configuredHotRetentionDays === 'number'
        ? configuredHotRetentionDays
        : Number(configuredHotRetentionDays);
    if (!Number.isInteger(this.hotRetentionDays) || this.hotRetentionDays < 1) {
      throw new Error('AUDIT_LOG_HOT_RETENTION_DAYS must be a positive integer.');
    }
    if (this.enabled && !this.bucket) {
      throw new Error(
        'AUDIT_ARCHIVE_S3_BUCKET is required when AUDIT_RETENTION_ENABLED=true.',
      );
    }

    this.s3 = new S3Client({
      region: this.config.get<string>('AWS_REGION', 'us-east-1'),
    });
  }

  async runRetention(): Promise<AuditRetentionRunResult> {
    const result: AuditRetentionRunResult = {
      enabled: this.enabled,
      archived: 0,
      deletedFromPrimary: 0,
      deletedExpiredArchives: 0,
    };
    if (!this.enabled) return result;

    for (const table of SOURCE_TABLES) {
      for (let page = 0; page < 10; page += 1) {
        const rows = (await this.dataSource.query(
          `SELECT source.*, source."${table.timestamp}" AS source_created_at
           FROM "${table.name}" source
           WHERE source."retention_until" > now()
             AND source."log_type" <> 'debug'
             AND source."${table.timestamp}" <= now() - ($1 * interval '1 day')
             AND NOT EXISTS (
               SELECT 1 FROM "audit_archive_records" archived
               WHERE archived."source_table" = $2 AND archived."source_id" = source."id"
             )
           ORDER BY source."${table.timestamp}" ASC
           LIMIT $3`,
          [this.hotRetentionDays, table.name, ARCHIVE_BATCH_SIZE],
        )) as AuditSourceRow[];

        for (const row of rows) {
          await this.archiveSourceRow(table.name, row);
          result.archived += 1;
          result.deletedFromPrimary += 1;
          this.archivedCounter.inc({ log_type: row.log_type });
        }
        if (rows.length < ARCHIVE_BATCH_SIZE) break;
      }

      const expiredRows: Array<{ count: string }> = await this.dataSource.query(
        `WITH expired AS (
           DELETE FROM "${table.name}"
           WHERE "retention_until" <= now()
           RETURNING 1
         )
         SELECT count(*)::text AS count FROM expired`,
      );
      result.deletedFromPrimary += Number(expiredRows[0]?.count ?? 0);
    }

    result.deletedExpiredArchives = await this.purgeExpiredArchives();
    this.runsCounter.inc({ status: 'success' });
    this.lastSuccessTimestamp.set(Date.now() / 1000);
    this.logger.log(`Audit retention run completed: ${JSON.stringify(result)}`);
    return result;
  }

  async listArchives(limit: number): Promise<AuditArchiveRecord[]> {
    return this.archiveRepository.find({
      order: { sourceCreatedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  async listRetrievalRequests(
    limit: number,
    status: string = 'pending',
  ): Promise<AuditArchiveRetrievalRequest[]> {
    const validStatuses: AuditArchiveRetrievalStatus[] = [
      'pending',
      'approved',
      'fulfilled',
    ];
    const requestedStatus = validStatuses.find(
      (validStatus) => validStatus === status,
    );
    if (!requestedStatus) {
      throw new BadRequestException('Invalid retrieval request status.');
    }
    return this.requestRepository.find({
      where: { status: requestedStatus },
      order: { requestedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  async requestRetrieval(
    archiveRecordId: string,
    requesterId: string,
    reason: string,
  ): Promise<AuditArchiveRetrievalRequest> {
    if (!reason?.trim() || reason.trim().length < 10 || reason.length > 1000) {
      throw new BadRequestException(
        'A retrieval reason between 10 and 1000 characters is required.',
      );
    }
    const archiveRecord = await this.archiveRepository.findOneBy({
      id: archiveRecordId,
    });
    if (!archiveRecord || archiveRecord.retentionUntil <= new Date()) {
      throw new NotFoundException('Retained audit archive not found.');
    }

    return this.requestRepository.save(
      this.requestRepository.create({
        archiveRecordId,
        requesterId,
        reason: reason.trim(),
      }),
    );
  }

  async approveRetrieval(
    requestId: string,
    approverId: string,
  ): Promise<AuditArchiveRetrievalRequest> {
    const request = await this.requestRepository.findOneBy({ id: requestId });
    if (!request) {
      throw new NotFoundException('Audit archive retrieval request not found.');
    }
    if (request.status !== 'pending') {
      throw new ConflictException('Retrieval request is not pending approval.');
    }
    if (request.requesterId === approverId) {
      throw new BadRequestException(
        'A different administrator must approve this retrieval.',
      );
    }

    request.status = 'approved';
    request.approverId = approverId;
    request.approvedAt = new Date();
    return this.requestRepository.save(request);
  }

  async retrieveApproved(
    requestId: string,
    adminId: string,
  ): Promise<
    | { status: 'restoring'; requestId: string }
    | { status: 'fulfilled'; record: Record<string, unknown> }
  > {
    const request = await this.requestRepository.findOneBy({ id: requestId });
    if (!request || request.status === 'pending') {
      throw new NotFoundException(
        'Approved audit archive retrieval request not found.',
      );
    }
    if (request.status === 'fulfilled') {
      throw new ConflictException('This retrieval request was already fulfilled.');
    }
    const archiveRecord = await this.archiveRepository.findOneBy({
      id: request.archiveRecordId,
    });
    if (!archiveRecord || archiveRecord.retentionUntil <= new Date()) {
      throw new NotFoundException('Retained audit archive not found.');
    }

    const head = await this.s3.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: archiveRecord.storageKey,
        VersionId: archiveRecord.versionId,
      }),
    );
    if ((head.StorageClass ?? '').includes('GLACIER')) {
      if (head.Restore?.includes('ongoing-request="true"')) {
        return { status: 'restoring', requestId };
      }
      const restoreIsReady =
        head.Restore?.includes('ongoing-request="false"') ?? false;
      if (!restoreIsReady) {
        try {
          await this.s3.send(
            new RestoreObjectCommand({
              Bucket: this.bucket,
              Key: archiveRecord.storageKey,
              VersionId: archiveRecord.versionId,
              RestoreRequest: {
                Days: 1,
                GlacierJobParameters: { Tier: 'Standard' },
              },
            }),
          );
        } catch (error) {
          if (
            !(error instanceof Error) ||
            error.name !== 'RestoreAlreadyInProgress'
          ) {
            throw error;
          }
        }
        return { status: 'restoring', requestId };
      }
    }

    const object = await this.s3.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: archiveRecord.storageKey,
        VersionId: archiveRecord.versionId,
      }),
    );
    if (!object.Body) {
      throw new ServiceUnavailableException('Archived audit object has no body.');
    }
    const content = Buffer.from(await object.Body.transformToByteArray());
    const checksum = createHash('sha256').update(content).digest('hex');
    if (checksum !== archiveRecord.checksum) {
      throw new ServiceUnavailableException(
        'Archived audit object failed its integrity check.',
      );
    }

    const persistedAudit = await this.auditService.logEvent({
      actorId: adminId,
      actorRole: 'admin',
      route: 'GET /api/v1/admin/audit-archive-retrievals/:id',
      statusCode: 200,
      logType: 'operational',
      retentionUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      requestDetails: {
        archiveRecordId: archiveRecord.id,
        retrievalRequestId: request.id,
        requesterId: request.requesterId,
        approverId: request.approverId,
        reason: request.reason,
      },
    });
    if (!persistedAudit) {
      throw new ServiceUnavailableException(
        'Could not persist the audit record for archive retrieval.',
      );
    }

    request.status = 'fulfilled';
    request.fulfilledAt = new Date();
    await this.requestRepository.save(request);
    return {
      status: 'fulfilled',
      record: JSON.parse(content.toString('utf8')) as Record<string, unknown>,
    };
  }

  recordFailedRun(): void {
    this.runsCounter.inc({ status: 'failure' });
  }

  async complianceReport(): Promise<{
    policy: Record<AuditLogType, string>;
    archivedRecords: Array<{ logType: AuditLogType; count: string }>;
    pendingRetrievalRequests: number;
    expiredArchiveRecords: number;
    expiredPrimaryRecords: Array<{ sourceTable: string; count: string }>;
  }> {
    const archivedRecords = await this.archiveRepository
      .createQueryBuilder('archive')
      .select('archive.logType', 'logType')
      .addSelect('COUNT(*)::text', 'count')
      .groupBy('archive.logType')
      .getRawMany<{ logType: AuditLogType; count: string }>();
    const pendingRetrievalRequests = await this.requestRepository.countBy({
      status: 'pending',
    });
    const expiredArchiveRecords = await this.archiveRepository.countBy({
      retentionUntil: LessThanOrEqual(new Date()),
    });
    const expiredPrimaryRecords: Array<{
      sourceTable: string;
      count: string;
    }> = [];
    for (const table of SOURCE_TABLES) {
      const rows = await this.dataSource.query(
        `SELECT count(*)::text AS count
         FROM "${table.name}" WHERE "retention_until" <= now()`,
      );
      expiredPrimaryRecords.push({
        sourceTable: table.name,
        count: rows[0].count,
      });
    }
    return {
      policy: {
        financial_transaction: '7 years',
        kyc_document: '5 years',
        operational: '1 year',
        debug: '90 days',
      },
      archivedRecords,
      pendingRetrievalRequests,
      expiredArchiveRecords,
      expiredPrimaryRecords,
    };
  }

  private async archiveSourceRow(
    sourceTable: string,
    row: AuditSourceRow,
  ): Promise<void> {
    const storageKey = `audit-logs/${row.log_type}/${row.id}.json`;
    const content = Buffer.from(JSON.stringify(row));
    const checksum = createHash('sha256').update(content).digest('hex');
    const retentionUntil = new Date(row.retention_until);

    const putResult = await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        Body: content,
        ContentType: 'application/json',
        StorageClass: 'GLACIER',
        ChecksumSHA256: createHash('sha256').update(content).digest('base64'),
        Metadata: { sha256: checksum, logType: row.log_type },
        ObjectLockMode: 'COMPLIANCE',
        ObjectLockRetainUntilDate: retentionUntil,
      }),
    );
    if (!putResult.VersionId) {
      throw new ServiceUnavailableException(
        'Audit archive bucket must have versioning enabled.',
      );
    }
    const storedObject = await this.s3.send(
      new HeadObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        VersionId: putResult.VersionId,
      }),
    );
    if (
      storedObject.Metadata?.sha256 !== checksum ||
      storedObject.ObjectLockMode !== 'COMPLIANCE' ||
      !storedObject.ObjectLockRetainUntilDate ||
      storedObject.ObjectLockRetainUntilDate < retentionUntil
    ) {
      throw new ServiceUnavailableException(
        `S3 archive integrity or retention verification failed for ${sourceTable}/${row.id}.`,
      );
    }

    await this.dataSource.query(
      `INSERT INTO "audit_archive_records"
         ("source_table", "source_id", "log_type", "source_created_at",
          "retention_until", "storage_key", "version_id", "checksum")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT ("source_table", "source_id") DO NOTHING`,
      [
        sourceTable,
        row.id,
        row.log_type,
        row.source_created_at,
        retentionUntil,
        storageKey,
        putResult.VersionId,
        checksum,
      ],
    );
    await this.dataSource.query(
      `DELETE FROM "${sourceTable}" WHERE "id" = $1 AND "retention_until" > now()`,
      [row.id],
    );
  }

  private async purgeExpiredArchives(): Promise<number> {
    const expiredRecords = await this.archiveRepository
      .createQueryBuilder('archive')
      .where('archive.retentionUntil <= now()')
      .orderBy('archive.retentionUntil', 'ASC')
      .take(ARCHIVE_BATCH_SIZE)
      .getMany();
    let deleted = 0;
    for (const archiveRecord of expiredRecords) {
      await this.s3.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: archiveRecord.storageKey,
          VersionId: archiveRecord.versionId,
        }),
      );
      await this.archiveRepository.delete({ id: archiveRecord.id });
      deleted += 1;
    }
    return deleted;
  }
}
