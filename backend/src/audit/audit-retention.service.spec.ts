import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { Counter, Gauge } from 'prom-client';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { AuditService } from './audit.service';
import { AuditRetentionService } from './audit-retention.service';
import { AuditArchiveRecord } from './entities/audit-archive-record.entity';
import { AuditArchiveRetrievalRequest } from './entities/audit-archive-retrieval-request.entity';

describe('AuditRetentionService', () => {
  let sendSpy: jest.SpyInstance;
  let dataSource: { query: jest.Mock };
  let archiveRepository: {
    createQueryBuilder: jest.Mock;
  };
  let requestRepository: {
    findOneBy: jest.Mock;
    save: jest.Mock;
  };
  let config: { get: jest.Mock };
  let auditService: { logEvent: jest.Mock };
  let archivedCounter: { inc: jest.Mock };
  let runsCounter: { inc: jest.Mock };
  let lastSuccessTimestamp: { set: jest.Mock };

  beforeEach(() => {
    dataSource = { query: jest.fn() };
    archiveRepository = {
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    };
    requestRepository = {
      findOneBy: jest.fn(),
      save: jest.fn(async (request) => request),
    };
    config = {
      get: jest.fn((key: string, fallback: unknown) => {
        if (key === 'AUDIT_RETENTION_ENABLED') return 'true';
        if (key === 'AUDIT_ARCHIVE_S3_BUCKET') return 'audit-archive';
        return fallback;
      }),
    };
    auditService = { logEvent: jest.fn() };
    archivedCounter = { inc: jest.fn() };
    runsCounter = { inc: jest.fn() };
    lastSuccessTimestamp = { set: jest.fn() };
    sendSpy = jest.spyOn(S3Client.prototype, 'send');
  });

  afterEach(() => sendSpy.mockRestore());

  function createService(): AuditRetentionService {
    return new AuditRetentionService(
      config as unknown as ConfigService,
      dataSource as unknown as DataSource,
      auditService as unknown as AuditService,
      archiveRepository as unknown as Repository<AuditArchiveRecord>,
      requestRepository as unknown as Repository<AuditArchiveRetrievalRequest>,
      archivedCounter as unknown as Counter<string>,
      runsCounter as unknown as Counter<string>,
      lastSuccessTimestamp as unknown as Gauge<string>,
    );
  }

  it('does not query or modify the database when disabled', async () => {
    config.get.mockImplementation((key: string, fallback: unknown) =>
      key === 'AUDIT_RETENTION_ENABLED' ? false : fallback,
    );
    const result = await createService().runRetention();

    expect(result).toEqual({
      enabled: false,
      archived: 0,
      deletedFromPrimary: 0,
      deletedExpiredArchives: 0,
    });
    expect(dataSource.query).not.toHaveBeenCalled();
  });

  it('verifies a Glacier copy before recording and deleting its primary row', async () => {
    const row = {
      id: '9df05283-60c0-492f-9dc1-c7ab7320495d',
      log_type: 'financial_transaction',
      retention_until: '2031-01-01T00:00:00.000Z',
      source_created_at: '2024-01-01T00:00:00.000Z',
    };
    let selected = false;
    dataSource.query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT source.*')) {
        if (selected) return [];
        selected = true;
        return [row];
      }
      if (sql.includes('WITH expired')) return [{ count: '0' }];
      return [];
    });
    sendSpy.mockImplementation(async (command: { input?: any }) => {
      if (command instanceof PutObjectCommand) {
        return { VersionId: 'version-1' };
      }
      if (command instanceof HeadObjectCommand) {
        const putCommand = sendSpy.mock.calls.find(
          ([sent]) => sent instanceof PutObjectCommand,
        )?.[0] as PutObjectCommand;
        const checksum = createHash('sha256')
          .update(putCommand.input.Body as Buffer)
          .digest('hex');
        return {
          Metadata: { sha256: checksum },
          ObjectLockMode: 'COMPLIANCE',
          ObjectLockRetainUntilDate: new Date(row.retention_until),
        };
      }
      return {};
    });

    const result = await createService().runRetention();

    expect(result.archived).toBe(1);
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO "audit_archive_records"'),
      expect.arrayContaining(['system_audit_logs', row.id]),
    );
    expect(dataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM "system_audit_logs"'),
      [row.id],
    );
    expect(archivedCounter.inc).toHaveBeenCalledWith({
      log_type: 'financial_transaction',
    });
    expect(runsCounter.inc).toHaveBeenCalledWith({ status: 'success' });
    expect(lastSuccessTimestamp.set).toHaveBeenCalledWith(expect.any(Number));
  });

  it('requires a different administrator to approve a retrieval', async () => {
    requestRepository.findOneBy.mockResolvedValue({
      id: 'request-1',
      requesterId: 'admin-1',
      status: 'pending',
    });

    await expect(
      createService().approveRetrieval('request-1', 'admin-1'),
    ).rejects.toThrow('A different administrator must approve this retrieval.');

    const request = {
      id: 'request-1',
      requesterId: 'admin-1',
      status: 'pending',
      approvedAt: null,
      approverId: null,
    };
    requestRepository.findOneBy.mockResolvedValue(request);

    await expect(
      createService().approveRetrieval('request-1', 'admin-2'),
    ).resolves.toMatchObject({
      status: 'approved',
      approverId: 'admin-2',
    });
  });
});
