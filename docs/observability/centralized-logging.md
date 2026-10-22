# Centralized Logging (EFK)

> **Issue:** #1236
> **Sources:** `backend/src/common/logging/logging.config.ts`, `devops/efk/`

## Overview

Agri-Fi aggregates logs from every backend service, webhook and on-chain worker
into a single, searchable Elasticsearch cluster and surfaces them through
Kibana. The stack is **EFK + Logstash**:

| Component     | Role                                                            |
|---------------|-----------------------------------------------------------------|
| Fluentd       | Tails container/application logs, parses JSON, enriches records |
| Logstash      | Alternative ingestion + parsing path for Beats/TCP sources      |
| Elasticsearch | Indexing, search, ILM retention and snapshots                   |
| Kibana        | Dashboards, analytics, alerting and access control              |

## Architecture

```
 containers / hosts
        │  (JSON logs from nestjs-pino)
        ▼
   Fluentd ─┐                       ┌─ Logstash (beats:5044 / tcp:5000)
            ├── parse + enrich ─────┘
            ▼
     Elasticsearch  ──►  agri-fi-logs (write alias)  ──►  agri-fi-logs-000001
            │                                             (ILM managed)
            ▼
         Kibana  ──►  data view, dashboards, alerting rules, role mappings
```

## Log shipping

### Fluentd (`devops/efk/fluentd.conf`)

- `tail` source reads `/var/log/containers/*.log`, parsing the JSON emitted by
  the NestJS pino logger (`time_key timestamp`).
- A nested `parser` decodes the wrapped `log` field.
- `record_transformer` normalises fields and promotes `traceId`,
  `correlationId`, `userId`, `txHash`, `operation`, `durationMs`, `status`, and
  stamps `environment`/`service` on every record.
- A `grep` filter drops `/health`, `/healthz`, `/metrics` noise.
- Output writes to the `agri-fi-logs` ILM rollover alias.

### Logstash (`devops/efk/logstash/pipeline/logstash.conf`)

- Inputs: Beats on `5044` and JSON-over-TCP on `5000`.
- Parses the ISO-8601 `timestamp`, unwraps Kubernetes `log` lines, fills
  `environment`/`service`, derives `correlationId`/`status`, drops health checks
  and coerces numeric fields.
- Writes to Elasticsearch with `ilm_enabled`, rollover alias `agri-fi-logs` and
  policy `agri-fi-logs-retention`.

### Application-side fields

The backend logger (`logging.config.ts`) emits one JSON object per line with,
at minimum:

| Field           | Example                       | Notes                          |
|-----------------|-------------------------------|--------------------------------|
| `level`         | `info` / `warn` / `error`     | name-formatted                 |
| `timestamp`     | `2026-01-01T10:00:00.000Z`    | ISO-8601, used as time field   |
| `service`       | `agri-fi-backend`             | static base field              |
| `version`       | `0.1.0`                       | package version                |
| `traceId`       | `…`                           | request correlation id         |
| `correlationId` | `…`                           | backwards-compatible alias     |
| `context`       | `EscrowService`               | Nest logger context            |
| `msg`           | `Payment released`            | message                        |
| `req`           | `{method,url,userAgent,…}`    | HTTP request                   |
| `res`           | `{statusCode}`                | HTTP response                  |

## Indexing

`devops/efk/index-template.json` maps `agri-fi-*`:

- Time field: **`timestamp`** (plus `@timestamp`).
- Keyword fields for filtering/aggregation: `level`, `service`, `environment`,
  `context`, `traceId`, `spanId`, `correlationId`, `userId`, `txHash`,
  `operation`, `status`.
- Numeric: `durationMs`, `res.statusCode`.
- Nested objects: `req`, `res`, `kubernetes`, `container`, `host`.

Indices are created as `agri-fi-logs-000001`, `…-000002`, … behind the
`agri-fi-logs` **write alias**.

## Retention

`devops/efk/ilm-policy.json` (`agri-fi-logs-retention`) manages the lifecycle:

| Phase  | Age    | Action                                            |
|--------|--------|---------------------------------------------------|
| hot    | 0d     | rollover at 50 GB or 1d, priority 100             |
| warm   | 7d     | priority 50, shrink to 1 shard                    |
| cold   | 30d    | priority 0, searchable snapshot to `s3-backup-repo` |
| frozen | 90d    | searchable snapshot                               |
| delete | 180d   | delete (and drop searchability)                   |

Snapshots are stored in the S3 repository configured by `s3-repository.json`.

## Analytics & dashboards

