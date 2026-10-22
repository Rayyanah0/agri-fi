# Alert triage map

This map is the on-call quick reference for the Prometheus rules in [devops/prometheus/alerts.yaml](../../devops/prometheus/alerts.yaml). It is intentionally concise so operators can answer three questions in under a minute: what is the signal, who owns it, and what to do next.

## Ownership model

- Backend team: database saturation, connection leaks, and replica lag affecting API correctness.
- Platform team: exporter health and infrastructure monitoring availability.
- PagerDuty routing is enabled for critical severities and for sustained failures that threaten API availability.

## Alert catalog

| Alert | Metric / signal | Severity | Team | Owner | Triage step | Runbook |
| --- | --- | --- | --- | --- | --- | --- |
| DatabasePoolHighUsage | `pg_stat_activity_count{datname="agri",state!="idle"} / pg_settings_max_connections * 100` | warning | backend | backend-oncall | Check for connection leaks, long transactions, and recent deploys. Verify read/ write traffic spikes before raising to incident. | https://runbooks.internal/agri-fi/db-pool |
| DatabasePoolCriticalUsage | `pg_stat_activity_count{datname="agri",state!="idle"} / pg_settings_max_connections * 100` | critical | backend | backend-oncall | Treat as active incident. Reduce connection churn, restart stuck workers if needed, and page the backend owner immediately. | https://runbooks.internal/agri-fi/db-pool |
| DatabaseIdleInTransactionConnections | `pg_stat_activity_count{datname="agri",state="idle in transaction"}` | warning | backend | backend-oncall | Find transactions that are stuck without commit/rollback and terminate the blocking session. | https://runbooks.internal/agri-fi/db-pool |
| DatabaseConnectionPoolExhausted | `pg_stat_activity_count{datname="agri",state!="idle"} >= pg_settings_max_connections` | critical | backend | backend-oncall | API requests will fail immediately. Check for runaway queries, app scaling, and recent migrations. | https://runbooks.internal/agri-fi/db-pool |
| DatabaseExporterDown | `up{job="postgres_exporter"} == 0` | warning | platform | platform-oncall | Validate exporter process, target discovery, and network path to the Postgres instance. Alerting may be partially blind until recovery. | https://runbooks.internal/agri-fi/postgres-exporter |
| DatabaseReplicationLagHigh | `pg_replication_lag_seconds` | warning | backend | backend-oncall | Confirm replica health, query load, and promotion readiness. Validate that read traffic is still safe to route. | https://runbooks.internal/agri-fi/replica-lag |
| DatabaseReplicationLagCritical | `pg_replication_lag_seconds` | critical | backend | backend-oncall | Escalate to the backend on-call, pause non-essential reads, and assess whether failover or promotion is required. | https://runbooks.internal/agri-fi/replica-lag |
| EscrowQueueDepthHigh | `rabbitmq_queue_messages{queue="escrow.process"} > 500` | warning | backend | backend-oncall | Inspect consumer health, log output, and scaling. Verify incoming investment throughput. | [docs/runbooks/escrow.md](../runbooks/escrow.md) |
| EscrowQueueDepthCritical | `rabbitmq_queue_messages{queue="escrow.process"} > 2000` | critical | backend | backend-oncall | Escrow release backlog. Scale consumer workers immediately and verify RabbitMQ connectivity. | [docs/runbooks/escrow.md](../runbooks/escrow.md) |
| DLQGrowing | `increase(rabbitmq_queue_messages{queue="escrow.dlq"}[15m]) > 0` | warning | backend | backend-oncall | Failed escrow releases accumulating. Inspect with `retry-dlq.ts --peek` and fix underlying error before replay. | [docs/runbooks/escrow.md](../runbooks/escrow.md) |
| DLQNotEmpty | `rabbitmq_queue_messages{queue="escrow.dlq"} > 0` | critical | backend | backend-oncall | Unprocessed dead-letter messages over 1 hour. PagerDuty on-call alert. Triage root cause and execute safe replay. | [docs/runbooks/escrow.md](../runbooks/escrow.md) |
| EscrowConsumerLag | `rabbitmq_queue_consumers{queue="escrow.process"} == 0` | warning | backend | backend-oncall | No active consumers on escrow processing queue. Restart consumer deployment or check pod crashes. | [docs/runbooks/escrow.md](../runbooks/escrow.md) |
| StellarTxFailureRate | `(rate(escrow_stellar_tx_failures_total[5m]) / rate(escrow_stellar_tx_total[5m])) * 100 > 5` | critical | backend | backend-oncall | Elevated Stellar blockchain failures. Check Horizon node health, fee stats, and account sequences. | [docs/runbooks/escrow.md](../runbooks/escrow.md) |
| OutboxStalledEvents | `outbox_pending_count > 50` | warning | backend | backend-oncall | Transactional outbox relay backlog. Check DB connection pool and RabbitMQ broker availability. | [docs/runbooks/escrow.md](../runbooks/escrow.md) |

### Self-healing alerts (#1194)

These rules live in [devops/prometheus/self-healing-alerts.yaml](../../devops/prometheus/self-healing-alerts.yaml) and carry the `self_healing: "true"` label. The backend turns them into detected issues and remediates them automatically when the safety policy allows it, so an on-call engineer usually only sees the notification, not the alert.

