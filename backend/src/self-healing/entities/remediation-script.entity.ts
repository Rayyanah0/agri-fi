import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

import type { SelfHealingIssueType } from './self-healing-issue.entity';

/**
 * Registration record for a custom remediation script. Scripts live on disk
 * inside an allow-listed directory and are referenced from the database so
 * that only reviewed scripts can ever be executed by the automation.
 */
@Entity('remediation_scripts')
export class RemediationScript {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'name', type: 'varchar', length: 128, unique: true })
  name: string;

  @Column({ name: 'issue_type', type: 'varchar', length: 64 })
  issueType: SelfHealingIssueType;

  @Column({ name: 'description', type: 'text', nullable: true })
  description: string | null;

  /** Path of the script relative to the allow-listed scripts directory. */
  @Column({ name: 'script_path', type: 'varchar', length: 255 })
  scriptPath: string;

  /** Interpreter used to run the script (restricted to an allow-list). */
  @Column({ name: 'interpreter', type: 'varchar', length: 32, default: 'bash' })
  interpreter: string;

  @Column({ name: 'timeout_seconds', type: 'int', default: 300 })
  timeoutSeconds: number;

  /** Default arguments appended to the script invocation. */
  @Column({
    name: 'default_args_json',
    type: 'jsonb',
    nullable: true,
  })
  defaultArgsJson: string[] | null;

  @Column({ name: 'enabled', type: 'boolean', default: true })
  enabled: boolean;

  @Column({ name: 'requires_approval', type: 'boolean', default: false })
  requiresApproval: boolean;

  @Column({ name: 'destructive', type: 'boolean', default: false })
  destructive: boolean;

  @Column({
    name: 'allowed_environments_json',
    type: 'jsonb',
    default: () => '\'["staging"]\'::jsonb',
  })
  allowedEnvironmentsJson: string[];

  @Column({ name: 'version', type: 'int', default: 1 })
  version: number;

  @Column({
    name: 'last_run_at',
    type: 'timestamp with time zone',
    nullable: true,
  })
  lastRunAt: Date | null;

  @Column({
    name: 'last_result',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  lastResult: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
