import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';

import {
  IssueDetectorService,
  DetectedIssue,
} from './detection/issue-detector.service';
import { RootCauseAnalysisService } from './diagnosis/root-cause.service';
import { SafetyCheckService } from './remediation/safety-check.service';
import { RemediationHistoryService } from './remediation/remediation-history.service';
import { RemediationNotificationService } from './remediation/remediation-notification.service';
import { CustomScriptService } from './remediation/custom-script.service';
import { MANUAL_EFFORT_MINUTES } from './remediation/remediation.constants';
import {
  ExecutorOptions,
  ExecutorResult,
  INFRASTRUCTURE_EXECUTOR,
  InfrastructureExecutor,
} from './remediation/infrastructure-executor';
import { SelfHealingIssue } from './entities/self-healing-issue.entity';
import {
  RemediationAction,
  RemediationActionType,
} from './entities/remediation-action.entity';
import { RemediationPolicy } from './entities/remediation-policy.entity';
import type { SelfHealingIssueStatus } from './entities/self-healing-issue.entity';

/** Summary of one detection and remediation cycle. */
export interface SelfHealingCycleResult {
  detected: number;
  newIssues: number;
  recurringIssues: number;
  remediated: number;
  blocked: number;
  pendingApproval: number;
  failed: number;
  falsePositives: number;
}

/** Options for a manually triggered remediation. */
export interface ManualRemediationOptions {
  actorId: string;
  triggerSource?: 'api' | 'manual';
}

/** Outcome of a single remediation attempt. */
export type RemediationOutcome =
  'remediated' | 'blocked' | 'pending_approval' | 'failed' | 'skipped';

/**
 * SelfHealingService
 *
 * Orchestrates the whole self-healing loop:
 *
 *   detect → diagnose → plan → safety check → execute → verify → notify
 *
 * Every step is recorded so that the platform team can audit what the
 * automation did and measure how much downtime it removed.
 */
@Injectable()
export class SelfHealingService {
  private readonly logger = new Logger(SelfHealingService.name);
  private readonly namespace: string;
  private readonly actionTimeoutMs: number;
  private readonly minReplicas: number;
  private readonly maxReplicas: number;

  constructor(
    @InjectRepository(SelfHealingIssue)
    private readonly issueRepo: Repository<SelfHealingIssue>,
    @InjectRepository(RemediationAction)
    private readonly remediationActionRepo: Repository<RemediationAction>,
    @InjectRepository(RemediationPolicy)
    private readonly policyRepo: Repository<RemediationPolicy>,
    private readonly detectorService: IssueDetectorService,
    private readonly rootCauseService: RootCauseAnalysisService,
    private readonly safetyCheckService: SafetyCheckService,
    private readonly historyService: RemediationHistoryService,
    private readonly notificationService: RemediationNotificationService,
    private readonly customScriptService: CustomScriptService,
    private readonly configService: ConfigService,
    @Inject(INFRASTRUCTURE_EXECUTOR)
    private readonly executor: InfrastructureExecutor,
    @InjectMetric('self_healing_issues_detected_total')
    private readonly issuesDetectedCounter: Counter<string>,
    @InjectMetric('self_healing_remediations_total')
    private readonly remediationsCounter: Counter<string>,
  ) {
    this.namespace = this.configService.get<string>(
      'SELF_HEALING_NAMESPACE',
      'agri-fi',
    );
    this.actionTimeoutMs = parseInt(
      this.configService.get<string>('SELF_HEALING_ACTION_TIMEOUT_MS', '60000'),
      10,
    );
    this.minReplicas = parseInt(
      this.configService.get<string>('SELF_HEALING_MIN_REPLICAS', '1'),
      10,
    );
    this.maxReplicas = parseInt(
      this.configService.get<string>('SELF_HEALING_MAX_REPLICAS', '10'),
      10,
    );
  }