Kibana exposes an **Agri-Fi Logs** data view (`agri-fi-logs*`, time field
`timestamp`) and the **Agri-Fi Platform Logs** dashboard, which ships with two
saved searches:

- *Errors & warnings* — `level : (error or fatal)`.
- *Failed requests (5xx)* — `res.statusCode >= 500`.

Useful ad-hoc queries:

| Question                       | KQL                                                          |
|--------------------------------|-------------------------------------------------------------|
| Trace a request across services| `traceId : "<id>"`                                          |
| Errors for one service         | `service : "agri-fi-backend" and level : (error or fatal)`  |
| Slow requests                  | `durationMs > 2000`                                         |
| On-chain activity              | `operation : * and txHash : *`                              |

## Alerting

`devops/efk/kibana/alerting-rules.json` defines threshold rules
(`.index-threshold`, `consumer: alerts`), installed by `setup-kibana.sh`:

| Rule                                          | Condition (5m)                                  |
|-----------------------------------------------|-------------------------------------------------|
| High error rate                               | `level:(error or fatal)` count **> 100**        |
| Authentication failure spike                  | unauthorized/forbidden messages count **> 20**  |
| Escrow/payment processing errors              | escrow/settlement errors count **> 5**          |
| Log ingestion stopped                         | total log count **< 1** in 10m                  |

Rules have no actions by default; connect an email/Slack/webhook connector in
Kibana (`Stack Management → Connectors`) and attach it to the rule.

## Security & access control

Security is disabled for local development (`XPACK_SECURITY_ENABLED=false`) and
must be enabled in production. `security/setup-security.sh` provisions:

### RBAC roles (`security/roles.json`)

| Role                  | Scope                                                                |
|-----------------------|----------------------------------------------------------------------|
| `agri_fi_logs_writer` | Index/write `agri-fi-*` (used by Fluentd/Logstash service accounts)  |
| `agri_fi_logs_viewer` | Read-only index access + Kibana dashboard/discover/logs read         |
| `agri_fi_logs_admin`  | Full index/ILM/template management + all Kibana features             |

### Access control

- Shipping uses a dedicated **API key** (`agri-fi-logs-shipper`) scoped to the
  writer role — no superuser credentials on shippers.
- Human access is via the `agri_fi_viewer` / `agri_fi_admin` users, or SSO with
  role mappings (`kibana/role-mappings.json`) mapping IdP groups
  (`agri-fi-support`, `agri-fi-oncall`, `agri-fi-platform-admins`) to roles.
- Enable TLS between shippers, Elasticsearch and Kibana in production.

## Deployment

Local (development):

```bash
cd devops/efk
cp .env.example .env
docker compose up -d
./elasticsearch-setup.sh          # ILM, template, bootstrap index
XPACK_SECURITY_ENABLED=true ELASTIC_PASSWORD=... ./security/setup-security.sh
KIBANA_PASSWORD=... ./kibana/setup-kibana.sh
```

Kubernetes uses Filebeat/Fluent Bit DaemonSets pointed at Logstash (see
`devops/k8s/`); the ILM policy, template and dashboards are applied by the
scripts.

## Configuration

| Variable                 | Default          | Purpose                                  |
|--------------------------|------------------|------------------------------------------|
| `XPACK_SECURITY_ENABLED` | `false`          | Enable authentication/TLS                |
| `ELASTIC_PASSWORD`       | `changeme`       | `elastic`/service-account password       |
| `KIBANA_*_KEY`           | dev keys         | Kibana saved-object encryption keys      |
| `LOG_ENVIRONMENT`        | `development`    | `environment` field on every record      |
| `ELASTICSEARCH_HOST/PORT/SCHEME` | `elasticsearch`/`9200`/`http` | Shipper target      |
| `ELASTICSEARCH_USER/PASSWORD` | _(blank)_   | Shipper credentials (writer user/API key)|
| `LOG_LEVEL`              | `info`           | Backend logger level                     |
| `LOG_PRETTY`             | _(unset)_        | Dev-only human-readable output           |

## Operations

```bash
# Cluster health
curl -s localhost:9200/_cluster/health | jq .

# ILM progress
curl -s localhost:9200/agri-fi-logs/_ilm/explain | jq .

# Alias / index listing
curl -s "localhost:9200/_cat/indices/agri-fi-*?v"

# Take an ad-hoc snapshot
curl -s -X PUT localhost:9200/_snapshot/s3-backup-repo/manual-%3Cts%3E?wait_for_completion=true
```

See `elasticsearch-setup.sh`, `security/setup-security.sh` and
`kibana/setup-kibana.sh` for idempotent bootstrap steps.
