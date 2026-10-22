# Audit log retention and archival

## Retention schedule

Retention is measured from the audit record's creation time:

| Log type | Retention period |
| --- | --- |
| Financial transactions | 7 years |
| KYC documents | 5 years |
| Operational logs | 1 year |
| Debug logs | 90 days |

The audit interceptor classifies KYC/document and financial routes; unclassified
requests are operational. Trade-deal entity audit events and transaction audit
rows are financial. The `log_type`, `retention_period`, and `retention_until`
columns preserve the classification and expiry for each record.

Records stay in PostgreSQL for the first 30 days by default. After that, the
daily 02:00 UTC job archives non-debug records to S3 Glacier, verifies the
stored version and SHA-256 metadata, writes the archive index, and only then
removes the primary row. Debug records remain in the primary database and are
deleted when their 90-day period expires. Other expired primary records are
deleted without being archived. Cold copies and their index remain available
until the original creation-based retention expiry, after which the job deletes
the exact S3 object version and database index. A failed archive or verification
leaves the primary record in place.

## S3 setup

Archival is disabled unless `AUDIT_RETENTION_ENABLED=true`. Configure
`AUDIT_ARCHIVE_S3_BUCKET`, `AWS_REGION`, and `AUDIT_LOG_HOT_RETENTION_DAYS`
(positive integer; default `30`). The bucket must have versioning and S3 Object
Lock enabled. The job sets Compliance-mode retention on each object through its
legal expiry and uses the AWS SDK default credential provider chain. Its IAM
role needs the minimum required S3 permissions for `PutObject`,
`PutObjectRetention`, `HeadObject`, `GetObject`, `RestoreObject`,
`GetObjectRetention`, and deletion of specific object versions.

Keep the bucket private and enable the organization's required encryption,
access logging, and alerting controls. Do not enable archival against a bucket
without Object Lock and versioning: the worker intentionally refuses to remove
primary rows unless S3 returns a version ID and the stored checksum verifies.
This implementation uses AWS S3 Glacier; Azure Archive and Google Coldline are
not configured by this backend.

## Retrieval and reporting

All routes require a JWT-authenticated administrator:

- `GET /api/v1/admin/audit-retention/report` reports policy totals, pending
  retrieval approvals, and expired rows still in primary storage or awaiting
  cold-archive deletion.
- `GET /api/v1/admin/audit-archives?limit=100` lists retained archive metadata.
- `POST /api/v1/admin/audit-archives/:id/retrieval-requests` creates a request
  with a reason of at least 10 characters.
- `GET /api/v1/admin/audit-archive-retrieval-requests?status=pending` lists
  requests awaiting a second administrator's approval.
- `POST /api/v1/admin/audit-archive-retrievals/:id/approve` requires a different
  administrator from the requester.
- `GET /api/v1/admin/audit-archive-retrievals/:id` fetches an approved record.
  Glacier retrieval can be asynchronous; the response indicates `restoring`
  until S3 makes it available. Successful retrievals are integrity-checked and
  recorded in the system audit log before the record is returned.

The worker processes at most 1,000 candidate records per source table per
daily run. Prometheus exposes `audit_retention_archived_total` by log type and
`audit_retention_runs_total` by outcome, and
`audit_retention_job_last_success_timestamp_seconds` for scheduler freshness.
Database indexes support retention expiry scans and timestamp/user lookups; a
performance percentage must be measured against production-like data before it
can be claimed.
