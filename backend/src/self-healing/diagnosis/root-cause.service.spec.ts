import { RootCauseAnalysisService } from './root-cause.service';
import { SelfHealingIssue } from '../entities/self-healing-issue.entity';

describe('RootCauseAnalysisService', () => {
  let service: RootCauseAnalysisService;
  let prometheusMock: { query: jest.Mock };
  let historyMock: { summariseTargetHistory: jest.Mock };

  const buildIssue = (overrides: Partial<SelfHealingIssue> = {}) => {
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

  beforeEach(() => {
    prometheusMock = { query: jest.fn().mockResolvedValue([]) };
    historyMock = {
      summariseTargetHistory: jest.fn().mockResolvedValue({
        total: 0,
        success: 0,
        failed: 0,
        skipped: 0,
      }),
    };

    service = new RootCauseAnalysisService(
      prometheusMock as never,
      historyMock as never,
    );
  });

  it('identifies an OOM kill as the root cause', async () => {
    prometheusMock.query.mockImplementation(async (promQl: string) => {
      if (promQl.includes('last_terminated_reason')) {
        return [
          {
            metric: {
              namespace: 'agri-fi',
              pod: 'backend-1',
              reason: 'OOMKilled',
            },
            value: 1,
            timestampMs: 0,
          },
        ];
      }
      return [];
    });

    const analysis = await service.analyse(buildIssue());

    expect(analysis.matchedRuleId).toBe('pod-oom-killed');
    expect(analysis.confidence).toBeGreaterThan(0.9);
    expect(analysis.rootCause).toContain('OOM-killed');
    expect(analysis.recommendedActions).toContain('restart_pod');
  });

  it('identifies an image pull failure and escalates to an operator', async () => {
    prometheusMock.query.mockImplementation(async (promQl: string) => {
      if (promQl.includes('waiting_reason')) {
        return [
          {
            metric: {
              namespace: 'agri-fi',
              pod: 'backend-1',
              reason: 'ImagePullBackOff',
            },
            value: 1,
            timestampMs: 0,
          },
        ];
      }
      return [];
    });

    const analysis = await service.analyse(buildIssue());

    expect(analysis.matchedRuleId).toBe('pod-image-pull-failure');
    expect(analysis.recommendedActions).toEqual(['manual']);
    expect(analysis.requiresManualIntervention).toBe(true);
  });

  it('detects a container whose memory limit is too low', async () => {
    const analysis = await service.analyse(
      buildIssue({
        issueType: 'high_memory',
        component: 'kubernetes',
        metricsSnapshotJson: { value: 0.97 },
      }),
    );

    expect(analysis.matchedRuleId).toBe('container-memory-limit-too-low');
    expect(analysis.recommendedActions).toContain('restart_pod');
  });

  it('recommends a disk cleanup for a full host filesystem', async () => {
    const analysis = await service.analyse(
      buildIssue({
        issueType: 'disk_full',
        component: 'host',
        target: 'node-1',
        fingerprint: 'disk_full:node-1',
      }),
    );

    expect(analysis.matchedRuleId).toBe('host-disk-full');
    expect(analysis.recommendedActions).toEqual(['cleanup_disk']);
  });

  it('falls back to a generic cause when nothing matches', async () => {
    const analysis = await service.analyse(
      buildIssue({
        issueType: 'custom',
        component: 'unknown',
        fingerprint: 'custom:unknown',
      }),
    );

    expect(analysis.matchedRuleId).toBe('generic');
    expect(analysis.confidence).toBeLessThan(0.5);
    expect(analysis.recommendedActions).toHaveLength(0);
  });

  it('collects the remediation history of the target as evidence', async () => {
    historyMock.summariseTargetHistory.mockResolvedValue({
      total: 4,
      success: 1,
      failed: 3,
      skipped: 0,
    });

    const analysis = await service.analyse(buildIssue());

    expect(analysis.evidence['history.recentActionCount']).toBe(4);
    expect(analysis.evidence['history.recentFailureCount']).toBe(3);
  });

  it('does not query pod signals for a target without a namespace', async () => {
    await service.analyse(
      buildIssue({ target: 'backend-1', fingerprint: 'pod_failure:backend-1' }),
    );

    expect(prometheusMock.query).not.toHaveBeenCalled();
  });
});
