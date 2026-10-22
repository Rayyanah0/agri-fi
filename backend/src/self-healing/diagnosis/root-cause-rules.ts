import type { RemediationActionType } from '../entities/remediation-action.entity';
import type { SelfHealingIssueType } from '../entities/self-healing-issue.entity';

/**
 * A predicate used to match a collected signal against a root cause rule.
 */
export type SignalMatcher = (value: unknown) => boolean;

/**
 * A rule that maps observed signals to a diagnosed root cause and the
 * remediation actions that are appropriate for it.
 */
export interface RootCauseRule {
  id: string;
  issueType: SelfHealingIssueType;
  /** Every entry must match for the rule to be considered. */
  match: Record<string, SignalMatcher>;
  rootCause: string;
  confidence: number;
  recommendedActions: RemediationActionType[];
  /**
   * When true the automation only applies a temporary mitigation and a human
   * still has to perform the permanent fix.
   */
  requiresManualIntervention?: boolean;
  /** Extra guidance included in the remediation notification. */
  guidance?: string;
}

export const equals =
  (expected: unknown): SignalMatcher =>
  (value) =>
    value === expected;

export const includes =
  (needle: string): SignalMatcher =>
  (value) =>
    typeof value === 'string' &&
    value.toLowerCase().includes(needle.toLowerCase());

export const greaterThan =
  (min: number): SignalMatcher =>
  (value) =>
    typeof value === 'number' && value > min;

export const lessThan =
  (max: number): SignalMatcher =>
  (value) =>
    typeof value === 'number' && value < max;

export const isTrue = (): SignalMatcher => (value) => value === true;

/**
 * Knowledge base used by the root cause analysis service. Rules are evaluated
 * in order and the first fully matching rule wins.
 */
