import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RemediationHistoryService } from './remediation-history.service';
import { RemediationPolicy } from '../entities/remediation-policy.entity';
import type {
  RemediationActionType,
  RemediationEnvironment,
} from '../entities/remediation-action.entity';
import type {
  SelfHealingIssueType,
  SelfHealingSeverity,
} from '../entities/self-healing-issue.entity';

/** Input of a safety evaluation. */
export interface SafetyEvaluationInput {
  actionType: RemediationActionType;
  target: string;
  component?: string | null;
  issueType?: SelfHealingIssueType | null;
  severity?: SelfHealingSeverity | null;
  environment: RemediationEnvironment;
  parameters?: Record<string, unknown>;
  script?: {
    requiresApproval: boolean;
    destructive: boolean;
    allowedEnvironments: string[];
  } | null;
}

/** Outcome of a safety evaluation. */
export interface SafetyDecision {
  /** True when the action may run without human approval. */
  allowed: boolean;
  /** True when the action needs an explicit approval before it runs. */
  requiresApproval: boolean;
  /** True when the action must not run at all. */
  blocked: boolean;
  /** Every reason that contributed to the decision. */
  reasons: string[];
  policyName: string | null;
}

/** Action types that remove capacity or data. */
const DESTRUCTIVE_ACTIONS: RemediationActionType[] = [
  'cleanup_disk',
  'scale_down',
];

/**
 * Actions that always need an explicit approval in production when the
 * underlying issue is critical.
 */
const HIGH_RISK_ON_CRITICAL: RemediationActionType[] = [
  'scale_down',
  'cleanup_disk',
  'custom_script',
  'restart_service',
];

/**
 * Components that must never be remediated automatically in production.
 */
const PROTECTED_COMPONENTS = [
  'ledger',
  'settlement',
  'database',
  'postgres',
  'stellar',
  'rabbitmq',
];

/**
 * SafetyCheckService
 *
 * Every remediation action has to pass the safety evaluation before it is
 * executed. The evaluation combines the declarative policy stored in the
 * database with hard safety rails that cannot be disabled by configuration:
 *
 *  - protected components are never remediated automatically in production;
 *  - destructive actions always require an explicit approval in production;
 *  - critical issues require an approval for capacity or data changing
 *    actions;
 *  - a policy must have been validated in staging before it may run in
 *    production;
 *  - rate limits and cooldowns stop remediation loops.
 */
@Injectable()
export class SafetyCheckService {
  private readonly logger = new Logger(SafetyCheckService.name);

