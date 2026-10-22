import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Categories of infrastructure issues the self-healing engine can detect.
 * Values are shared with the Prometheus alert label `issue_type` so that
 * detection rules can be authored declaratively in
 * `devops/prometheus/self-healing-alerts.yaml`.
 */
export type SelfHealingIssueType =
  | 'pod_failure'
  | 'pod_restart_loop'
  | 'high_memory'
  | 'high_cpu'
  | 'disk_full'
  | 'service_down'
  | 'service_degradation'
  | 'queue_backlog'
  | 'database_saturation'
  | 'certificate_expiry'
  | 'custom';

export type SelfHealingSeverity = 'info' | 'warning' | 'critical';

export type SelfHealingIssueStatus =
  | 'detected'
  | 'diagnosed'
  | 'remediating'
  | 'remediated'
  | 'failed'
  | 'skipped'
  | 'false_positive';

/**
 * A single detected infrastructure issue. Rows are deduplicated by
 * `fingerprint` so that a continuously firing alert produces one issue
 * row with an incrementing `occurrences` counter instead of a flood of
 * duplicates.
 */
@Entity('self_healing_issues')
@Index(['fingerprint', 'status'])
@Index(['issueType', 'detectedAt'])
export class SelfHealingIssue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Stable identity of the issue, e.g. `pod_failure:default/agri-fi-backend-abc`.
   * Used to deduplicate repeated detections of the same underlying problem.
   */
  @Index()
  @Column({ name: 'fingerprint', type: 'varchar', length: 255 })
  fingerprint: string;

  @Column({ name: 'issue_type', type: 'varchar', length: 64 })
  issueType: SelfHealingIssueType;

  @Column({ name: 'severity', type: 'varchar', length: 16 })
  severity: SelfHealingSeverity;

  @Column({ name: 'status', type: 'varchar', length: 32, default: 'detected' })
  status: SelfHealingIssueStatus;

  /** Logical component the issue belongs to (e.g. `backend`, `redis`). */
  @Column({ name: 'component', type: 'varchar', length: 64 })
  component: string;

  /** Concrete resource affected (pod name, queue name, deployment name...). */
  @Column({ name: 'target', type: 'varchar', length: 255 })
  target: string;

  @Column({ name: 'description', type: 'text' })
  description: string;

  /** Short human-readable cause identified by the root cause analysis. */
  @Column({ name: 'root_cause', type: 'varchar', length: 512, nullable: true })
  rootCause: string | null;

  /** Confidence of the root cause analysis, between 0 and 1. */
  @Column({
    name: 'root_cause_confidence',
    type: 'float',
    nullable: true,
  })
  rootCauseConfidence: number | null;

  /** Supporting signals used to derive the root cause. */
  @Column({ name: 'root_cause_evidence_json', type: 'jsonb', nullable: true })
  rootCauseEvidenceJson: Record<string, unknown> | null;

  /** Metric values captured at detection time. */
  @Column({ name: 'metrics_snapshot_json', type: 'jsonb', nullable: true })
  metricsSnapshotJson: Record<string, unknown> | null;

  /** Raw Prometheus alert labels that triggered the detection. */
  @Column({ name: 'labels_json', type: 'jsonb', nullable: true })
  labelsJson: Record<string, unknown> | null;

  /** Number of times the same fingerprint has been detected. */
  @Column({ name: 'occurrences', type: 'int', default: 1 })
  occurrences: number;

  @Column({ name: 'detected_at', type: 'timestamp with time zone' })
  detectedAt: Date;

  @Column({ name: 'last_seen_at', type: 'timestamp with time zone' })
  lastSeenAt: Date;

  @Column({
    name: 'resolved_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
