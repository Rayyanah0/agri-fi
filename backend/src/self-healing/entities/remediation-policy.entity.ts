import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

import type { RemediationActionType } from './remediation-action.entity';
import type { SelfHealingIssueType } from './self-healing-issue.entity';

/**
 * Declarative safety policy applied before any remediation action runs.
 * Policies are stored in the database so that operators can tune the
 * blast radius of automation without a code deployment.
 */
@Entity('remediation_policies')
@Index(['actionType', 'issueType'])
export class RemediationPolicy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar', length: 128, unique: true })
  name: string;

  @Column({ name: 'issue_type', type: 'varchar', length: 64, nullable: true })
  issueType: SelfHealingIssueType | null;

  @Column({ name: 'action_type', type: 'varchar', length: 64 })
  actionType: RemediationActionType;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean;

  /** When true the action is only queued for approval, never auto-executed. */
  @Column({ name: 'requires_approval', type: 'boolean', default: false })
  requiresApproval: boolean;

  /** Destructive actions are never executed without explicit approval. */
  @Column({ name: 'destructive', type: 'boolean', default: false })
  destructive: boolean;

  /** Maximum number of executions per hour for this policy. */
  @Column({ name: 'max_executions_per_hour', type: 'int', default: 5 })
  maxExecutionsPerHour: number;

  /** Minimum number of minutes between two executions of this policy. */
  @Column({ name: 'cooldown_minutes', type: 'int', default: 15 })
  cooldownMinutes: number;

  /** Environments the policy may run in (`staging`, `production`). */
  @Column({
    name: 'allowed_environments_json',
    type: 'jsonb',
    default: () => '\'["staging"]\'::jsonb',
  })
  allowedEnvironmentsJson: string[];

  /**
   * True once the action type has been exercised successfully in staging.
   * Production execution is blocked until this flag is set, which implements
   * the "test remediation in staging before production" requirement.
   */
  @Column({ name: 'staging_validated', type: 'boolean', default: false })
  stagingValidated: boolean;

  /** Minimum replica count allowed for scale actions. */
  @Column({ name: 'min_replicas', type: 'int', nullable: true })
  minReplicas: number | null;

  /** Maximum replica count allowed for scale actions. */
  @Column({ name: 'max_replicas', type: 'int', nullable: true })
  maxReplicas: number | null;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
