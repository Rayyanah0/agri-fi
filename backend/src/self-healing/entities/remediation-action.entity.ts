import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type RemediationActionType =
  | 'restart_pod'
  | 'restart_service'
  | 'scale_up'
  | 'scale_down'
  | 'cleanup_disk'
  | 'custom_script'
  | 'manual';

export type RemediationStatus =
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'rolled_back';

export type RemediationSafetyDecision =
  'allowed' | 'approval_required' | 'blocked';

export type RemediationTriggerSource = 'scheduler' | 'api' | 'manual';

export type RemediationEnvironment = 'staging' | 'production';

/**
 * Immutable-ish audit record of every remediation attempt, whether it was
 * executed automatically, approved by an operator, or blocked by the safety
 * policy. This table is the source of truth for remediation analytics.
 */
@Entity('remediation_actions')
@Index(['actionType', 'createdAt'])
@Index(['status', 'createdAt'])
@Index(['target', 'createdAt'])
export class RemediationAction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Issue this action was raised for (nullable for manual actions). */
  @Index()
  @Column({ name: 'issue_id', type: 'uuid', nullable: true })
  issueId: string | null;

  @Column({ name: 'action_type', type: 'varchar', length: 64 })
  actionType: RemediationActionType;

  /** Resource the action was applied to. */
  @Column({ name: 'target', type: 'varchar', length: 255 })
  target: string;

  @Column({ name: 'component', type: 'varchar', length: 64, nullable: true })
  component: string | null;

  @Column({ name: 'parameters_json', type: 'jsonb', nullable: true })
  parametersJson: Record<string, unknown> | null;

  @Column({ name: 'status', type: 'varchar', length: 32, default: 'pending' })
  status: RemediationStatus;

  /** Outcome of the safety evaluation performed before execution. */
  @Column({
    name: 'safety_decision',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  safetyDecision: RemediationSafetyDecision | null;

  /** Human readable explanation of the safety decision. */
  @Column({ name: 'safety_reasons_json', type: 'jsonb', nullable: true })
  safetyReasonsJson: string[] | null;

  @Column({ name: 'policy_name', type: 'varchar', length: 128, nullable: true })
  policyName: string | null;

  /** `system` for automated runs, otherwise the acting user id. */
  @Column({ name: 'executed_by', type: 'varchar', length: 128 })
  executedBy: string;

  @Column({
    name: 'trigger_source',
    type: 'varchar',
    length: 32,
    default: 'scheduler',
  })
  triggerSource: RemediationTriggerSource;

  @Column({ name: 'environment', type: 'varchar', length: 32 })
  environment: RemediationEnvironment;

  @Column({ name: 'output', type: 'text', nullable: true })
  output: string | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({
    name: 'started_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  startedAt: Date | null;

  @Column({
    name: 'completed_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  completedAt: Date | null;

  /** Wall-clock duration of the remediation attempt. */
  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  /**
   * Estimated manual time avoided by this action, in milliseconds.
   * Used by the analytics endpoint to report time saved.
   */
  @Column({ name: 'time_saved_ms', type: 'int', nullable: true })
  timeSavedMs: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
