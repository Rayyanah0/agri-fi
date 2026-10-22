import type { RemediationActionType } from '../entities/remediation-action.entity';
import type {
  SelfHealingIssueType,
  SelfHealingSeverity,
} from '../entities/self-healing-issue.entity';

/**
 * A declarative detection rule.
 *
 * Rules are evaluated against the existing Prometheus deployment. The
 * `promQl` expression returns the current value of the monitored signal; the
 * rule fires when that value breaches `threshold`. When `forMinutes` is
 * greater than zero the detector additionally proves that the breach was
 * sustained for the whole window before reporting the issue, which filters
 * out short-lived spikes.
 */
export interface SelfHealingDetectionRule {
  id: string;
  issueType: SelfHealingIssueType;
  severity: SelfHealingSeverity;
  component: string;
  description: string;
  promQl: string;
  comparator: 'gt' | 'lt';
  threshold: number;
  forMinutes: number;
  /** Labels used to build the identity of the affected resource. */
  targetLabels: string[];
  /** Remediation actions attempted when no root cause specific plan exists. */
  defaultActions: RemediationActionType[];
}

const NAMESPACE = 'agri-fi';

/**
 * Detection rules for the self-healing engine.
 *
 * The PromQL below intentionally reuses the metrics that are already
 * scraped by `devops/prometheus/prometheus.yml` (backend, RabbitMQ,
 * PgBouncer) plus the standard cluster exporters (kube-state-metrics and
 * node-exporter) that the platform team deploys alongside them.
 */
