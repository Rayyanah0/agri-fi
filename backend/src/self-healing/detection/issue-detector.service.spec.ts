import { IssueDetectorService } from './issue-detector.service';
import {
  SELF_HEALING_DETECTION_RULES,
  breachesThreshold,
  buildComparisonExpression,
  buildDwellExpression,
} from './issue-detection-rules';

describe('IssueDetectorService', () => {
  let service: IssueDetectorService;
  let prometheusMock: {
    query: jest.Mock;
    getAlerts: jest.Mock;
  };
  let configMock: { get: jest.Mock };

  beforeEach(() => {
    prometheusMock = {
      query: jest.fn().mockResolvedValue([]),
      getAlerts: jest.fn().mockResolvedValue([]),
    };
    configMock = {
      get: jest.fn((key: string, fallback?: string) => fallback),
    };

    service = new IssueDetectorService(
      prometheusMock as never,
      configMock as never,
    );
  });

  it('reports no issue when Prometheus returns no series', async () => {
    prometheusMock.query.mockResolvedValue([]);

    const issues = await service.detect();

    expect(issues).toHaveLength(0);
  });

  it('detects an issue when a rule breaches its threshold', async () => {
    prometheusMock.query.mockImplementation(async (promQl: string) => {
      if (promQl.includes('kube_pod_container_status_restarts_total')) {
        return [
          {
            metric: { namespace: 'agri-fi', pod: 'backend-1' },
            value: 7,
            timestampMs: 0,
          },
        ];
      }
      return [];
    });

    const issues = await service.detect();

    const crashLoop = issues.find(
      (issue) => issue.issueType === 'pod_restart_loop',
    );

    expect(crashLoop).toBeDefined();
    expect(crashLoop?.target).toBe('agri-fi/backend-1');
    expect(crashLoop?.fingerprint).toBe('pod_restart_loop:agri-fi/backend-1');
    expect(crashLoop?.severity).toBe('critical');
  });

  it('ignores a breach that did not persist for the dwell window', async () => {
    prometheusMock.query.mockImplementation(async (promQl: string) => {
      if (promQl.includes('min_over_time')) {
        // The condition was not sustained for the whole window.
        return [];
      }
      if (promQl.includes('kube_pod_container_status_restarts_total')) {
        return [
          {
            metric: { namespace: 'agri-fi', pod: 'backend-1' },
            value: 7,
            timestampMs: 0,
          },
        ];
      }
      return [];
    });

    const issues = await service.detect();

    expect(
      issues.find((issue) => issue.issueType === 'pod_restart_loop'),
    ).toBeUndefined();
  });

  it('converts firing self-healing alerts into issues', async () => {
    prometheusMock.getAlerts.mockResolvedValue([
      {
        labels: {
          alertname: 'SelfHealingNodeDiskFull',
          severity: 'critical',
          component: 'host',
          issue_type: 'disk_full',
          self_healing: 'true',
          instance: 'node-1',
        },
        annotations: { summary: 'Disk is full' },
        state: 'firing',
        activeAt: new Date().toISOString(),
        value: '5',
      },
    ]);

    const issues = await service.detect();

    const diskIssue = issues.find((issue) => issue.issueType === 'disk_full');

    expect(diskIssue).toBeDefined();
    expect(diskIssue?.target).toBe('node-1');
    expect(diskIssue?.description).toBe('Disk is full');
  });

  it('ignores alerts that are not flagged for self-healing', async () => {
    prometheusMock.getAlerts.mockResolvedValue([
      {
        labels: {
          alertname: 'RedisMemoryUsageHigh',
          severity: 'warning',
          component: 'cache',
        },
        annotations: {},
        state: 'firing',
        activeAt: new Date().toISOString(),
        value: '90',
      },
    ]);

    const issues = await service.detect();

    expect(
      issues.find((issue) => issue.fingerprint === 'disk_full:node-1'),
    ).toBeUndefined();
  });

  it('never returns the same fingerprint twice', async () => {
    prometheusMock.getAlerts.mockResolvedValue([
      {
        labels: {
          alertname: 'SelfHealingNodeDiskFull',
          severity: 'critical',
          component: 'host',
          issue_type: 'disk_full',
          self_healing: 'true',
          instance: 'node-1',
        },
        annotations: {},
        state: 'firing',
        activeAt: new Date().toISOString(),
        value: '5',
      },
      {
        labels: {
          alertname: 'SelfHealingNodeDiskFullCopy',
          severity: 'critical',
          component: 'host',
          issue_type: 'disk_full',
          self_healing: 'true',
          instance: 'node-1',
        },
        annotations: {},
        state: 'firing',
        activeAt: new Date().toISOString(),
        value: '5',
      },
    ]);

    const issues = await service.detect();
    const fingerprints = issues.map((issue) => issue.fingerprint);

    expect(new Set(fingerprints).size).toBe(fingerprints.length);
  });
});

describe('self-healing detection rules', () => {
  it('defines unique rule identifiers', () => {
    const ids = SELF_HEALING_DETECTION_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds a comparison expression for both comparators', () => {
    const greaterRule = SELF_HEALING_DETECTION_RULES.find(
      (rule) => rule.comparator === 'gt',
    );
    const lowerRule = SELF_HEALING_DETECTION_RULES.find(
      (rule) => rule.comparator === 'lt',
    );

    expect(greaterRule).toBeDefined();
    expect(lowerRule).toBeDefined();
    expect(buildComparisonExpression(greaterRule!)).toContain('>');
    expect(buildComparisonExpression(lowerRule!)).toContain('<');
  });

  it('builds a dwell expression only for rules with a dwell time', () => {
    const withDwell = SELF_HEALING_DETECTION_RULES.find(
      (rule) => rule.forMinutes > 0,
    );
    const withoutDwell = SELF_HEALING_DETECTION_RULES.find(
      (rule) => rule.forMinutes === 0,
    );

    expect(buildDwellExpression(withDwell!)).toContain('min_over_time');
    expect(buildDwellExpression(withoutDwell!)).toBeNull();
  });

  it('compares values against the rule threshold', () => {
    const rule = SELF_HEALING_DETECTION_RULES.find(
      (candidate) => candidate.id === 'container-memory-high',
    )!;

    expect(breachesThreshold(rule, 0.9)).toBe(true);
    expect(breachesThreshold(rule, 0.5)).toBe(false);
  });
});
