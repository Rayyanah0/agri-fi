import { of, throwError } from 'rxjs';

import { RemediationNotificationService } from './remediation-notification.service';
import { SelfHealingIssue } from '../entities/self-healing-issue.entity';
import { RemediationAction } from '../entities/remediation-action.entity';

describe('RemediationNotificationService', () => {
  let httpMock: { post: jest.Mock };
  let notificationsMock: { createNotification: jest.Mock };
  let auditMock: { logEvent: jest.Mock };

  const buildAction = (
    overrides: Partial<RemediationAction> = {},
  ): RemediationAction => {
    const action = new RemediationAction();
    action.id = 'action-1';
    action.issueId = 'issue-1';
    action.actionType = 'restart_pod';
    action.target = 'agri-fi/backend-1';
    action.component = 'kubernetes';
    action.status = 'success';
    action.executedBy = 'system';
    action.triggerSource = 'scheduler';
    action.environment = 'staging';
    action.createdAt = new Date();
    action.safetyDecision = 'allowed';
    action.safetyReasonsJson = [];
    return Object.assign(action, overrides);
  };

  const buildIssue = (): SelfHealingIssue => {
    const issue = new SelfHealingIssue();
    issue.id = 'issue-1';
    issue.fingerprint = 'pod_failure:agri-fi/backend-1';
    issue.issueType = 'pod_failure';
    issue.severity = 'critical';
    issue.status = 'remediating';
    issue.component = 'kubernetes';
    issue.target = 'agri-fi/backend-1';
    issue.description = 'Pod is not ready';
    issue.rootCause = 'Container was OOM-killed';
    issue.detectedAt = new Date();
    issue.lastSeenAt = new Date();
    issue.occurrences = 1;
    return issue;
  };

  /**
   * Build the service with the given environment configuration.
   */
  const buildService = (
    getImplementation: (key: string, fallback?: string) => string | undefined,
  ) => {
    const configMock = { get: jest.fn(getImplementation) };
    return new RemediationNotificationService(
      configMock as never,
      httpMock as never,
      notificationsMock as never,
      auditMock as never,
    );
  };

  beforeEach(() => {
    httpMock = { post: jest.fn(() => of({ data: {} })) };
    notificationsMock = { createNotification: jest.fn(async () => ({})) };
    auditMock = { logEvent: jest.fn(async () => ({})) };
  });

  it('announces that a remediation started', async () => {
    const service = buildService((key, fallback) =>
      key === 'SELF_HEALING_ALERT_WEBHOOK_URL'
        ? 'https://hooks.example.com/self-healing'
        : fallback,
    );

    await service.notifyStarted(buildIssue(), buildAction());

    expect(auditMock.logEvent).toHaveBeenCalled();
    expect(httpMock.post).toHaveBeenCalled();
  });

  it('announces the outcome of a remediation', async () => {
    const service = buildService((key, fallback) =>
      key === 'SELF_HEALING_ALERT_WEBHOOK_URL'
        ? 'https://hooks.example.com/self-healing'
        : fallback,
    );

    await service.notifyCompleted(buildIssue(), buildAction());

    expect(auditMock.logEvent).toHaveBeenCalled();
  });

  it('announces a blocked action with the reasons', async () => {
    const service = buildService((key, fallback) =>
      key === 'SELF_HEALING_ALERT_WEBHOOK_URL'
        ? 'https://hooks.example.com/self-healing'
        : fallback,
    );

    await service.notifyBlocked(
      buildIssue(),
      buildAction({
        status: 'skipped',
        safetyDecision: 'blocked',
        safetyReasonsJson: ['Target is a protected component'],
      }),
    );

    expect(httpMock.post).toHaveBeenCalled();
  });

  it('does nothing when the notifications are disabled', async () => {
    const service = buildService((key, fallback) =>
      key === 'SELF_HEALING_NOTIFICATIONS_ENABLED' ? 'false' : fallback,
    );

    await service.notifyStarted(buildIssue(), buildAction());

    expect(auditMock.logEvent).not.toHaveBeenCalled();
    expect(httpMock.post).not.toHaveBeenCalled();
  });

  it('creates an in-app notification for the configured operator', async () => {
    const service = buildService((key, fallback) =>
      key === 'SELF_HEALING_NOTIFY_USER_ID' ? 'admin-1' : fallback,
    );

    await service.notifyCompleted(buildIssue(), buildAction());

    expect(notificationsMock.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'admin-1', type: 'alert' }),
    );
  });

  it('skips the webhook when no webhook is configured', async () => {
    const service = buildService((_key, fallback) => fallback);

    await service.notifyStarted(buildIssue(), buildAction());

    expect(httpMock.post).not.toHaveBeenCalled();
    expect(auditMock.logEvent).toHaveBeenCalled();
  });
  it('survives a failing webhook', async () => {
    httpMock.post.mockReturnValue(throwError(() => new Error('unreachable')));
    const service = buildService((key, fallback) =>
      key === 'SELF_HEALING_ALERT_WEBHOOK_URL'
        ? 'https://hooks.example.com/self-healing'
        : fallback,
    );

    await expect(
      service.notifyStarted(buildIssue(), buildAction()),
    ).resolves.toBeUndefined();
  });
});
