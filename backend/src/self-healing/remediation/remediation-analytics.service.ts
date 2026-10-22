import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';

import { RemediationAction } from '../entities/remediation-action.entity';
import { SelfHealingIssue } from '../entities/self-healing-issue.entity';
import {
  DEFAULT_BASELINE_MTTR_MINUTES,
  MANUAL_EFFORT_MINUTES,
} from './remediation.constants';
import type { RemediationActionType } from '../entities/remediation-action.entity';

/** Aggregated analytics for a time window. */
export interface RemediationAnalytics {
  window: { from: string; to: string };
  totals: {
    issuesDetected: number;
    issuesRemediated: number;
    issuesFailed: number;
    issuesFalsePositive: number;
    actionsTotal: number;
    actionsSucceeded: number;
    actionsFailed: number;
    actionsSkipped: number;
    actionsPendingApproval: number;
    actionsBlocked: number;
    successRate: number;
    failureRate: number;
    falsePositiveRate: number;
    averageMttrMinutes: number;
    baselineMttrMinutes: number;
    mttrReductionPercent: number;
    totalTimeSavedMinutes: number;
  };
  byActionType: Array<{
    actionType: RemediationActionType;
    total: number;
    succeeded: number;
    failed: number;
    successRate: number;
  }>;
  byIssueType: Array<{
    issueType: string;
    total: number;
    remediated: number;
    failed: number;
    falsePositives: number;
    successRate: number;
  }>;
}

/**
 * RemediationAnalyticsService
 *
 * Turns the remediation history into the numbers the platform team reviews:
 * how often the automation succeeds, how much downtime it removes and how
 * often it reacts to something that was not a real problem.
 */
@Injectable()
export class RemediationAnalyticsService {
  private readonly logger = new Logger(RemediationAnalyticsService.name);

