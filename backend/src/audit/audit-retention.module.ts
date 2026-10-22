import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  makeCounterProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from './audit.module';
import { AuditRetentionController } from './audit-retention.controller';
import { AuditRetentionCronService } from './audit-retention-cron.service';
import { AuditRetentionService } from './audit-retention.service';
import { AuditArchiveRecord } from './entities/audit-archive-record.entity';
import { AuditArchiveRetrievalRequest } from './entities/audit-archive-retrieval-request.entity';

@Module({
  imports: [
    AuthModule,
    AuditModule,
    TypeOrmModule.forFeature([
      AuditArchiveRecord,
      AuditArchiveRetrievalRequest,
    ]),
  ],
  controllers: [AuditRetentionController],
  providers: [
    AuditRetentionService,
    AuditRetentionCronService,
    makeCounterProvider({
      name: 'audit_retention_archived_total',
      help: 'Audit records archived to S3 Glacier and removed from the primary database.',
      labelNames: ['log_type'],
    }),
    makeCounterProvider({
      name: 'audit_retention_runs_total',
      help: 'Scheduled audit retention runs by outcome.',
      labelNames: ['status'],
    }),
    makeGaugeProvider({
      name: 'audit_retention_job_last_success_timestamp_seconds',
      help: 'Unix timestamp of the last successful audit retention run.',
    }),
  ],
  exports: [AuditRetentionService],
})
export class AuditRetentionModule {}
