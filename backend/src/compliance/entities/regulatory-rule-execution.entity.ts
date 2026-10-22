import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('regulatory_rule_executions')
@Index(['entityType', 'entityId'])
@Index(['jurisdiction', 'createdAt'])
export class RegulatoryRuleExecution {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Execution log UUID' })
  id: string;

  @Column({ name: 'entity_type', type: 'varchar', length: 32 })
  @ApiProperty({
    example: 'deal',
    enum: ['deal', 'transaction', 'investment', 'user'],
  })
  entityType: string;

  @Column({ name: 'entity_id', type: 'varchar' })
  @ApiProperty({ description: 'Evaluated entity ID' })
  entityId: string;

  @Column({ type: 'varchar', length: 32, default: 'GLOBAL' })
  jurisdiction: string;

  @Column({ type: 'varchar', length: 32 })
  @ApiProperty({
    description: 'Final compliance decision: ALLOW, FLAG_REVIEW, REJECT, etc.',
  })
  decision: string;

  @Column({ name: 'is_compliant', type: 'boolean' })
  isCompliant: boolean;

  @Column({ name: 'evaluated_rules_count', type: 'int' })
  evaluatedRulesCount: number;

  @Column({ name: 'matched_rules', type: 'jsonb', default: () => "'[]'" })
  matchedRules: Array<{
    ruleCode: string;
    version: number;
    severity: string;
    action: string;
    reason: string;
  }>;

  @Column({
    name: 'execution_time_ms',
    type: 'decimal',
    precision: 8,
    scale: 2,
  })
  executionTimeMs: number;

  @Column({ name: 'audit_hash', type: 'varchar' })
  auditHash: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