  /**
   * True when the automation is enabled for the current environment.
   * Production requires an explicit opt-in.
   */
  isEnabled(): boolean {
    const configured = this.configService.get<string>('SELF_HEALING_ENABLED');
    if (configured !== undefined && configured !== '') {
      return configured === 'true';
    }
    return this.safetyCheckService.getEnvironment() !== 'production';
  }

  /**
   * Run a full detection and remediation cycle.
   */
  async runDetectionCycle(): Promise<SelfHealingCycleResult> {
    const result: SelfHealingCycleResult = {
      detected: 0,
      newIssues: 0,
      recurringIssues: 0,
      remediated: 0,
      blocked: 0,
      pendingApproval: 0,
      failed: 0,
      falsePositives: 0,
    };

    if (!this.isEnabled()) {
      this.logger.log('Self-healing automation is disabled. Skipping cycle.');
      return result;
    }

    const detected = await this.detectorService.detect();
    result.detected = detected.length;

    const seen = new Set<string>();
    for (const issue of detected) {
      seen.add(issue.fingerprint);
      const persisted = await this.persistDetection(issue);
      if (persisted.created) {
        result.newIssues += 1;
      } else {
        result.recurringIssues += 1;
      }
    }

    await this.resolveClearedIssues(seen, result);

    const openIssues = await this.issueRepo.find({
      where: { status: In<SelfHealingIssueStatus>(['detected', 'diagnosed']) },
    });

    for (const issue of openIssues) {
      const outcome = await this.remediateIssue(issue, {
        actorId: 'system',
        triggerSource: 'scheduler',
      });

      if (outcome === 'remediated') {
        result.remediated += 1;
      } else if (outcome === 'blocked') {
        result.blocked += 1;
      } else if (outcome === 'pending_approval') {
        result.pendingApproval += 1;
      } else if (outcome === 'failed') {
        result.failed += 1;
      }
    }

    this.logger.log(`Self-healing cycle finished: ${JSON.stringify(result)}`);

    return result;
  }

  /**
   * Create or refresh the issue row for a detected issue.
   */
  private async persistDetection(detected: DetectedIssue): Promise<{
    issue: SelfHealingIssue;
    created: boolean;
  }> {
    const existing = await this.issueRepo.findOne({
      where: { fingerprint: detected.fingerprint },
      order: { createdAt: 'DESC' },
    });

    if (existing && existing.status !== 'remediated') {
      existing.occurrences += 1;
      existing.lastSeenAt = detected.detectedAt;
      existing.severity = detected.severity;
      existing.metricsSnapshotJson = detected.metrics;
      existing.labelsJson = detected.labels;
      const updated = await this.issueRepo.save(existing);
      return { issue: updated, created: false };
    }

    const issue = this.issueRepo.create({
      fingerprint: detected.fingerprint,
      issueType: detected.issueType,
      severity: detected.severity,
      status: 'detected',
      component: detected.component,
      target: detected.target,
      description: detected.description,
      metricsSnapshotJson: detected.metrics,
      labelsJson: detected.labels,
      occurrences: 1,
      detectedAt: detected.detectedAt,
      lastSeenAt: detected.detectedAt,
      resolvedAt: null,
      rootCause: null,
      rootCauseConfidence: null,
      rootCauseEvidenceJson: null,
    });

    const saved = await this.issueRepo.save(issue);
    this.issuesDetectedCounter.inc({
      issue_type: detected.issueType,
      severity: detected.severity,
    });
    this.logger.warn(
      `Detected ${detected.issueType} on ${detected.target} (${detected.severity}).`,
    );

    return { issue: saved, created: true };
  }

  /**
   * Close the issues that are no longer detected.
   */
  private async resolveClearedIssues(
    seen: Set<string>,
    result: SelfHealingCycleResult,
  ): Promise<void> {
    const openIssues = await this.issueRepo.find({
      where: {
        status: In<SelfHealingIssueStatus>([
          'detected',
          'diagnosed',
          'remediating',
        ]),
      },
    });

    for (const issue of openIssues) {
      if (seen.has(issue.fingerprint)) {
        continue;
      }

      issue.resolvedAt = new Date();

      if (issue.status === 'detected' || issue.status === 'diagnosed') {
        issue.status = 'false_positive';
        result.falsePositives += 1;
        this.logger.log(
          `Issue ${issue.fingerprint} cleared without remediation and was recorded as a false positive.`,
        );
      }

      await this.issueRepo.save(issue);
    }
  }