export const ROOT_CAUSE_RULES: RootCauseRule[] = [
  {
    id: 'pod-oom-killed',
    issueType: 'pod_failure',
    match: { 'pod.lastTerminatedReason': includes('oomkilled') },
    rootCause:
      'Container was OOM-killed: the configured memory limit is lower than the real workload footprint.',
    confidence: 0.95,
    recommendedActions: ['restart_pod'],
    requiresManualIntervention: true,
    guidance:
      'Raise the container memory limit in the deployment manifest; a restart only restores service temporarily.',
  },
  {
    id: 'pod-image-pull-failure',
    issueType: 'pod_failure',
    match: { 'pod.waitingReason': includes('imagepull') },
    rootCause:
      'Container image cannot be pulled (missing tag, expired registry credentials or revoked image pull secret).',
    confidence: 0.9,
    recommendedActions: ['manual'],
    requiresManualIntervention: true,
    guidance:
      'Verify the image tag and the registry pull secret before the deployment can schedule new pods.',
  },
  {
    id: 'pod-crash-loop',
    issueType: 'pod_restart_loop',
    match: { 'pod.waitingReason': includes('crashloop') },
    rootCause:
      'Application crashes during startup and Kubernetes is backing off between restarts.',
    confidence: 0.85,
    recommendedActions: ['restart_pod'],
    requiresManualIntervention: true,
    guidance:
      'Inspect the previous container logs; a restart only buys time until the crash repeats.',
  },
  {
    id: 'pod-liveness-probe-failing',
    issueType: 'pod_failure',
    match: { 'pod.waitingReason': includes('unhealthy') },
    rootCause:
      'Liveness probe is failing, so Kubernetes is restarting the container even though the process itself is alive.',
    confidence: 0.75,
    recommendedActions: ['restart_pod'],
    requiresManualIntervention: true,
    guidance:
      'Review the liveness probe timeout and path against the current load profile.',
  },
  {
    id: 'pod-repeated-restarts',
    issueType: 'pod_restart_loop',
    match: { 'pod.restartCount': greaterThan(3) },
    rootCause:
      'Container restarts repeatedly, which points to a crash or an OOM kill inside the workload.',
    confidence: 0.6,
    recommendedActions: ['restart_pod'],
    requiresManualIntervention: true,
    guidance:
      'Collect the container logs of the previous instance before the restart.',
  },
  {
    id: 'pod-not-ready-generic',
    issueType: 'pod_failure',
    match: { 'issue.component': equals('kubernetes') },
    rootCause:
      'Pod is not ready and no container level termination signal is available.',
    confidence: 0.4,
    recommendedActions: ['restart_pod'],
  },
  {
    id: 'container-memory-limit-too-low',
    issueType: 'high_memory',
    match: { 'container.memoryRatio': greaterThan(0.9) },
    rootCause:
      'Container memory consumption is close to its limit, so the limit is probably too low for the workload.',
    confidence: 0.8,
    recommendedActions: ['restart_pod'],
    requiresManualIntervention: true,
    guidance:
      'Increase the container memory limit or profile the workload for a leak before the next peak.',
  },
  {
    id: 'host-memory-pressure',
    issueType: 'high_memory',
    match: { 'issue.component': equals('host') },
    rootCause:
      'Host is under memory pressure, which usually means too many workloads share the node.',
    confidence: 0.7,
    recommendedActions: ['manual'],
    requiresManualIntervention: true,
    guidance:
      'Reschedule or scale workloads across nodes before the kernel OOM killer intervenes.',
  },
  {
    id: 'redis-memory-pressure',
    issueType: 'high_memory',
    match: { 'issue.component': equals('redis') },
    rootCause:
      'Redis is close to its maxmemory limit, so keys are accumulating faster than they expire.',
    confidence: 0.7,
    recommendedActions: ['manual'],
    requiresManualIntervention: true,
    guidance:
      'Review key TTLs and the eviction policy instead of restarting the cache.',
  },
  {
    id: 'host-disk-full',
    issueType: 'disk_full',
    match: { 'issue.component': equals('host') },
    rootCause:
      'Filesystem is nearly full; container logs, images and temporary files are the usual consumers.',
    confidence: 0.75,
    recommendedActions: ['cleanup_disk'],
  },
  {
    id: 'container-disk-full',
    issueType: 'disk_full',
    match: { 'issue.component': equals('kubernetes') },
    rootCause:
      'Container writable layer is filling up, usually because of verbose logs or unbounded file writes.',
    confidence: 0.7,
    recommendedActions: ['cleanup_disk'],
  },
  {
    id: 'queue-consumer-lag',
    issueType: 'queue_backlog',
    match: { 'issue.component': equals('rabbitmq') },
    rootCause:
      'Consumer throughput is below the message arrival rate, so the backlog keeps growing.',
    confidence: 0.7,
    recommendedActions: ['scale_up'],
  },
  {
    id: 'database-pool-saturation',
    issueType: 'database_saturation',
    match: { 'issue.component': equals('database') },
    rootCause:
      'Database connection pool is saturated; adding application replicas would increase the pressure.',
    confidence: 0.75,
    recommendedActions: ['manual'],
    requiresManualIntervention: true,
    guidance:
      'Terminate long running idle-in-transaction sessions or raise max_connections before scaling out.',
  },
  {
    id: 'backend-error-spike',
    issueType: 'service_down',
    match: { 'issue.component': equals('backend') },
    rootCause:
      'Backend returns 5xx responses, most likely after a bad deployment or because of a failing dependency.',
    confidence: 0.5,
    recommendedActions: ['restart_service'],
    requiresManualIntervention: true,
    guidance:
      'Correlate the error spike with the last deployment and the dependency dashboards.',
  },
  {
    id: 'backend-latency-degradation',
    issueType: 'service_degradation',
    match: { 'issue.component': equals('backend') },
    rootCause:
      'Request latency degraded, which usually points to a slow downstream dependency or an exhausted pool.',
    confidence: 0.45,
    recommendedActions: ['manual'],
    requiresManualIntervention: true,
  },
  {
    id: 'certificate-expiring',
    issueType: 'certificate_expiry',
    match: { 'issue.component': equals('ingress') },
    rootCause:
      'TLS certificate is close to expiry and has to be renewed before it expires.',
    confidence: 0.9,
    recommendedActions: ['custom_script'],
    requiresManualIntervention: true,
    guidance: 'Run the certificate renewal routine and verify the issuer.',
  },
];

/**
 * Fallback rule used when no specific rule matches.
 */
export const GENERIC_ROOT_CAUSE_RULE: RootCauseRule = {
  id: 'generic',
  issueType: 'custom',
  match: {},
  rootCause:
    'No specific root cause signature matched; the issue is reported with the raw metric signal.',
  confidence: 0.25,
  recommendedActions: [],
  requiresManualIntervention: true,
};
