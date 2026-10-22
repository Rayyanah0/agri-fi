# Edge Computing Architecture

## Components

Each remote K3s region runs a single edge agent behind an internal ClusterIP. The agent validates local event payloads, appends them to a permission-restricted persistent NDJSON spool, and asynchronously sends bounded batches to the cloud control plane over HTTPS. HMAC-SHA256 signatures include a timestamp, method, URL path, and canonical JSON body; the backend enforces a five-minute replay window and compares signatures in constant time. Node secrets are configured independently with `EDGE_NODE_SECRET_<NORMALIZED_NODE_ID>` on the backend and `EDGE_NODE_SECRET` on the node.

The edge API exposes:

- `POST /v1/edge/heartbeat` for node region, latency, queue depth, byte totals, and degraded status.
- `POST /v1/edge/sync` for bounded, idempotent event batches. The cloud stores payload hashes and rejects reused event IDs with different content.
- `GET /v1/edge/status` and `GET /v1/edge/analytics` for JWT-authenticated administrators. Stale heartbeats are reported offline; the lowest-latency online node is suggested as preferred, not automatically promoted.

The local agent provides `POST /events` and `GET /health` on the region's private network. It is not an internet-facing endpoint. Configure the K3s ingress/firewall to permit only trusted local workloads and prevent public access.

## Deployment and security

Build `devops/edge/agent/Dockerfile`, publish it to the configured regional registry, apply `devops/k8s/edge/`, and set `EDGE_NODE_ID`, `EDGE_REGION`, and HTTPS `EDGE_CLOUD_API_URL` in the included `agri-fi-edge-config` ConfigMap. Create `agri-fi-edge-credentials` with `EDGE_NODE_SECRET`, and configure the matching backend variable `EDGE_NODE_SECRET_<NORMALIZED_NODE_ID>` (for `edge-region-1`, use `EDGE_NODE_SECRET_EDGE_REGION_1`). Use a unique random secret of at least 32 characters per node, rotate secrets by replacing the node secret and corresponding cloud environment configuration, and terminate TLS with a trusted certificate. The pod uses a non-root UID, read-only root filesystem, dropped Linux capabilities, disabled service-account token mounting, bounded resources, network policy, and persistent spool volume.

The cloud sync endpoint currently durably records validated events; it does not automatically replay arbitrary events into domain tables. Consumers must validate each event type and apply domain mutations idempotently before enabling business-critical offline writes. The sample agent provides local durable queuing but does not embed a full agricultural analytics engine or application data cache; add those domain-specific processors behind the local `/events` boundary.

## Failover, monitoring, and expected impact

The control plane reports stale/offline nodes and a preferred healthy node. Application clients or regional ingress must use that signal with an explicitly configured cloud fallback; automatic DNS or traffic switching is deliberately not performed by the API. Operators should alert on offline nodes, growing queue depth, old unsynced events, heartbeat latency, and repeated HMAC failures using the returned status/analytics fields and existing Prometheus/alerting infrastructure.

An 80% latency reduction is a measurement target, not a source-code guarantee. Establish a regional baseline and compare p50/p95 end-to-end latency with edge processing enabled under representative connectivity, workload, and failure conditions before making that claim.