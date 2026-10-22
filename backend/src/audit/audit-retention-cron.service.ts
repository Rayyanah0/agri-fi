import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuditRetentionService } from './audit-retention.service';

@Injectable()
export class AuditRetentionCronService {
  private readonly logger = new Logger(AuditRetentionCronService.name);

  constructor(private readonly retentionService: AuditRetentionService) {}

  @Cron('0 2 * * *', { timeZone: 'UTC' })
  async runDailyAuditRetention(): Promise<void> {
    try {
      const result = await this.retentionService.runRetention();
      if (result.enabled) {
        this.logger.log(`Daily audit retention completed: ${JSON.stringify(result)}`);
      }
    } catch (error) {
      this.retentionService.recordFailedRun();
      const err = error as Error;
      this.logger.error(
        `Daily audit retention failed: ${err.message}`,
        err.stack,
      );
    }
  }
}