  constructor(
    @InjectRepository(RemediationPolicy)
    private readonly policyRepo: Repository<RemediationPolicy>,
    private readonly historyService: RemediationHistoryService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Resolve the environment the backend is running in.
   */
  getEnvironment(): RemediationEnvironment {
    return this.configService.get<string>('NODE_ENV') === 'production'
      ? 'production'
      : 'staging';
  }

  /**
   * Evaluate whether an action may be executed.
   */
  async evaluate(input: SafetyEvaluationInput): Promise<SafetyDecision> {
    const reasons: string[] = [];
    const blockers: string[] = [];

    const policy = await this.findPolicy(input);
    if (!policy) {
      blockers.push(
        `No remediation policy is registered for action type "${input.actionType}".`,
      );
      return {
        allowed: false,
        requiresApproval: false,
        blocked: true,
        reasons: [...blockers],
        policyName: null,
      };
    }

    if (!policy.enabled) {
      blockers.push(`Policy "${policy.name}" is disabled.`);
    }

    const allowedEnvironments = policy.allowedEnvironmentsJson ?? [];
    if (!allowedEnvironments.includes(input.environment)) {
      blockers.push(
        `Policy "${policy.name}" is not allowed to run in the ${input.environment} environment.`,
      );
    }

    if (
      input.script &&
      input.script.allowedEnvironments.length > 0 &&
      !input.script.allowedEnvironments.includes(input.environment)
    ) {
      blockers.push(
        `The remediation script is not allowed to run in the ${input.environment} environment.`,
      );
    }

    if (input.actionType === 'custom_script' && !input.script) {
      blockers.push('No remediation script was supplied for the action.');
    }

    const protectedReason = this.findProtectedReason(input);
    if (protectedReason) {
      blockers.push(protectedReason);
    }

    if (
      input.environment === 'production' &&
      policy.stagingValidated === false
    ) {
      blockers.push(
        `Policy "${policy.name}" has not been validated in staging yet, so it cannot run in production.`,
      );
    }

    const destructive =
      policy.destructive ||
      DESTRUCTIVE_ACTIONS.includes(input.actionType) ||
      input.script?.destructive === true;

    let requiresApproval = policy.requiresApproval;
    if (input.script?.requiresApproval) {
      requiresApproval = true;
    }

    if (input.environment === 'production' && destructive) {
      requiresApproval = true;
      reasons.push(
        `Action "${input.actionType}" is destructive and requires an explicit approval in production.`,
      );
    }

    if (
      input.environment === 'production' &&
      input.severity === 'critical' &&
      HIGH_RISK_ON_CRITICAL.includes(input.actionType)
    ) {
      requiresApproval = true;
      reasons.push(
        `Action "${input.actionType}" on a critical issue requires an explicit approval in production.`,
      );
    }

    const rateLimitReason = await this.checkRateLimit(policy, input);
    if (rateLimitReason) {
      blockers.push(rateLimitReason);
    }

    const cooldownReason = await this.checkCooldown(policy, input);
    if (cooldownReason) {
      blockers.push(cooldownReason);
    }

    const boundsReason = this.checkScaleBounds(policy, input);
    if (boundsReason) {
      blockers.push(boundsReason);
    }

    const blocked = blockers.length > 0;

    const decision: SafetyDecision = {
      allowed: !blocked && !requiresApproval,
      requiresApproval: requiresApproval && !blocked,
      blocked,
      reasons: [...reasons, ...blockers],
      policyName: policy.name,
    };

    this.logger.log(
      `Safety evaluation for ${input.actionType} on ${input.target} (${input.environment}): ${
        decision.blocked
          ? 'blocked'
          : decision.requiresApproval
            ? 'approval required'
            : 'allowed'
      }`,
    );

    return decision;
  }

  /**
   * Find the most specific policy for the action.
   */
  private async findPolicy(
    input: SafetyEvaluationInput,
  ): Promise<RemediationPolicy | null> {
    const policies = await this.policyRepo.find({
      where: { actionType: input.actionType },
    });

    if (policies.length === 0) {
      return null;
    }

    const enabled = policies.filter((policy) => policy.enabled);
    const pool = enabled.length > 0 ? enabled : policies;

    const specific = pool.find(
      (policy) => policy.issueType && policy.issueType === input.issueType,
    );
    if (specific) {
      return specific;
    }

    const generic = pool.find((policy) => !policy.issueType);
    if (generic) {
      return generic;
    }

    return pool[0];
  }

  /**
   * Detect components that must not be remediated automatically.
   */
  private findProtectedReason(input: SafetyEvaluationInput): string | null {
    if (input.environment !== 'production') {
      return null;
    }

    const component = (input.component ?? '').toLowerCase();
    const target = (input.target ?? '').toLowerCase();

    const isProtected = PROTECTED_COMPONENTS.some(
      (protectedName) =>
        component === protectedName ||
        component.includes(protectedName) ||
        target.includes(protectedName),
    );

    if (!isProtected) {
      return null;
    }

    return `Target "${input.target}" is a protected component and cannot be remediated automatically in production.`;
  }

  /**
   * Enforce the maximum number of executions per hour.
   */
  private async checkRateLimit(
    policy: RemediationPolicy,
    input: SafetyEvaluationInput,
  ): Promise<string | null> {
    const executions = await this.historyService.countRecentExecutions(
      input.actionType,
      input.target,
      60,
    );

    if (executions >= policy.maxExecutionsPerHour) {
      return `Action "${input.actionType}" exceeds the configured limit of ${policy.maxExecutionsPerHour} execution(s) per hour for ${input.target}.`;
    }

    return null;
  }

  /**
   * Enforce the cooldown between two executions of the same action.
   */
  private async checkCooldown(
    policy: RemediationPolicy,
    input: SafetyEvaluationInput,
  ): Promise<string | null> {
    if (policy.cooldownMinutes <= 0) {
      return null;
    }

    const last = await this.historyService.findLastSuccessful(
      input.actionType,
      input.target,
    );
    if (!last) {
      return null;
    }

    const elapsedMinutes = (Date.now() - last.createdAt.getTime()) / 60_000;
    if (elapsedMinutes < policy.cooldownMinutes) {
      return `Action "${input.actionType}" is still in its ${policy.cooldownMinutes} minute cooldown for ${input.target}.`;
    }

    return null;
  }

  /**
   * Validate the requested replica count against the policy bounds.
   */
  private checkScaleBounds(
    policy: RemediationPolicy,
    input: SafetyEvaluationInput,
  ): string | null {
    if (input.actionType !== 'scale_up' && input.actionType !== 'scale_down') {
      return null;
    }

    const replicas = Number(input.parameters?.replicas);
    if (!Number.isFinite(replicas)) {
      return 'The scale action does not specify a valid replica count.';
    }

    if (policy.minReplicas !== null && replicas < policy.minReplicas) {
      return `The requested replica count ${replicas} is outside the allowed range (minimum ${policy.minReplicas}).`;
    }

    if (policy.maxReplicas !== null && replicas > policy.maxReplicas) {
      return `The requested replica count ${replicas} is outside the allowed range (maximum ${policy.maxReplicas}).`;
    }

    return null;
  }
}