  /**
   * Diagnose and remediate a single issue.
   */
  async remediateIssue(
    issue: SelfHealingIssue,
    options: ManualRemediationOptions,
  ): Promise<RemediationOutcome> {
    const analysis = await this.rootCauseService.analyse(issue);

    issue.status = 'diagnosed';
    issue.rootCause = analysis.rootCause;
    issue.rootCauseConfidence = analysis.confidence;
    issue.rootCauseEvidenceJson = analysis.evidence;
    await this.issueRepo.save(issue);

    const actionTypes = this.resolveActionTypes(analysis.recommendedActions);

    if (actionTypes.length === 0) {
      issue.status = 'skipped';
      issue.resolvedAt = new Date();
      await this.issueRepo.save(issue);
      this.logger.warn(
        `No automated remediation is available for issue ${issue.fingerprint}: ${analysis.rootCause}`,
      );
      return 'skipped';
    }

    let outcome: RemediationOutcome = 'skipped';

    for (const actionType of actionTypes) {
      const actionOutcome = await this.runAction(issue, actionType, options);
      if (actionOutcome === 'remediated') {
        outcome = 'remediated';
      } else if (outcome === 'skipped') {
        outcome = actionOutcome;
      }
    }

    if (outcome === 'remediated') {
      issue.status = 'remediated';
      issue.resolvedAt = new Date();
    } else if (outcome === 'failed') {
      issue.status = 'failed';
    } else if (outcome === 'blocked') {
      issue.status = 'skipped';
    }

    await this.issueRepo.save(issue);
    return outcome;
  }

  /**
   * Decide which remediation actions should be attempted.
   */
  private resolveActionTypes(
    recommended: RemediationActionType[],
  ): RemediationActionType[] {
    return recommended.filter((actionType) => actionType !== 'manual');
  }

  /**
   * Execute a single remediation action for an issue.
   */
  private async runAction(
    issue: SelfHealingIssue,
    actionType: RemediationActionType,
    options: ManualRemediationOptions,
  ): Promise<RemediationOutcome> {
    const environment = this.safetyCheckService.getEnvironment();
    const target = issue.target;
    const parameters = await this.buildParameters(issue, actionType);

    const script =
      actionType === 'custom_script'
        ? await this.customScriptService.findForIssueType(issue.issueType)
        : null;

    const decision = await this.safetyCheckService.evaluate({
      actionType,
      target,
      component: issue.component,
      issueType: issue.issueType,
      severity: issue.severity,
      environment,
      parameters,
      script: script
        ? {
            requiresApproval: script.requiresApproval,
            destructive: script.destructive,
            allowedEnvironments: script.allowedEnvironmentsJson ?? [],
          }
        : null,
    });

    const action = await this.historyService.record({
      issueId: issue.id,
      actionType,
      target,
      component: issue.component,
      parametersJson: parameters,
      status: decision.blocked
        ? 'skipped'
        : decision.requiresApproval
          ? 'pending_approval'
          : 'approved',
      safetyDecision: decision.blocked
        ? 'blocked'
        : decision.requiresApproval
          ? 'approval_required'
          : 'allowed',
      safetyReasonsJson: decision.reasons,
      policyName: decision.policyName,
      executedBy: options.actorId,
      triggerSource: options.triggerSource ?? 'scheduler',
      environment,
    });

    if (!action) {
      return 'failed';
    }

    if (decision.blocked) {
      this.remediationsCounter.inc({
        action_type: actionType,
        status: 'blocked',
      });
      await this.notificationService.notifyBlocked(issue, action);
      return 'blocked';
    }

    if (decision.requiresApproval) {
      this.remediationsCounter.inc({
        action_type: actionType,
        status: 'pending_approval',
      });
      await this.notificationService.notifyBlocked(issue, action);
      return 'pending_approval';
    }

    return this.executeAction(issue, action, script);
  }

