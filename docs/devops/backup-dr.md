# PostgreSQL Automated Backup and Cross-Region Disaster Recovery Architecture

## 1. Executive Summary
This document outlines the automated backup, cross-region replication, point-in-time recovery (PITR), and disaster recovery (DR) procedures for the Agri-Fi platform.

### Objectives
- **RTO (Recovery Time Objective)**: < 4 hours
- **RPO (Recovery Point Objective)**: < 5 minutes
- **PITR Granularity**: 1 second

---

## 2. Backup Architecture

### Backup Types & Schedules
1. **Full Backups**:
   - Frequency: Daily at 02:00 UTC.
   - Mechanism: Native compressed custom dump (`pg_dump -F c`) compressed with Gzip (`-9`).
2. **Incremental Backups / WAL Archiving**:
   - Continuous WAL archiving to S3 every 60 seconds.
   - Provides 1-second granularity for Point-In-Time Recovery (PITR).
3. **Weekly / Monthly Snapshots**:
   - Long-term archival snapshots designated for audit and regulatory compliance.

### Encryption Standards
- **At Rest**: AES-256 via AWS KMS customer-managed key (`alias/agrifi-backup-encryption`).
- **In Transit**: Enforced TLS 1.3 across all database connections and S3 API calls.

---

## 3. Cross-Region Replication

Backups are created in the primary region (`us-east-1`) and replicated to the secondary disaster recovery region (`us-west-2`):
- **Primary Bucket**: `s3://agrifi-backups/`
- **Secondary DR Bucket**: `s3://agrifi-backups-dr-us-west-2/`
- **Replication**: S3 Cross-Region Replication (CRR) with KMS re-encryption and checksum validation (`.sha256`).

---

## 4. Retention Policy Matrix

| Tier | Schedule | Retention Duration | Purpose |
|---|---|---|---|
| **Daily** | Every day at 02:00 UTC | 30 days | Operational rollbacks & bug remediation |
| **Weekly** | Every Sunday at 03:00 UTC | 12 weeks | Medium-term historical auditing |
| **Monthly** | 1st of every month | 12 months (365 days) | Annual financial & compliance reporting |
| **WAL Archives** | Continuous | 35 days | Enables 1-second PITR across 30 days |

---

## 5. Automated Validation & Restoration Drills

1. **Daily Integrity Verification**:
   - Every backup artifact calculates and verifies SHA-256 checksums before and after replication.
   - Gzip stream test (`gzip -t`) verifies no corruption or truncated headers.
2. **Monthly Restoration Drills**:
   - Automated via `devops/scripts/run-restore-drill.sh`.
   - Restores the latest replica into an isolated staging/drill environment.
   - Asserts table schema, foreign key integrity, and row counts.
   - Results are logged to `/var/log/agrifi-dr-drill.log`.

---

## 6. Disaster Recovery Runbook (Failover Execution)

In the event of a total primary region outage:
1. **Declare Disaster**: Incident Commander activates DR protocol.
2. **Promote Secondary Read Replica**:
   ```bash
   SECONDARY_REGION=us-west-2 devops/scripts/disaster-recovery.sh
   ```
3. **Point-In-Time Recovery (if recovering from data corruption)**:
   ```bash
   # Restore base backup and replay WAL logs up to target timestamp:
   pg_restore -d agrifi_restored -h $DR_DB_HOST base_backup.dump
   # In postgresql.conf:
   recovery_target_time = '2026-10-21 14:32:00 UTC'
   restore_command = 'aws s3 cp s3://agrifi-backups-dr-us-west-2/wal/%f %p'
   ```
4. **DNS Failover**: Update Route53 latency/health check records to point traffic to the secondary EKS cluster.
5. **Post-Failover Verification**:
   - Run health checks on `/health/ready`.
   - Confirm outbox dispatcher and worker pods are operational.