export const SELF_HEALING_DETECTION_RULES: SelfHealingDetectionRule[] = [
  {
    id: 'pod-restart-loop',
    issueType: 'pod_restart_loop',
    severity: 'critical',
    component: 'kubernetes',
    description:
      'Container is restarting repeatedly, which usually indicates a crash loop.',
    promQl: `sum by (namespace, pod) (increase(kube_pod_container_status_restarts_total{namespace="${NAMESPACE}"}[15m]))`,
    comparator: 'gt',
    threshold: 3,
    forMinutes: 10,
    targetLabels: ['namespace', 'pod'],
    defaultActions: ['restart_pod'],
  },
  {
    id: 'pod-not-ready',
    issueType: 'pod_failure',
    severity: 'critical',
    component: 'kubernetes',
    description: 'Pod has been unready for longer than the tolerated window.',
    promQl: `min by (namespace, pod) (kube_pod_status_ready{namespace="${NAMESPACE}",condition="true"})`,
    comparator: 'lt',
    threshold: 1,
    forMinutes: 5,
    targetLabels: ['namespace', 'pod'],
    defaultActions: ['restart_pod'],
  },
  {
    id: 'deployment-replicas-unavailable',
    issueType: 'service_down',
    severity: 'critical',
    component: 'kubernetes',
    description: 'Deployment has replicas that failed to become available.',
    promQl: `sum by (namespace, deployment) (kube_deployment_status_replicas_unavailable{namespace="${NAMESPACE}"})`,
    comparator: 'gt',
    threshold: 0,
    forMinutes: 5,
    targetLabels: ['namespace', 'deployment'],
    defaultActions: ['restart_pod'],
  },
  {
    id: 'container-memory-high',
    issueType: 'high_memory',
    severity: 'warning',
    component: 'kubernetes',
    description:
      'Container working set exceeds 85% of its configured memory limit.',
    promQl: `max by (namespace, pod, container) ((container_memory_working_set_bytes{namespace="${NAMESPACE}",container!="",container!="POD"} / container_spec_memory_limit_bytes{namespace="${NAMESPACE}",container!="",container!="POD"}))`,
    comparator: 'gt',
    threshold: 0.85,
    forMinutes: 10,
    targetLabels: ['namespace', 'pod'],
    defaultActions: ['restart_pod'],
  },
  {
    id: 'container-memory-critical',
    issueType: 'high_memory',
    severity: 'critical',
    component: 'kubernetes',
    description:
      'Container working set exceeds 95% of its configured memory limit.',
    promQl: `max by (namespace, pod, container) ((container_memory_working_set_bytes{namespace="${NAMESPACE}",container!="",container!="POD"} / container_spec_memory_limit_bytes{namespace="${NAMESPACE}",container!="",container!="POD"}))`,
    comparator: 'gt',
    threshold: 0.95,
    forMinutes: 3,
    targetLabels: ['namespace', 'pod'],
    defaultActions: ['restart_pod'],
  },
  {
    id: 'node-disk-full',
    issueType: 'disk_full',
    severity: 'critical',
    component: 'host',
    description: 'Filesystem free space dropped below 10%.',
    promQl: `max by (instance, mountpoint) ((node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}))`,
    comparator: 'lt',
    threshold: 0.1,
    forMinutes: 5,
    targetLabels: ['instance'],
    defaultActions: ['cleanup_disk'],
  },
  {
    id: 'node-disk-warning',
    issueType: 'disk_full',
    severity: 'warning',
    component: 'host',
    description: 'Filesystem free space dropped below 20%.',
    promQl: `max by (instance, mountpoint) ((node_filesystem_avail_bytes{mountpoint="/",fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{mountpoint="/",fstype!~"tmpfs|overlay"}))`,
    comparator: 'lt',
    threshold: 0.2,
    forMinutes: 15,
    targetLabels: ['instance'],
    defaultActions: ['cleanup_disk'],
  },
  {
    id: 'node-memory-pressure',
    issueType: 'high_memory',
    severity: 'critical',
    component: 'host',
    description: 'Node is under memory pressure and close to being OOM killed.',
    promQl: `min by (instance) ((node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))`,
    comparator: 'lt',
    threshold: 0.1,
    forMinutes: 5,
    targetLabels: ['instance'],
    defaultActions: [],
  },
  {
    id: 'backend-error-rate',
    issueType: 'service_down',
    severity: 'critical',
    component: 'backend',
    description: 'Backend is returning 5xx responses at a sustained rate.',
    promQl: `sum(rate(http_request_errors_total{status_code=~"5.."}[5m]))`,
    comparator: 'gt',
    threshold: 1,
    forMinutes: 5,
    targetLabels: [],
    defaultActions: ['restart_service'],
  },
  {
    id: 'backend-latency-p99',
    issueType: 'service_degradation',
    severity: 'warning',
    component: 'backend',
    description: 'Backend p99 request latency exceeds 2 seconds.',
    promQl: `histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))`,
    comparator: 'gt',
    threshold: 2,
    forMinutes: 10,
    targetLabels: [],
    defaultActions: [],
  },
  {
    id: 'rabbitmq-queue-backlog',
    issueType: 'queue_backlog',
    severity: 'warning',
    component: 'rabbitmq',
    description: 'Escrow queue backlog exceeds 500 pending messages.',
    promQl: `max by (queue) (rabbitmq_queue_messages{queue="escrow.process"})`,
    comparator: 'gt',
    threshold: 500,
    forMinutes: 5,
    targetLabels: ['queue'],
    defaultActions: ['scale_up'],
  },
  {
    id: 'redis-memory-high',
    issueType: 'high_memory',
    severity: 'warning',
    component: 'redis',
    description: 'Redis memory usage exceeds 85% of the configured maxmemory.',
    promQl: `max by (instance) ((redis_memory_used_bytes / redis_memory_max_bytes) * 100)`,
    comparator: 'gt',
    threshold: 85,
    forMinutes: 5,
    targetLabels: ['instance'],
    defaultActions: ['restart_service'],
  },
  {
    id: 'db-connection-saturation',
    issueType: 'database_saturation',
    severity: 'critical',
    component: 'database',
    description:
      'PostgreSQL connections exceed 85% of the configured max_connections.',
    promQl: `max(agri_fi:pg_connections_pct)`,
    comparator: 'gt',
    threshold: 85,
    forMinutes: 5,
    targetLabels: [],
    defaultActions: [],
  },
  {
    id: 'pgbouncer-pool-high',
    issueType: 'database_saturation',
    severity: 'warning',
    component: 'pgbouncer',
    description: 'PgBouncer server pool utilisation exceeds 85%.',
    promQl: `max(agri_fi:pgbouncer_server_pool_pct)`,
    comparator: 'gt',
    threshold: 85,
    forMinutes: 5,
    targetLabels: [],
    defaultActions: [],
  },
  {
    id: 'certificate-expiring',
    issueType: 'certificate_expiry',
    severity: 'warning',
    component: 'ingress',
    description: 'TLS certificate expires within 14 days.',
    promQl: `min((probe_ssl_earliest_cert_expiry - time()) / 3600)`,
    comparator: 'lt',
    threshold: 336,
    forMinutes: 0,
    targetLabels: ['instance'],
    defaultActions: ['custom_script'],
  },
];

/**
 * Build the PromQL expression that evaluates to 1 when the rule breach is
 * true and 0 otherwise.
 */
export function buildComparisonExpression(
  rule: SelfHealingDetectionRule,
): string {
  return rule.comparator === 'gt'
    ? `(${rule.promQl}) > ${rule.threshold}`
    : `(${rule.promQl}) < ${rule.threshold}`;
}

/**
 * Build the PromQL expression that proves the breach persisted for the
 * whole dwell window. Returns `null` when the rule has no dwell time.
 */
export function buildDwellExpression(
  rule: SelfHealingDetectionRule,
): string | null {
  if (rule.forMinutes <= 0) {
    return null;
  }
  const comparison = buildComparisonExpression(rule);
  return `min_over_time((${comparison})[${rule.forMinutes}m:1m]) > 0`;
}

/**
 * Compare a measured value against the rule threshold.
 */
export function breachesThreshold(
  rule: SelfHealingDetectionRule,
  value: number,
): boolean {
  return rule.comparator === 'gt'
    ? value > rule.threshold
    : value < rule.threshold;
}
