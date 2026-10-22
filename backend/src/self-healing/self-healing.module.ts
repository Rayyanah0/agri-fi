import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  makeCounterProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';

import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { SelfHealingController } from './self-healing.controller';
import { SelfHealingService } from './self-healing.service';
import { SelfHealingSchedulerService } from './self-healing-scheduler.service';

import { PrometheusQueryService } from './detection/prometheus-query.service';
import { IssueDetectorService } from './detection/issue-detector.service';
import { RootCauseAnalysisService } from './diagnosis/root-cause.service';

import { SafetyCheckService } from './remediation/safety-check.service';
import { RemediationHistoryService } from './remediation/remediation-history.service';
import { RemediationAnalyticsService } from './remediation/remediation-analytics.service';
import { RemediationNotificationService } from './remediation/remediation-notification.service';
import { CustomScriptService } from './remediation/custom-script.service';
import { KubernetesInfrastructureExecutor } from './remediation/kubernetes-executor';
import { AnsibleInfrastructureExecutor } from './remediation/ansible-executor';
import {
  INFRASTRUCTURE_EXECUTOR,
  NoopInfrastructureExecutor,
} from './remediation/infrastructure-executor';

import { SelfHealingIssue } from './entities/self-healing-issue.entity';
import { RemediationAction } from './entities/remediation-action.entity';
import { RemediationPolicy } from './entities/remediation-policy.entity';
import { RemediationScript } from './entities/remediation-script.entity';

/**
 * SelfHealingModule
 *
 * Detects infrastructure issues from the existing Prometheus deployment,
 * diagnoses their root cause and applies the remediation automatically
 * when the safety policy allows it.
 */
@Module({
  imports: [
    ConfigModule,
    HttpModule,
    AuditModule,
    NotificationsModule,
    TypeOrmModule.forFeature([
      SelfHealingIssue,
      RemediationAction,
      RemediationPolicy,
      RemediationScript,
    ]),
  ],
  controllers: [SelfHealingController],
  providers: [
    PrometheusQueryService,
    IssueDetectorService,
    RootCauseAnalysisService,
    SafetyCheckService,
    RemediationHistoryService,
    RemediationAnalyticsService,
    RemediationNotificationService,
    CustomScriptService,
    KubernetesInfrastructureExecutor,
    AnsibleInfrastructureExecutor,
    {
      provide: INFRASTRUCTURE_EXECUTOR,
      inject: [
        ConfigService,
        KubernetesInfrastructureExecutor,
        AnsibleInfrastructureExecutor,
      ],
      useFactory: (
        configService: ConfigService,
        kubernetes: KubernetesInfrastructureExecutor,
        ansible: AnsibleInfrastructureExecutor,
      ) => {
        const executor = configService
          .get<string>('SELF_HEALING_EXECUTOR', 'kubernetes')
          .toLowerCase();

        if (executor === 'ansible') {
          return ansible;
        }
        if (executor === 'none') {
          return new NoopInfrastructureExecutor();
        }
        return kubernetes;
      },
    },
    SelfHealingService,
    SelfHealingSchedulerService,
    makeCounterProvider({
      name: 'self_healing_issues_detected_total',
      help: 'Total number of infrastructure issues detected by the self-healing engine.',
      labelNames: ['issue_type', 'severity'],
    }),
    makeCounterProvider({
      name: 'self_healing_remediations_total',
      help: 'Total number of remediation actions executed by the self-healing engine.',
      labelNames: ['action_type', 'status'],
    }),
    makeGaugeProvider({
      name: 'self_healing_active_issues',
      help: 'Number of infrastructure issues that are currently open.',
      labelNames: ['issue_type'],
    }),
  ],
  exports: [
    SelfHealingService,
    RemediationHistoryService,
    RemediationAnalyticsService,
    RemediationNotificationService,
  ],
})
export class SelfHealingModule {}