  /**
   * Execute an approved remediation action.
   */
  async executeAction(
    issue: SelfHealingIssue | null,
    action: RemediationAction,
    script: Awaited<
      ReturnType<CustomScriptService['findForIssueType']>
    > | null = null,
  ): Promise<RemediationOutcome> {
    if (issue) {
      issue.status = 'remediating';
      await this.issueRepo.save(issue);
    }

    const startedAt = new Date();
    await this.historyService.update(action.id, {
      status: 'executing',
      startedAt,
    });

    await this.notificationService.notifyStarted(issue, action);

    const executorOptions: ExecutorOptions = {
      namespace: this.resolveNamespace(action.target),
      timeoutMs: this.actionTimeoutMs,
      dryRun: false,
    };

    let result: ExecutorResult;

    try {
      if (action.actionType === 'custom_script') {
        result = script
          ? await this.executeScript(script, action)
          : {
              success: false,
              message:
                'No remediation script is registered for this issue type.',
            };
      } else if (!this.executor.supports(action.actionType)) {
        // The executor cannot perform the action; fall back to a registered
        // custom script for the issue type (for example the disk cleanup).
        const fallbackScript = issue
          ? await this.customScriptService.findForIssueType(issue.issueType)
          : null;

        result = fallbackScript
          ? await this.executeScript(fallbackScript, action)
          : {
              success: false,
              unsupported: true,
              message: `The ${this.executor.name} executor does not support the "${action.actionType}" action and no remediation script is registered for ${issue?.issueType ?? 'this issue type'}.`,
            };
      } else {
        result = await this.executeWithExecutor(action, executorOptions);
      }
    } catch (error) {
      result = {
        success: false,
        message: (error as Error).message,
      };
    }

    const completedAt = new Date();
    const durationMs = completedAt.getTime() - startedAt.getTime();

    const updated = await this.historyService.update(action.id, {
      status: result.success ? 'success' : 'failed',
      completedAt,
      durationMs,
      output: result.success ? result.message : null,
      errorMessage: result.success ? null : result.message,
      timeSavedMs: result.success ? this.estimateTimeSaved(action) : null,
    });

    const finalAction = updated ?? action;
    this.remediationsCounter.inc({
      action_type: action.actionType,
      status: result.success ? 'success' : 'failed',
    });
    await this.notificationService.notifyCompleted(issue, finalAction);

    if (result.success) {
      await this.markPolicyAsValidated(action);
      return 'remediated';
    }

    return 'failed';
  }

  /**
   * Run the action through the infrastructure executor.
   */
  private async executeWithExecutor(
    action: RemediationAction,
    options: ExecutorOptions,
  ): Promise<ExecutorResult> {
    if (!this.executor.supports(action.actionType)) {
      return {
        success: false,
        unsupported: true,
        message: `The ${this.executor.name} executor does not support the "${action.actionType}" action.`,
      };
    }

    const parameters = action.parametersJson ?? {};

    switch (action.actionType) {
      case 'restart_pod':
        return this.executor.restartPod(action.target, options);
      case 'restart_service':
        return this.executor.restartService(action.target, options);
      case 'cleanup_disk':
        return this.executor.cleanupDisk(action.target, options);
      case 'scale_up':
      case 'scale_down':
        return this.executor.scaleDeployment(
          action.target,
          Number(parameters.replicas),
          options,
        );
      default:
        return {
          success: false,
          message: `Action type "${action.actionType}" cannot be executed automatically.`,
        };
    }
  }

