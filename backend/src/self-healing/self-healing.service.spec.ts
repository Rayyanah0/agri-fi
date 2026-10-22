import { SelfHealingService } from './self-healing.service';
import { SelfHealingIssue } from './entities/self-healing-issue.entity';
import { RemediationAction } from './entities/remediation-action.entity';
import type { DetectedIssue } from './detection/issue-detector.service';

describe('SelfHealingService', () => {
  let service: SelfHealingService;

  let issueRepoMock: {
    create: jest.Mock;
    save: jest.Mock;
    find: jest.Mock;
    findOne: jest.Mock;
  };
  let actionRepoMock: { findOne: jest.Mock };
  let policyRepoMock: { findOne: jest.Mock; save: jest.Mock };
  let detectorMock: { detect: jest.Mock };
  let rootCauseMock: { analyse: jest.Mock };
  let safetyMock: { evaluate: jest.Mock; getEnvironment: jest.Mock };
  let historyMock: {
    record: jest.Mock;
    update: jest.Mock;
    findLastSuccessful: jest.Mock;
    countRecentExecutions: jest.Mock;
  };
  let notificationMock: {
    notifyStarted: jest.Mock;
    notifyCompleted: jest.Mock;
    notifyBlocked: jest.Mock;
  };
  let scriptMock: { findForIssueType: jest.Mock; run: jest.Mock };
  let executorMock: {
    name: string;
    supports: jest.Mock;
    restartPod: jest.Mock;
    restartService: jest.Mock;
    cleanupDisk: jest.Mock;
    scaleDeployment: jest.Mock;
    getCurrentReplicas: jest.Mock;
  };
  let configMock: { get: jest.Mock };

  const buildDetectedIssue = (
    overrides: Partial<DetectedIssue> = {},
  ): DetectedIssue => ({
    fingerprint: 'pod_failure:agri-fi/backend-1',
    ruleId: 'pod-not-ready',
    issueType: 'pod_failure',
    severity: 'critical',
    component: 'kubernetes',
    target: 'agri-fi/backend-1',
    description: 'Pod is not ready',
    metrics: { value: 0 },
    labels: {},
    detectedAt: new Date(),
    ...overrides,
  });

  const buildIssue = (
    overrides: Partial<SelfHealingIssue> = {},
  ): SelfHealingIssue => {
    const issue = new SelfHealingIssue();
    issue.id = 'issue-1';
    issue.fingerprint = 'pod_failure:agri-fi/backend-1';
    issue.issueType = 'pod_failure';
    issue.severity = 'critical';
    issue.status = 'detected';
    issue.component = 'kubernetes';
    issue.target = 'agri-fi/backend-1';
    issue.description = 'Pod is not ready';
    issue.detectedAt = new Date();
    issue.lastSeenAt = new Date();
    issue.occurrences = 1;
    issue.metricsSnapshotJson = null;
    issue.labelsJson = null;
    issue.rootCause = null;
    issue.rootCauseConfidence = null;
    issue.rootCauseEvidenceJson = null;
    issue.resolvedAt = null;
    return Object.assign(issue, overrides);
  };

  const buildAction = (
    overrides: Partial<RemediationAction> = {},
  ): RemediationAction => {
    const action = new RemediationAction();
    action.id = 'action-1';
    action.issueId = 'issue-1';
    action.actionType = 'restart_pod';
    action.target = 'agri-fi/backend-1';
    action.component = 'kubernetes';
    action.status = 'approved';
    action.safetyDecision = 'allowed';
    action.executedBy = 'system';
    action.triggerSource = 'scheduler';
    action.environment = 'staging';
    action.createdAt = new Date();
    action.parametersJson = {};
    return Object.assign(action, overrides);
  };

  /**
   * Make the repository return the given issues for the "open issues" query
   * and nothing for the "issues that have to be closed" query.
   */
  const setOpenIssues = (issues: SelfHealingIssue[]) => {
    issueRepoMock.find.mockImplementation(async (options: unknown) => {
      const statuses = (
        options as { where?: { status?: { _value?: string[] } } }
      )?.where?.status?._value;
      if (Array.isArray(statuses) && statuses.includes('remediating')) {
        return [];
      }
      return issues;
    });
  };

  beforeEach(() => {
    issueRepoMock = {
      create: jest.fn((entry) => ({ ...entry })),
      save: jest.fn(async (entity) => entity),
      find: jest.fn(async () => []),
      findOne: jest.fn(async () => null),
    };
    actionRepoMock = { findOne: jest.fn(async () => null) };
    policyRepoMock = {
      findOne: jest.fn(async () => null),
      save: jest.fn(async (policy) => policy),
    };
    detectorMock = { detect: jest.fn(async () => []) };
    rootCauseMock = {
      analyse: jest.fn(async () => ({
        rootCause: 'Container was OOM-killed',
        confidence: 0.95,
        evidence: {},
        recommendedActions: ['restart_pod'],
        requiresManualIntervention: true,
        guidance: null,
        matchedRuleId: 'pod-oom-killed',
      })),
    };
    safetyMock = {
      evaluate: jest.fn(async () => ({
        allowed: true,
        requiresApproval: false,
        blocked: false,
        reasons: [],
        policyName: 'restart-pod-default',
      })),
      getEnvironment: jest.fn(() => 'staging'),
    };
    historyMock = {
      record: jest.fn(async (entry) => buildAction(entry)),
      update: jest.fn(async (_id, changes) => buildAction(changes)),
      findLastSuccessful: jest.fn(async () => null),
      countRecentExecutions: jest.fn(async () => 0),
    };
    notificationMock = {
      notifyStarted: jest.fn(async () => undefined),
      notifyCompleted: jest.fn(async () => undefined),
      notifyBlocked: jest.fn(async () => undefined),
    };
    scriptMock = {
      findForIssueType: jest.fn(async () => null),
      run: jest.fn(async () => ({
        success: true,
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 5,
        message: 'ok',
      })),
    };
    executorMock = {
      name: 'kubernetes',
      supports: jest.fn(() => true),
      restartPod: jest.fn(async () => ({
        success: true,
        message: 'pod restarted',
      })),
      restartService: jest.fn(async () => ({
        success: true,
        message: 'service restarted',
      })),
      cleanupDisk: jest.fn(async () => ({
        success: true,
        message: 'disk cleaned',
      })),
      scaleDeployment: jest.fn(async () => ({
        success: true,
        message: 'scaled',
      })),
      getCurrentReplicas: jest.fn(async () => 3),
    };
    configMock = {
      get: jest.fn((key: string, fallback?: string) => fallback),
    };

    service = new SelfHealingService(
      issueRepoMock as never,
      actionRepoMock as never,
      policyRepoMock as never,
      detectorMock as never,
      rootCauseMock as never,
      safetyMock as never,
      historyMock as never,
      notificationMock as never,
      scriptMock as never,
      configMock as never,
      executorMock as never,
      { inc: jest.fn() } as never,
      { inc: jest.fn() } as never,
    );
  });

  it('does nothing when the automation is disabled', async () => {
    configMock.get.mockImplementation((key: string, fallback?: string) =>
      key === 'SELF_HEALING_ENABLED' ? 'false' : fallback,
    );

    const result = await service.runDetectionCycle();

    expect(result.detected).toBe(0);
    expect(detectorMock.detect).not.toHaveBeenCalled();
  });

  it('is disabled in production unless it is enabled explicitly', () => {
    safetyMock.getEnvironment.mockReturnValue('production');
    configMock.get.mockImplementation((key: string, fallback?: string) =>
      key === 'SELF_HEALING_ENABLED' ? undefined : fallback,
    );

    expect(service.isEnabled()).toBe(false);
  });

  it('is enabled in staging by default', () => {
    safetyMock.getEnvironment.mockReturnValue('staging');
    configMock.get.mockImplementation((key: string, fallback?: string) =>
      key === 'SELF_HEALING_ENABLED' ? undefined : fallback,
    );

    expect(service.isEnabled()).toBe(true);
  });

  it('persists a newly detected issue', async () => {
    detectorMock.detect.mockResolvedValue([buildDetectedIssue()]);

    const result = await service.runDetectionCycle();

    expect(result.detected).toBe(1);
    expect(result.newIssues).toBe(1);
    expect(issueRepoMock.save).toHaveBeenCalled();
  });

  it('does not create a duplicate issue for the same fingerprint', async () => {
    detectorMock.detect.mockResolvedValue([buildDetectedIssue()]);
    issueRepoMock.findOne.mockResolvedValue(buildIssue());

    const result = await service.runDetectionCycle();

    expect(result.recurringIssues).toBe(1);
    expect(result.newIssues).toBe(0);
  });

  it('remediates an issue that the safety policy allows', async () => {
    const issue = buildIssue();
    detectorMock.detect.mockResolvedValue([]);
    setOpenIssues([issue]);
    issueRepoMock.findOne.mockResolvedValue(issue);
    historyMock.record.mockResolvedValue(buildAction());

    const result = await service.runDetectionCycle();

    expect(result.remediated).toBe(1);
    expect(executorMock.restartPod).toHaveBeenCalled();
    expect(issue.status).toBe('remediated');
    expect(notificationMock.notifyCompleted).toHaveBeenCalled();
  });

  it('queues an action for approval when the policy requires it', async () => {
    const issue = buildIssue();
    setOpenIssues([issue]);
    issueRepoMock.findOne.mockResolvedValue(issue);
    safetyMock.evaluate.mockResolvedValue({
      allowed: false,
      requiresApproval: true,
      blocked: false,
      reasons: ['destructive action'],
      policyName: 'restart-pod-default',
    });
    historyMock.record.mockResolvedValue(
      buildAction({ status: 'pending_approval' }),
    );

    const result = await service.runDetectionCycle();

    expect(result.pendingApproval).toBe(1);
    expect(executorMock.restartPod).not.toHaveBeenCalled();
    expect(notificationMock.notifyBlocked).toHaveBeenCalled();
  });

  it('does not remediate an issue that the safety policy blocks', async () => {
    const issue = buildIssue();
    setOpenIssues([issue]);
    issueRepoMock.findOne.mockResolvedValue(issue);
    safetyMock.evaluate.mockResolvedValue({
      allowed: false,
      requiresApproval: false,
      blocked: true,
      reasons: ['protected component'],
      policyName: 'restart-pod-default',
    });
    historyMock.record.mockResolvedValue(buildAction({ status: 'skipped' }));

    const result = await service.runDetectionCycle();

    expect(result.blocked).toBe(1);
    expect(executorMock.restartPod).not.toHaveBeenCalled();
  });

  it('skips the remediation when no action is recommended', async () => {
    const issue = buildIssue();
    setOpenIssues([issue]);
    issueRepoMock.findOne.mockResolvedValue(issue);
    rootCauseMock.analyse.mockResolvedValue({
      rootCause: 'Unknown',
      confidence: 0.2,
      evidence: {},
      recommendedActions: ['manual'],
      requiresManualIntervention: true,
      guidance: null,
      matchedRuleId: 'generic',
    });

    const result = await service.runDetectionCycle();

    expect(result.remediated).toBe(0);
    expect(historyMock.record).not.toHaveBeenCalled();
  });

  it('records a failed action when the executor reports an error', async () => {
    const issue = buildIssue();
    setOpenIssues([issue]);
    issueRepoMock.findOne.mockResolvedValue(issue);
    historyMock.record.mockResolvedValue(buildAction());
    executorMock.restartPod.mockResolvedValue({
      success: false,
      message: 'the API server rejected the request',
    });

    const result = await service.runDetectionCycle();

    expect(result.failed).toBe(1);
    expect(issue.status).toBe('failed');
  });

  it('marks a policy as validated after it succeeded in staging', async () => {
    const issue = buildIssue();
    setOpenIssues([issue]);
    issueRepoMock.findOne.mockResolvedValue(issue);
    historyMock.record.mockResolvedValue(
      buildAction({ policyName: 'restart-pod-default' }),
    );
    policyRepoMock.findOne.mockResolvedValue({
      id: 'policy-1',
      name: 'restart-pod-default',
      stagingValidated: false,
    });

    await service.runDetectionCycle();

    expect(policyRepoMock.save).toHaveBeenCalledWith(
      expect.objectContaining({ stagingValidated: true }),
    );
  });

  it('approves and executes a pending action', async () => {
    const action = buildAction({ status: 'pending_approval' });
    actionRepoMock.findOne.mockResolvedValue(action);
    issueRepoMock.findOne.mockResolvedValue(buildIssue());
    historyMock.update.mockResolvedValue(buildAction({ status: 'success' }));

    const result = await service.approveAction('action-1', 'admin-1');

    expect(result).not.toBeNull();
    expect(historyMock.update).toHaveBeenCalledWith(
      'action-1',
      expect.objectContaining({ status: 'approved', executedBy: 'admin-1' }),
    );
    expect(executorMock.restartPod).toHaveBeenCalled();
  });

  it('rejects a pending action', async () => {
    actionRepoMock.findOne.mockResolvedValue(buildAction());
    historyMock.update.mockResolvedValue(buildAction({ status: 'rejected' }));

    const result = await service.rejectAction('action-1', 'admin-1');

    expect(result?.status).toBe('rejected');
  });
});
