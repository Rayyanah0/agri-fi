import { RemediationAnalyticsService } from './remediation-analytics.service';
import { RemediationAction } from '../entities/remediation-action.entity';
import { SelfHealingIssue } from '../entities/self-healing-issue.entity';

describe('RemediationAnalyticsService', () => {
  let service: RemediationAnalyticsService;
  let actionRepoMock: { find: jest.Mock };
  let issueRepoMock: { find: jest.Mock };
  let configMock: { get: jest.Mock };

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
    action.timeSavedMs = null;
    return Object.assign(action, overrides);
  };

  const buildIssue = (
    overrides: Partial<SelfHealingIssue> = {},
  ): SelfHealingIssue => {
    const issue = new SelfHealingIssue();
    issue.id = 'issue-1';
    issue.fingerprint = 'pod_failure:agri-fi/backend-1';
    issue.issueType = 'pod_failure';
    issue.severity = 'critical';
    issue.status = 'remediated';
    issue.component = 'kubernetes';
    issue.target = 'agri-fi/backend-1';
    issue.description = 'Pod is not ready';
    issue.detectedAt = new Date(Date.now() - 10 * 60_000);
    issue.resolvedAt = new Date();
    issue.occurrences = 1;
    return Object.assign(issue, overrides);
  };

  beforeEach(() => {
    actionRepoMock = { find: jest.fn().mockResolvedValue([]) };
    issueRepoMock = { find: jest.fn().mockResolvedValue([]) };
    configMock = {
      get: jest.fn((key: string, fallback?: string) => fallback),
    };

    service = new RemediationAnalyticsService(
      actionRepoMock as never,
      issueRepoMock as never,
      configMock as never,
    );
  });

  it('reports zeroed analytics when nothing happened', async () => {
    const analytics = await service.compute();

    expect(analytics.totals.actionsTotal).toBe(0);
    expect(analytics.totals.successRate).toBe(0);
    expect(analytics.totals.issuesDetected).toBe(0);
  });

  it('computes the success rate of the executed actions', async () => {
    actionRepoMock.find.mockResolvedValue([
      buildAction({ status: 'success' }),
      buildAction({ id: 'action-2', status: 'success' }),
      buildAction({ id: 'action-3', status: 'failed' }),
    ]);

    const analytics = await service.compute();

    expect(analytics.totals.actionsSucceeded).toBe(2);
    expect(analytics.totals.actionsFailed).toBe(1);
    expect(analytics.totals.successRate).toBeCloseTo(2 / 3);
  });

  it('computes the false positive rate', async () => {
    issueRepoMock.find.mockResolvedValue([
      buildIssue({ id: 'issue-1', status: 'remediated' }),
      buildIssue({ id: 'issue-2', status: 'false_positive' }),
    ]);

    const analytics = await service.compute();

    expect(analytics.totals.issuesFalsePositive).toBe(1);
    expect(analytics.totals.falsePositiveRate).toBeCloseTo(0.5);
  });

  it('computes the mean time to recovery and the reduction', async () => {
    issueRepoMock.find.mockResolvedValue([
      buildIssue({
        detectedAt: new Date(Date.now() - 20 * 60_000),
        resolvedAt: new Date(),
      }),
    ]);
    configMock.get.mockImplementation((key: string, fallback?: string) =>
      key === 'SELF_HEALING_BASELINE_MTTR_MINUTES' ? '120' : fallback,
    );

    const analytics = await service.compute();

    expect(analytics.totals.averageMttrMinutes).toBeCloseTo(20, 1);
    expect(analytics.totals.baselineMttrMinutes).toBe(120);
    expect(analytics.totals.mttrReductionPercent).toBeGreaterThan(80);
  });

  it('estimates the time saved from the manual baseline', async () => {
    issueRepoMock.find.mockResolvedValue([
      buildIssue({
        detectedAt: new Date(Date.now() - 20 * 60_000),
        resolvedAt: new Date(),
      }),
    ]);
    actionRepoMock.find.mockResolvedValue([
      buildAction({ status: 'success', timeSavedMs: null }),
    ]);

    const analytics = await service.compute();

    expect(analytics.totals.totalTimeSavedMinutes).toBeCloseTo(100, 0);
  });

  it('groups the actions per action type', async () => {
    actionRepoMock.find.mockResolvedValue([
      buildAction({ status: 'success' }),
      buildAction({
        id: 'action-2',
        actionType: 'cleanup_disk',
        status: 'failed',
      }),
    ]);

    const analytics = await service.compute();

    const cleanup = analytics.byActionType.find(
      (entry) => entry.actionType === 'cleanup_disk',
    );

    expect(cleanup?.total).toBe(1);
    expect(cleanup?.successRate).toBe(0);
  });

  it('groups the issues per issue type', async () => {
    issueRepoMock.find.mockResolvedValue([
      buildIssue({ id: 'issue-1', status: 'remediated' }),
      buildIssue({ id: 'issue-2', status: 'failed' }),
    ]);

    const analytics = await service.compute();

    const podFailures = analytics.byIssueType.find(
      (entry) => entry.issueType === 'pod_failure',
    );

    expect(podFailures?.total).toBe(2);
    expect(podFailures?.remediated).toBe(1);
    expect(podFailures?.failed).toBe(1);
  });
});
