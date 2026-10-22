import { Injectable, Logger } from '@nestjs/common';

import { PrometheusQueryService } from '../detection/prometheus-query.service';
import {
  GENERIC_ROOT_CAUSE_RULE,
  ROOT_CAUSE_RULES,
  RootCauseRule,
} from './root-cause-rules';
import { RemediationHistoryService } from '../remediation/remediation-history.service';
import type { RemediationActionType } from '../entities/remediation-action.entity';
import type { SelfHealingIssue } from '../entities/self-healing-issue.entity';

/** Result of the root cause analysis for a detected issue. */
export interface RootCauseAnalysis {
  rootCause: string;
  confidence: number;
  evidence: Record<string, unknown>;
  recommendedActions: RemediationActionType[];
  requiresManualIntervention: boolean;
  guidance: string | null;
  matchedRuleId: string;
}

/** Characters allowed inside a PromQL label value. */
const SAFE_LABEL_VALUE = /^[a-zA-Z0-9_.\-/]+$/;

/**
 * RootCauseAnalysisService
 *
 * Correlates the metrics that triggered an issue with related cluster
 * signals and the recent remediation history in order to identify the most
 * likely cause of the failure.
 */
@Injectable()
export class RootCauseAnalysisService {
  private readonly logger = new Logger(RootCauseAnalysisService.name);

  constructor(
    private readonly prometheus: PrometheusQueryService,
    private readonly historyService: RemediationHistoryService,
  ) {}

  /**
   * Analyse an issue and return the most likely root cause.
   */
  async analyse(issue: SelfHealingIssue): Promise<RootCauseAnalysis> {
    const signals = await this.collectSignals(issue);
    const rule = this.matchRule(issue, signals);

    this.logger.log(
      `Root cause analysis for issue ${issue.id} (${issue.issueType}) matched rule "${rule.id}" with confidence ${rule.confidence}`,
    );

    return {
      rootCause: rule.rootCause,
      confidence: rule.confidence,
      evidence: signals,
      recommendedActions: rule.recommendedActions,
      requiresManualIntervention: rule.requiresManualIntervention === true,
      guidance: rule.guidance ?? null,
      matchedRuleId: rule.id,
    };
  }

  /**
   * Find the first rule whose conditions are all satisfied.
   */
  private matchRule(
    issue: SelfHealingIssue,
    signals: Record<string, unknown>,
  ): RootCauseRule {
    const candidates = ROOT_CAUSE_RULES.filter(
      (rule) => rule.issueType === issue.issueType,
    );

    for (const rule of candidates) {
      const entries = Object.entries(rule.match);
      const matches = entries.every(([key, matcher]) => {
        if (!(key in signals)) {
          return false;
        }
        return matcher(signals[key]);
      });
      if (matches) {
        return rule;
      }
    }

    return {
      ...GENERIC_ROOT_CAUSE_RULE,
      issueType: issue.issueType,
    };
  }

  /**
   * Gather every signal that can support a root cause decision.
   */
  private async collectSignals(
    issue: SelfHealingIssue,
  ): Promise<Record<string, unknown>> {
    const signals: Record<string, unknown> = {
      'issue.type': issue.issueType,
      'issue.component': issue.component,
      'issue.target': issue.target,
      'issue.severity': issue.severity,
    };

    if (issue.metricsSnapshotJson) {
      const value = issue.metricsSnapshotJson.value;
      if (typeof value === 'number') {
        signals['metric.value'] = value;
        if (
          issue.issueType === 'high_memory' &&
          issue.component === 'kubernetes'
        ) {
          signals['container.memoryRatio'] = value;
        }
      }
    }

    Object.assign(signals, await this.collectPodSignals(issue.target));

    const history = await this.historyService.summariseTargetHistory(
      issue.target,
      60,
    );
    signals['history.recentActionCount'] = history.total;
    signals['history.recentFailureCount'] = history.failed;

    return signals;
  }

  /**
   * Collect pod level signals (restart counts and container states).
   */
  private async collectPodSignals(
    target: string,
  ): Promise<Record<string, unknown>> {
    const signals: Record<string, unknown> = {};
    const separator = target.indexOf('/');
    if (separator <= 0) {
      return signals;
    }

    const namespace = target.slice(0, separator);
    const pod = target.slice(separator + 1);
    if (!SAFE_LABEL_VALUE.test(namespace) || !SAFE_LABEL_VALUE.test(pod)) {
      return signals;
    }

    const restarts = await this.prometheus.query(
      `max by (namespace, pod) (kube_pod_container_status_restarts_total{namespace="${namespace}",pod="${pod}"})`,
    );
    if (restarts.length > 0) {
      signals['pod.restartCount'] = restarts[0].value;
    }

    const terminated = await this.prometheus.query(
      `max by (namespace, pod, reason) (kube_pod_container_status_last_terminated_reason{namespace="${namespace}",pod="${pod}"})`,
    );
    const terminatedReason = terminated.find(
      (sample) => sample.value > 0 && sample.metric.reason,
    );
    if (terminatedReason) {
      signals['pod.lastTerminatedReason'] = terminatedReason.metric.reason;
    }

    const waiting = await this.prometheus.query(
      `max by (namespace, pod, reason) (kube_pod_container_status_waiting_reason{namespace="${namespace}",pod="${pod}"})`,
    );
    const waitingReason = waiting.find(
      (sample) => sample.value > 0 && sample.metric.reason,
    );
    if (waitingReason) {
      signals['pod.waitingReason'] = waitingReason.metric.reason;
    }

    return signals;
  }
}