  constructor(
    @InjectRepository(RemediationAction)
    private readonly remediationActionRepo: Repository<RemediationAction>,
    @InjectRepository(SelfHealingIssue)
    private readonly issueRepo: Repository<SelfHealingIssue>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Compute the analytics for a time window (defaults to the last 30 days).
   */
  async compute(hours = 24 * 30): Promise<RemediationAnalytics> {
    const to = new Date();
    const from = new Date(to.getTime() - hours * 60 * 60 * 1000);

    const [actions, issues] = await Promise.all([
      this.remediationActionRepo.find({
        where: { createdAt: Between(from, to) },
      }),
      this.issueRepo.find({
        where: { detectedAt: Between(from, to) },
      }),
    ]);

    const baselineMttr = parseInt(
      this.configService.get<string>(
        'SELF_HEALING_BASELINE_MTTR_MINUTES',
        String(DEFAULT_BASELINE_MTTR_MINUTES),
      ),
      10,
    );

    const succeeded = actions.filter(
      (action) => action.status === 'success',
    ).length;
    const failed = actions.filter(
      (action) => action.status === 'failed',
    ).length;
    const skipped = actions.filter(
      (action) => action.status === 'skipped',
    ).length;
    const pendingApproval = actions.filter(
      (action) => action.status === 'pending_approval',
    ).length;
    const blocked = actions.filter(
      (action) => action.safetyDecision === 'blocked',
    ).length;

    const remediatedIssues = issues.filter(
      (issue) => issue.status === 'remediated',
    );
    const failedIssues = issues.filter((issue) => issue.status === 'failed');
    const falsePositives = issues.filter(
      (issue) => issue.status === 'false_positive',
    );

    const mttrSamples = remediatedIssues
      .map((issue) => this.computeMttrMinutes(issue))
      .filter((minutes): minutes is number => minutes !== null);

    const averageMttrMinutes =
      mttrSamples.length > 0
        ? mttrSamples.reduce((sum, value) => sum + value, 0) /
          mttrSamples.length
        : 0;

    const mttrReductionPercent =
      averageMttrMinutes > 0
        ? Math.max(
            0,
            Math.min(
              100,
              ((baselineMttr - averageMttrMinutes) / baselineMttr) * 100,
            ),
          )
        : 0;

    const totalTimeSavedMinutes = this.computeTimeSavedMinutes(
      actions,
      remediatedIssues,
      baselineMttr,
    );

    const executed = succeeded + failed;

    return {
      window: { from: from.toISOString(), to: to.toISOString() },
      totals: {
        issuesDetected: issues.length,
        issuesRemediated: remediatedIssues.length,
        issuesFailed: failedIssues.length,
        issuesFalsePositive: falsePositives.length,
        actionsTotal: actions.length,
        actionsSucceeded: succeeded,
        actionsFailed: failed,
        actionsSkipped: skipped,
        actionsPendingApproval: pendingApproval,
        actionsBlocked: blocked,
        successRate: executed > 0 ? succeeded / executed : 0,
        failureRate: executed > 0 ? failed / executed : 0,
        falsePositiveRate:
          issues.length > 0 ? falsePositives.length / issues.length : 0,
        averageMttrMinutes: Number(averageMttrMinutes.toFixed(2)),
        baselineMttrMinutes: baselineMttr,
        mttrReductionPercent: Number(mttrReductionPercent.toFixed(2)),
        totalTimeSavedMinutes: Number(totalTimeSavedMinutes.toFixed(2)),
      },
      byActionType: this.groupByActionType(actions),
      byIssueType: this.groupByIssueType(issues),
    };
  }

  /**
   * Mean time to recovery of a single issue, in minutes.
   */
  private computeMttrMinutes(issue: SelfHealingIssue): number | null {
    if (!issue.resolvedAt) {
      return null;
    }
    return (issue.resolvedAt.getTime() - issue.detectedAt.getTime()) / 60_000;
  }

  /**
   * Estimate the manual time that the successful actions replaced.
   *
   * For an action that is linked to a measured issue the saving is the
   * difference between the baseline mean time to recovery and the time the
   * automation actually needed. Actions without a measured issue fall back
   * to the manual effort the action type replaces.
   */
  private computeTimeSavedMinutes(
    actions: RemediationAction[],
    remediatedIssues: SelfHealingIssue[],
    baselineMttr: number,
  ): number {
    const mttrByIssue = new Map<string, number>();
    for (const issue of remediatedIssues) {
      const mttr = this.computeMttrMinutes(issue);
      if (mttr !== null) {
        mttrByIssue.set(issue.id, mttr);
      }
    }

    return actions
      .filter((action) => action.status === 'success')
      .reduce((total, action) => {
        const issueMttr = action.issueId
          ? mttrByIssue.get(action.issueId)
          : undefined;

        if (issueMttr !== undefined) {
          return total + Math.max(0, baselineMttr - issueMttr);
        }

        if (action.timeSavedMs !== null && action.timeSavedMs !== undefined) {
          return total + action.timeSavedMs / 60_000;
        }

        return total + (MANUAL_EFFORT_MINUTES[action.actionType] ?? 0);
      }, 0);
  }

  /**
   * Aggregate the actions per action type.
   */
  private groupByActionType(
    actions: RemediationAction[],
  ): RemediationAnalytics['byActionType'] {
    const groups = new Map<RemediationActionType, RemediationAction[]>();

    for (const action of actions) {
      const bucket = groups.get(action.actionType) ?? [];
      bucket.push(action);
      groups.set(action.actionType, bucket);
    }

    return Array.from(groups.entries())
      .map(([actionType, bucket]) => {
        const succeeded = bucket.filter(
          (action) => action.status === 'success',
        ).length;
        const failed = bucket.filter(
          (action) => action.status === 'failed',
        ).length;
        const executed = succeeded + failed;

        return {
          actionType,
          total: bucket.length,
          succeeded,
          failed,
          successRate: executed > 0 ? succeeded / executed : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  }

  /**
   * Aggregate the issues per issue type.
   */
  private groupByIssueType(
    issues: SelfHealingIssue[],
  ): RemediationAnalytics['byIssueType'] {
    const groups = new Map<string, SelfHealingIssue[]>();

    for (const issue of issues) {
      const bucket = groups.get(issue.issueType) ?? [];
      bucket.push(issue);
      groups.set(issue.issueType, bucket);
    }

    return Array.from(groups.entries())
      .map(([issueType, bucket]) => {
        const remediated = bucket.filter(
          (issue) => issue.status === 'remediated',
        ).length;
        const failed = bucket.filter(
          (issue) => issue.status === 'failed',
        ).length;
        const falsePositives = bucket.filter(
          (issue) => issue.status === 'false_positive',
        ).length;
        const executed = remediated + failed;

        return {
          issueType,
          total: bucket.length,
          remediated,
          failed,
          falsePositives,
          successRate: executed > 0 ? remediated / executed : 0,
        };
      })
      .sort((a, b) => b.total - a.total);
  }
}
