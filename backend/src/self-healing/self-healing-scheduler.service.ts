import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Gauge } from 'prom-client';

import { SelfHealingService } from './self-healing.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SelfHealingIssue } from './entities/self-healing-issue.entity';

/**
 * SelfHealingSchedulerService
 *
 * Drives the self-healing loop. The detection cycle runs every five minutes
 * so that a failed pod is recovered within minutes instead of waiting for a
 * human to notice the alert.
 */
@Injectable()
export class SelfHealingSchedulerService {
  private readonly logger = new Logger(SelfHealingSchedulerService.name);
  private isRunning = false;

  constructor(
    private readonly selfHealingService: SelfHealingService,
    @InjectRepository(SelfHealingIssue)
    private readonly issueRepo: Repository<SelfHealingIssue>,
    @InjectMetric('self_healing_active_issues')
    private readonly activeIssuesGauge: Gauge<string>,
  ) {}

  /**
   * Detect issues and remediate them.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async runDetectionCycle(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn(
        'The previous self-healing cycle is still running. Skipping this cycle.',
      );
      return;
    }

    this.isRunning = true;
    try {
      await this.selfHealingService.runDetectionCycle();
      await this.refreshActiveIssuesGauge();
    } catch (error) {
      this.logger.error(
        `Self-healing cycle failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Refresh the gauge that exposes the number of open issues.
   */
  private async refreshActiveIssuesGauge(): Promise<void> {
    try {
      const issues = await this.issueRepo.find({
        where: [
          { status: 'detected' },
          { status: 'diagnosed' },
          { status: 'remediating' },
        ],
      });

      const counts = new Map<string, number>();
      for (const issue of issues) {
        counts.set(issue.issueType, (counts.get(issue.issueType) ?? 0) + 1);
      }

      this.activeIssuesGauge.reset();
      for (const [issueType, count] of counts.entries()) {
        this.activeIssuesGauge.set({ issueType }, count);
      }
    } catch (error) {
      this.logger.warn(
        `Unable to refresh the active issue gauge: ${(error as Error).message}`,
      );
    }
  }
}
