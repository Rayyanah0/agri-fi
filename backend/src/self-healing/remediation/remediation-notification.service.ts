import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';
import type { RemediationAction } from '../entities/remediation-action.entity';
import type { SelfHealingIssue } from '../entities/self-healing-issue.entity';

/**
 * RemediationNotificationService
 *
 * Notifies the platform team whenever the automation takes (or refuses to
 * take) an action. Notifications go to the configured chat webhook, to the
 * in-app notification feed of the operators and to the system audit log.
 */
@Injectable()
export class RemediationNotificationService {
  private readonly logger = new Logger(RemediationNotificationService.name);
  private readonly webhookUrl: string | undefined;
  private readonly notifyUserId: string | undefined;
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    private readonly httpService: HttpService,
    private readonly notificationsService: NotificationsService,
    private readonly auditService: AuditService,
  ) {
    this.webhookUrl = this.configService.get<string>(
      'SELF_HEALING_ALERT_WEBHOOK_URL',
    );
    this.notifyUserId = this.configService.get<string>(
      'SELF_HEALING_NOTIFY_USER_ID',
    );
    this.enabled =
      this.configService.get<string>('SELF_HEALING_NOTIFICATIONS_ENABLED') !==
      'false';
  }

  /**
   * Announce that an automated remediation is about to run.
   */
  async notifyStarted(
    issue: SelfHealingIssue | null,
    action: RemediationAction,
  ): Promise<void> {
    const message = [
      `🛠️ Self-healing remediation started`,
      `Action: ${action.actionType}`,
      `Target: ${action.target}`,
      issue ? `Issue: ${issue.issueType} (${issue.severity})` : '',
      issue?.rootCause ? `Cause: ${issue.rootCause}` : '',
      `Environment: ${action.environment}`,
    ]
      .filter(Boolean)
      .join('\n');

    await this.dispatch(action, message, 'Self-healing remediation started');
  }

  /**
   * Announce the outcome of a remediation.
   */
  async notifyCompleted(
    issue: SelfHealingIssue | null,
    action: RemediationAction,
  ): Promise<void> {
    const succeeded = action.status === 'success';
    const message = [
      succeeded
        ? `✅ Self-healing remediation succeeded`
        : `❌ Self-healing remediation failed`,
      `Action: ${action.actionType}`,
      `Target: ${action.target}`,
      action.output ? `Output: ${action.output}` : '',
      action.errorMessage ? `Error: ${action.errorMessage}` : '',
      `Duration: ${action.durationMs ?? 0}ms`,
    ]
      .filter(Boolean)
      .join('\n');

    await this.dispatch(action, message, 'Self-healing remediation finished');
  }

  /**
   * Announce that an action was blocked or needs an approval.
   */
  async notifyBlocked(
    issue: SelfHealingIssue | null,
    action: RemediationAction,
  ): Promise<void> {
    const reasons = (action.safetyReasonsJson ?? []).join('; ');
    const message = [
      `⛔ Self-healing action was not executed`,
      `Action: ${action.actionType}`,
      `Target: ${action.target}`,
      `Reason: ${reasons || 'blocked by the remediation safety policy'}`,
      issue ? `Issue: ${issue.issueType} (${issue.severity})` : '',
    ]
      .filter(Boolean)
      .join('\n');

    await this.dispatch(action, message, 'Self-healing action blocked');
  }

  /**
   * Send the notification through every configured channel.
   */
  private async dispatch(
    action: RemediationAction,
    message: string,
    auditRoute: string,
  ): Promise<void> {
    if (!this.enabled) {
      this.logger.log(
        'Self-healing notifications are disabled (SELF_HEALING_NOTIFICATIONS_ENABLED=false).',
      );
      return;
    }

    await this.auditService.logEvent({
      actorId: action.executedBy,
      actorRole: 'system',
      route: auditRoute,
      statusCode: action.status === 'success' ? 200 : 409,
      requestDetails: {
        actionId: action.id,
        actionType: action.actionType,
        target: action.target,
        status: action.status,
        safetyDecision: action.safetyDecision,
        environment: action.environment,
      },
    });

    await this.sendWebhook(message);
    await this.sendInAppNotification(action, message);
  }

  /**
   * Post the message to the configured chat webhook.
   */
  private async sendWebhook(message: string): Promise<void> {
    if (!this.webhookUrl) {
      this.logger.debug(
        'SELF_HEALING_ALERT_WEBHOOK_URL is not configured; skipping chat notification.',
      );
      return;
    }

    try {
      await firstValueFrom(
        this.httpService.post(this.webhookUrl, { text: message }),
      );
    } catch (error) {
      this.logger.warn(
        `Failed to send the self-healing webhook notification: ${
          (error as Error).message
        }`,
      );
    }
  }

  /**
   * Create an in-app notification for the operators.
   */
  private async sendInAppNotification(
    action: RemediationAction,
    message: string,
  ): Promise<void> {
    if (!this.notifyUserId) {
      return;
    }

    try {
      await this.notificationsService.createNotification({
        userId: this.notifyUserId,
        type: 'alert',
        title: `Self-healing: ${action.actionType} ${action.status}`,
        message,
        linkUrl: '/admin/self-healing',
        metadataJson: {
          actionId: action.id,
          actionType: action.actionType,
          target: action.target,
          status: action.status,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to create the in-app self-healing notification: ${
          (error as Error).message
        }`,
      );
    }
  }
}