  /**
   * Run a registered custom remediation script.
   */
  private async executeScript(
    script: NonNullable<
      Awaited<ReturnType<CustomScriptService['findForIssueType']>>
    >,
    action: RemediationAction,
  ): Promise<ExecutorResult> {
    const parameters = action.parametersJson ?? {};
    const args = Array.isArray(parameters.args)
      ? (parameters.args as string[])
      : [];

    const execution = await this.customScriptService.run(script, args);

    return {
      success: execution.success,
      message: execution.message,
      details: {
        exitCode: execution.exitCode,
        stdout: execution.stdout,
        stderr: execution.stderr,
      },
    };
  }

  /**
   * Approve a pending remediation action and execute it.
   */
  async approveAction(
    actionId: string,
    actorId: string,
  ): Promise<RemediationAction | null> {
    const action = await this.remediationActionRepo.findOne({
      where: { id: actionId },
    });

    if (!action) {
      return null;
    }

    if (action.status !== 'pending_approval') {
      return action;
    }

    await this.historyService.update(action.id, {
      status: 'approved',
      executedBy: actorId,
      triggerSource: 'api',
    });

    const issue = action.issueId
      ? await this.issueRepo.findOne({ where: { id: action.issueId } })
      : null;

    const script =
      action.actionType === 'custom_script' && issue
        ? await this.customScriptService.findForIssueType(issue.issueType)
        : null;

    const outcome = await this.executeAction(issue, action, script);

    if (issue) {
      if (outcome === 'remediated') {
        issue.status = 'remediated';
        issue.resolvedAt = new Date();
      } else if (outcome === 'failed') {
        issue.status = 'failed';
      }
      await this.issueRepo.save(issue);
    }

    return this.remediationActionRepo.findOne({ where: { id: action.id } });
  }

  /**
   * Reject a pending remediation action.
   */
  async rejectAction(
    actionId: string,
    actorId: string,
  ): Promise<RemediationAction | null> {
    const action = await this.remediationActionRepo.findOne({
      where: { id: actionId },
    });

    if (!action) {
      return null;
    }

    const updated = await this.historyService.update(action.id, {
      status: 'rejected',
      executedBy: actorId,
      triggerSource: 'api',
    });

    return updated ?? action;
  }

  /**
   * Build the parameters of an action (for example the replica count).
   */
  private async buildParameters(
    issue: SelfHealingIssue,
    actionType: RemediationActionType,
  ): Promise<Record<string, unknown>> {
    const parameters: Record<string, unknown> = {
      namespace: this.resolveNamespace(issue.target),
    };

    if (actionType === 'scale_up' || actionType === 'scale_down') {
      const current = await this.executor.getCurrentReplicas(issue.target);
      const base = current ?? this.minReplicas;
      const replicas =
        actionType === 'scale_up'
          ? base + 1
          : Math.max(this.minReplicas, base - 1);

      parameters.replicas = Math.min(replicas, this.maxReplicas);
      parameters.previousReplicas = current;
    }

    return parameters;
  }

  /**
   * Resolve the namespace of a target.
   */
  private resolveNamespace(target: string): string {
    const separator = target.indexOf('/');
    if (separator > 0) {
      return target.slice(0, separator);
    }
    return this.namespace;
  }

  /**
   * Estimate the manual time that a successful action replaced.
   */
  private estimateTimeSaved(action: RemediationAction): number {
    const minutes = MANUAL_EFFORT_MINUTES[action.actionType] ?? 0;
    return minutes * 60_000;
  }

  /**
   * A policy that succeeds in staging is considered validated and may then
   * also run in production.
   */
  private async markPolicyAsValidated(
    action: RemediationAction,
  ): Promise<void> {
    if (action.environment !== 'staging' || !action.policyName) {
      return;
    }

    const policy = await this.policyRepo.findOne({
      where: { name: action.policyName },
    });

    if (!policy || policy.stagingValidated) {
      return;
    }

    policy.stagingValidated = true;
    await this.policyRepo.save(policy);

    this.logger.log(
      `Policy "${policy.name}" succeeded in staging and is now allowed to run in production.`,
    );
  }
}
