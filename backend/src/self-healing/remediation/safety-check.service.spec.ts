import { SafetyCheckService } from './safety-check.service';
import { RemediationPolicy } from '../entities/remediation-policy.entity';

describe('SafetyCheckService', () => {
  let service: SafetyCheckService;
  let policyRepoMock: { find: jest.Mock };
  let historyMock: {
    countRecentExecutions: jest.Mock;
    findLastSuccessful: jest.Mock;
  };
  let configMock: { get: jest.Mock };

  const buildPolicy = (overrides: Partial<RemediationPolicy> = {}) => {
    const policy = new RemediationPolicy();
    policy.id = 'policy-1';
    policy.name = 'restart-pod-default';
    policy.issueType = null;
    policy.actionType = 'restart_pod';
    policy.enabled = true;
    policy.requiresApproval = false;
    policy.destructive = false;
    policy.maxExecutionsPerHour = 5;
    policy.cooldownMinutes = 15;
    policy.allowedEnvironmentsJson = ['staging', 'production'];
    policy.stagingValidated = true;
    policy.minReplicas = null;
    policy.maxReplicas = null;
    policy.description = null;
    return Object.assign(policy, overrides);
  };

  beforeEach(() => {
    policyRepoMock = { find: jest.fn().mockResolvedValue([buildPolicy()]) };
    historyMock = {
      countRecentExecutions: jest.fn().mockResolvedValue(0),
      findLastSuccessful: jest.fn().mockResolvedValue(null),
    };
    configMock = {
      get: jest.fn((key: string, fallback?: string) => fallback),
    };

    service = new SafetyCheckService(
      policyRepoMock as never,
      historyMock as never,
      configMock as never,
    );
  });

  it('resolves the environment from NODE_ENV', () => {
    configMock.get.mockImplementation((key: string, fallback?: string) =>
      key === 'NODE_ENV' ? 'production' : fallback,
    );

    expect(service.getEnvironment()).toBe('production');
  });

  it('allows a safe action', async () => {
    const decision = await service.evaluate({
      actionType: 'restart_pod',
      target: 'agri-fi/backend-1',
      component: 'kubernetes',
      issueType: 'pod_failure',
      severity: 'critical',
      environment: 'production',
    });

    expect(decision.blocked).toBe(false);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.allowed).toBe(true);
  });

  it('blocks an action when no policy is registered', async () => {
    policyRepoMock.find.mockResolvedValue([]);

    const decision = await service.evaluate({
      actionType: 'restart_pod',
      target: 'agri-fi/backend-1',
      environment: 'staging',
    });

    expect(decision.blocked).toBe(true);
    expect(decision.reasons[0]).toContain('No remediation policy');
  });

  it('blocks an action that is not allowed in the environment', async () => {
    policyRepoMock.find.mockResolvedValue([
      buildPolicy({ allowedEnvironmentsJson: ['staging'] }),
    ]);

    const decision = await service.evaluate({
      actionType: 'restart_pod',
      target: 'agri-fi/backend-1',
      environment: 'production',
    });

    expect(decision.blocked).toBe(true);
    expect(decision.reasons.join(' ')).toContain('not allowed to run');
  });

  it('blocks a policy that has not been validated in staging', async () => {
    policyRepoMock.find.mockResolvedValue([
      buildPolicy({ stagingValidated: false }),
    ]);

    const decision = await service.evaluate({
      actionType: 'restart_pod',
      target: 'agri-fi/backend-1',
      environment: 'production',
    });

    expect(decision.blocked).toBe(true);
    expect(decision.reasons.join(' ')).toContain(
      'not been validated in staging',
    );
  });

  it('requires an approval for a destructive action in production', async () => {
    policyRepoMock.find.mockResolvedValue([
      buildPolicy({
        name: 'cleanup-disk-default',
        actionType: 'cleanup_disk',
        destructive: true,
      }),
    ]);

    const decision = await service.evaluate({
      actionType: 'cleanup_disk',
      target: 'node-1',
      component: 'host',
      environment: 'production',
    });

    expect(decision.blocked).toBe(false);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.allowed).toBe(false);
  });

  it('requires an approval for a critical issue with a risky action', async () => {
    policyRepoMock.find.mockResolvedValue([
      buildPolicy({
        name: 'scale-down-default',
        actionType: 'scale_down',
        destructive: false,
      }),
    ]);

    const decision = await service.evaluate({
      actionType: 'scale_down',
      target: 'agri-fi/backend',
      severity: 'critical',
      environment: 'production',
      parameters: { replicas: 2 },
    });

    expect(decision.requiresApproval).toBe(true);
  });

  it('blocks a protected component in production', async () => {
    const decision = await service.evaluate({
      actionType: 'restart_pod',
      target: 'agri-fi/postgres-0',
      component: 'database',
      environment: 'production',
    });

    expect(decision.blocked).toBe(true);
    expect(decision.reasons.join(' ')).toContain('protected component');
  });

  it('blocks a protected component but allows it in staging', async () => {
    const decision = await service.evaluate({
      actionType: 'restart_pod',
      target: 'agri-fi/postgres-0',
      component: 'database',
      environment: 'staging',
    });

    expect(decision.blocked).toBe(false);
  });

  it('blocks an action that exceeds the hourly execution limit', async () => {
    historyMock.countRecentExecutions.mockResolvedValue(5);

    const decision = await service.evaluate({
      actionType: 'restart_pod',
      target: 'agri-fi/backend-1',
      environment: 'staging',
    });

    expect(decision.blocked).toBe(true);
    expect(decision.reasons.join(' ')).toContain(
      'exceeds the configured limit',
    );
  });

  it('blocks an action that is still in its cooldown window', async () => {
    historyMock.findLastSuccessful.mockResolvedValue({
      id: 'action-1',
      actionType: 'restart_pod',
      target: 'agri-fi/backend-1',
      status: 'success',
      createdAt: new Date(Date.now() - 60_000),
    });

    const decision = await service.evaluate({
      actionType: 'restart_pod',
      target: 'agri-fi/backend-1',
      environment: 'staging',
    });

    expect(decision.blocked).toBe(true);
    expect(decision.reasons.join(' ')).toContain('cooldown');
  });

  it('blocks a scale action outside the allowed replica range', async () => {
    policyRepoMock.find.mockResolvedValue([
      buildPolicy({
        name: 'scale-up-default',
        actionType: 'scale_up',
        minReplicas: 2,
        maxReplicas: 5,
      }),
    ]);

    const decision = await service.evaluate({
      actionType: 'scale_up',
      target: 'agri-fi/backend',
      environment: 'staging',
      parameters: { replicas: 9 },
    });

    expect(decision.blocked).toBe(true);
    expect(decision.reasons.join(' ')).toContain('outside the allowed range');
  });

  it('blocks a custom script action without a script', async () => {
    policyRepoMock.find.mockResolvedValue([
      buildPolicy({
        name: 'custom-script-default',
        actionType: 'custom_script',
      }),
    ]);

    const decision = await service.evaluate({
      actionType: 'custom_script',
      target: 'node-1',
      environment: 'staging',
    });

    expect(decision.blocked).toBe(true);
    expect(decision.reasons.join(' ')).toContain('No remediation script');
  });

  it('blocks a custom script that is not allowed in the environment', async () => {
    policyRepoMock.find.mockResolvedValue([
      buildPolicy({
        name: 'custom-script-default',
        actionType: 'custom_script',
      }),
    ]);

    const decision = await service.evaluate({
      actionType: 'custom_script',
      target: 'node-1',
      environment: 'production',
      script: {
        requiresApproval: false,
        destructive: false,
        allowedEnvironments: ['staging'],
      },
    });

    expect(decision.blocked).toBe(true);
  });

  it('prefers the policy that matches the issue type', async () => {
    const generic = buildPolicy({ name: 'generic', issueType: null });
    const specific = buildPolicy({
      name: 'specific',
      issueType: 'pod_failure',
    });
    policyRepoMock.find.mockResolvedValue([generic, specific]);

    const decision = await service.evaluate({
      actionType: 'restart_pod',
      target: 'agri-fi/backend-1',
      issueType: 'pod_failure',
      environment: 'staging',
    });

    expect(decision.policyName).toBe('specific');
  });
});