| Alert | Metric / signal | Severity | Team | Owner | Triage step | Runbook |
| --- | --- | --- | --- | --- | --- | --- |
| SelfHealingPodCrashLoop | `sum by (namespace, pod) (increase(kube_pod_container_status_restarts_total[15m])) > 3` | critical | platform | platform-oncall | The engine restarts the pod and diagnoses the previous container state. Confirm the crash cause in the container logs. | [docs/devops/self-healing.md](../devops/self-healing.md) |
| SelfHealingPodNotReady | `min by (namespace, pod) (kube_pod_status_ready{condition="true"}) == 0` | critical | platform | platform-oncall | The engine restarts the pod. If it stays unready, the readiness probe or the dependency is broken. | [docs/devops/self-healing.md](../devops/self-healing.md) |
| SelfHealingDeploymentUnavailable | `sum by (namespace, deployment) (kube_deployment_status_replicas_unavailable) > 0` | critical | platform | platform-oncall | The engine checks the affected pods. Verify the rollout and the image tag. | [docs/devops/self-healing.md](../devops/self-healing.md) |
| SelfHealingContainerMemoryHigh | `container_memory_working_set_bytes / container_spec_memory_limit_bytes > 0.85` | warning | platform | platform-oncall | The engine restarts the container. Raise the memory limit when it happens repeatedly. | [docs/devops/self-healing.md](../devops/self-healing.md) |
| SelfHealingContainerMemoryCritical | `container_memory_working_set_bytes / container_spec_memory_limit_bytes > 0.95` | critical | platform | platform-oncall | The engine restarts the container before it is OOM-killed. Profile the workload for a leak. | [docs/devops/self-healing.md](../devops/self-healing.md) |
| SelfHealingNodeDiskFull | `node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.1` | critical | platform | platform-oncall | The engine proposes a disk cleanup that requires an approval. Check for a log or image explosion. | [docs/devops/self-healing.md](../devops/self-healing.md) |
| SelfHealingNodeDiskWarning | `node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.2` | warning | platform | platform-oncall | Free space before the critical threshold is reached. | [docs/devops/self-healing.md](../devops/self-healing.md) |
| SelfHealingNodeMemoryPressure | `node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.1` | critical | platform | platform-oncall | The engine escalates because rescheduling is not safe to automate. Drain the node. | [docs/devops/self-healing.md](../devops/self-healing.md) |
| SelfHealingBackendErrorRate | `sum(rate(http_request_errors_total{status_code=~"5.."}[5m])) > 1` | critical | backend | backend-oncall | The engine proposes a rollout restart that requires an approval. Correlate with the last deployment. | [docs/devops/self-healing.md](../devops/self-healing.md) |
| SelfHealingBackendLatencyHigh | `histogram_quantile(0.99, sum by (le) (rate(http_request_duration_seconds_bucket[5m]))) > 2` | warning | backend | backend-oncall | The engine escalates. Check the downstream dependency latency. | [docs/devops/self-healing.md](../devops/self-healing.md) |
| SelfHealingQueueBacklog | `rabbitmq_queue_messages{queue="escrow.process"} > 500` | warning | backend | backend-oncall | The engine adds one replica to the consumer deployment. Verify the consumer throughput. | [docs/devops/self-healing.md](../devops/self-healing.md) |
| SelfHealingRedisMemoryHigh | `(redis_memory_used_bytes / redis_memory_max_bytes) * 100 > 85` | warning | backend | backend-oncall | The engine escalates because a cache restart does not fix a key growth problem. Review the TTLs. | [docs/devops/self-healing.md](../devops/self-healing.md) |
| SelfHealingDatabaseSaturation | `agri_fi:pg_connections_pct > 85` | critical | backend | backend-oncall | The engine escalates because scaling out would increase the pressure. Terminate long running sessions. | [docs/devops/self-healing.md](../devops/self-healing.md) |
| SelfHealingPgBouncerPoolHigh | `agri_fi:pgbouncer_server_pool_pct > 85` | warning | backend | backend-oncall | The engine escalates. Reload the pgbouncer configuration when the pool size drifted. | [docs/devops/self-healing.md](../devops/self-healing.md) |
| SelfHealingCertificateExpiring | `(probe_ssl_earliest_cert_expiry - time()) < 1209600` | warning | platform | platform-oncall | The engine proposes the certificate renewal script, which requires an approval. | [docs/devops/self-healing.md](../devops/self-healing.md) |

## Decision guide

1. If the alert is warning and the metric is trending steadily upward, investigate the app layer before opening a major incident.
2. If the alert is critical or `pagerduty: "true"`, route directly to the owning on-call and escalate to incident response if the application is rejecting requests.
3. If the postgres exporter is down, treat alert fidelity as degraded and validate monitoring infrastructure before blaming the database itself.

## Maintenance

Update this page whenever a Prometheus rule is added, removed, or re-scoped. The owner and runbook labels in [devops/prometheus/alerts.yaml](../../devops/prometheus/alerts.yaml) should be kept in sync with this document.
