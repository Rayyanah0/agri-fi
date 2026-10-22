import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  PrometheusQueryService,
  PrometheusSample,
} from './prometheus-query.service';
import {
  SELF_HEALING_DETECTION_RULES,
  SelfHealingDetectionRule,
  breachesThreshold,
  buildDwellExpression,
} from './issue-detection-rules';
import type {
  SelfHealingIssueType,
  SelfHealingSeverity,
} from '../entities/self-healing-issue.entity';

/** An issue observed by the detector, before it is persisted. */
export interface DetectedIssue {
  fingerprint: string;
  ruleId: string;
  issueType: SelfHealingIssueType;
  severity: SelfHealingSeverity;
  component: string;
  target: string;
  description: string;
  metrics: Record<string, unknown>;
  labels: Record<string, unknown>;
  detectedAt: Date;
}

/**
 * IssueDetectorService
 *
 * Detects infrastructure issues from the existing Prometheus deployment.
 *
 * Two complementary sources are used:
 *
 *  1. Prometheus alerts flagged with `self_healing="true"`. These reuse the
 *     platform alerting rules and inherit their `for:` dwell time, so an
 *     alert only becomes an issue once it has been firing for a while.
 *  2. Code defined metric rules (`SELF_HEALING_DETECTION_RULES`) that cover
 *     signals which are not (yet) expressed as Prometheus alerts.
 */
@Injectable()
export class IssueDetectorService {
  private readonly logger = new Logger(IssueDetectorService.name);
  private readonly alertLabel: string;

  constructor(
    private readonly prometheus: PrometheusQueryService,
    private readonly configService: ConfigService,
  ) {
    this.alertLabel = this.configService.get<string>(
      'SELF_HEALING_ALERT_LABEL',
      'self_healing',
    );
  }

  /**
   * Run every detection rule and return the issues that are currently
   * breaching their thresholds.
   */
  async detect(): Promise<DetectedIssue[]> {
    const issues: DetectedIssue[] = [];

    for (const rule of SELF_HEALING_DETECTION_RULES) {
      try {
        issues.push(...(await this.evaluateRule(rule)));
      } catch (error) {
        this.logger.warn(
          `Detection rule "${rule.id}" failed: ${(error as Error).message}`,
        );
      }
    }

    const alertIssues = await this.detectFromAlerts();
    for (const issue of alertIssues) {
      if (
        !issues.some((existing) => existing.fingerprint === issue.fingerprint)
      ) {
        issues.push(issue);
      }
    }

    this.logger.log(
      `Issue detection completed: ${issues.length} issue(s) detected from ${
        SELF_HEALING_DETECTION_RULES.length
      } metric rule(s) and Prometheus alerts`,
    );

    return issues;
  }

  /**
   * Evaluate a single metric rule.
   */
  private async evaluateRule(
    rule: SelfHealingDetectionRule,
  ): Promise<DetectedIssue[]> {
    const samples = await this.prometheus.query(rule.promQl);
    if (samples.length === 0) {
      return [];
    }

    const breaching = samples.filter((sample) =>
      breachesThreshold(rule, sample.value),
    );
    if (breaching.length === 0) {
      return [];
    }

    const sustainedTargets = await this.resolveSustainedTargets(rule);

    const issues: DetectedIssue[] = [];
    for (const sample of breaching) {
      const target = this.buildTarget(rule, sample);
      if (
        sustainedTargets !== null &&
        target !== '' &&
        !sustainedTargets.has(target)
      ) {
        continue;
      }

      issues.push({
        fingerprint: `${rule.issueType}:${target || rule.component}`,
        ruleId: rule.id,
        issueType: rule.issueType,
        severity: rule.severity,
        component: rule.component,
        target: target || rule.component,
        description: rule.description,
        metrics: {
          value: sample.value,
          threshold: rule.threshold,
          comparator: rule.comparator,
        },
        labels: { ...sample.metric },
        detectedAt: new Date(),
      });
    }

    return issues;
  }

  /**
   * Resolve the set of targets for which the breach is known to have
   * persisted for the whole dwell window. Returns `null` when the rule has
   * no dwell time configured.
   */
  private async resolveSustainedTargets(
    rule: SelfHealingDetectionRule,
  ): Promise<Set<string> | null> {
    const dwellExpression = buildDwellExpression(rule);
    if (!dwellExpression) {
      return null;
    }

    const dwellSamples = await this.prometheus.query(dwellExpression);
    const targets = new Set<string>();
    for (const sample of dwellSamples) {
      if (sample.value <= 0) {
        continue;
      }
      const target = this.buildTarget(rule, sample);
      if (target) {
        targets.add(target);
      }
    }

    return targets;
  }

  /**
   * Build the identity of the affected resource from the sample labels.
   */
  private buildTarget(
    rule: SelfHealingDetectionRule,
    sample: PrometheusSample,
  ): string {
    const parts = rule.targetLabels
      .map((label) => sample.metric[label])
      .filter((value): value is string => Boolean(value));

    if (parts.length === 0) {
      return '';
    }

    return parts.join('/');
  }

  /**
   * Convert firing Prometheus alerts flagged for self-healing into issues.
   */
  private async detectFromAlerts(): Promise<DetectedIssue[]> {
    const alerts = await this.prometheus.getAlerts();
    const issues: DetectedIssue[] = [];

    for (const alert of alerts) {
      if (alert.state !== 'firing') {
        continue;
      }

      const labels = alert.labels ?? {};
      if (labels[this.alertLabel] !== 'true') {
        continue;
      }

      const issueType = labels.issue_type as SelfHealingIssueType | undefined;
      if (!issueType) {
        this.logger.warn(
          `Alert "${labels.alertname}" is flagged for self-healing but has no issue_type label. Ignoring.`,
        );
        continue;
      }

      const target = this.buildAlertTarget(labels);
      issues.push({
        fingerprint: `${issueType}:${target}`,
        ruleId: labels.alertname ?? 'prometheus-alert',
        issueType,
        severity: (labels.severity as SelfHealingSeverity) ?? 'warning',
        component: labels.component ?? 'unknown',
        target,
        description:
          alert.annotations?.summary ??
          `Alert ${labels.alertname ?? 'unknown'} is firing`,
        metrics: { value: Number(alert.value) },
        labels: { ...labels },
        detectedAt: new Date(),
      });
    }

    return issues;
  }

  /**
   * Derive the affected resource from an alert label set.
   */
  private buildAlertTarget(labels: Record<string, string>): string {
    const namespace = labels.namespace;
    const resource =
      labels.pod ??
      labels.deployment ??
      labels.instance ??
      labels.queue ??
      labels.component ??
      'unknown';

    return namespace ? `${namespace}/${resource}` : resource;
  }
}
