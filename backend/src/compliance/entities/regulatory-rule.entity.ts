import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export type RuleJurisdiction =
  'GLOBAL' | 'US' | 'EU' | 'UK' | 'NIGERIA' | 'KENYA' | 'GHANA';

export type RuleCategory =
  | 'AML_SANCTIONS'
  | 'ACCREDITATION'
  | 'DEAL_LIMITS'
  | 'CROSS_BORDER'
  | 'ESG_MANDATE'
  | 'COMMODITY_RESTRICTIONS';

export type RuleSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type RuleAction =
  | 'ALLOW'
  | 'FLAG_REVIEW'
  | 'REJECT'
  | 'REQUIRE_ENHANCED_DUE_DILIGENCE'
  | 'CAP_TRANSACTION';

export type RuleStatus =
  'draft' | 'testing' | 'staged' | 'active' | 'deprecated';

export interface RuleCondition {
  field: string;
  operator:
    | 'EQUALS'
    | 'NOT_EQUALS'
    | 'GREATER_THAN'
    | 'GREATER_THAN_OR_EQUAL'
    | 'LESS_THAN'
    | 'LESS_THAN_OR_EQUAL'
    | 'IN'
    | 'NOT_IN'
    | 'CONTAINS';
  value: any;
}

export interface RuleTestCase {
  name: string;
  inputFacts: Record<string, any>;
  expectedAction: RuleAction;
  expectedViolated: boolean;
}

@Entity('regulatory_rules')
@Index(['jurisdiction', 'status'])
@Index(['ruleCode', 'version'])
export class RegulatoryRule {
  @PrimaryGeneratedColumn('uuid')
  @ApiProperty({ description: 'Rule UUID' })
  id: string;

  @Column({ name: 'rule_code' })
  @ApiProperty({
    description: 'Unique code for this compliance rule family',
    example: 'AML-001-HIGH-RISK-COUNTRY',
  })
  ruleCode: string;

  @Column()
  @ApiProperty({
    description: 'Human-readable rule name',
    example: 'High Risk Jurisdiction AML Flag',
  })
  name: string;

  @Column({ type: 'text', nullable: true })
  @ApiProperty({ description: 'Detailed legal rationale & description' })
  description: string;

  @Column({ type: 'varchar', length: 32, default: 'GLOBAL' })
  @ApiProperty({
    enum: ['GLOBAL', 'US', 'EU', 'UK', 'NIGERIA', 'KENYA', 'GHANA'],
  })
  jurisdiction: RuleJurisdiction;

  @Column({ type: 'varchar', length: 32 })
  @ApiProperty({
    enum: [
      'AML_SANCTIONS',
      'ACCREDITATION',
      'DEAL_LIMITS',
      'CROSS_BORDER',
      'ESG_MANDATE',
      'COMMODITY_RESTRICTIONS',
    ],
  })
  category: RuleCategory;

  @Column({ type: 'varchar', length: 16, default: 'HIGH' })
  @ApiProperty({ enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] })
  severity: RuleSeverity;

  @Column({ type: 'varchar', length: 32, default: 'FLAG_REVIEW' })
  @ApiProperty({
    enum: [
      'ALLOW',
      'FLAG_REVIEW',
      'REJECT',
      'REQUIRE_ENHANCED_DUE_DILIGENCE',
      'CAP_TRANSACTION',
    ],
  })
  action: RuleAction;

  @Column({ type: 'jsonb' })
  @ApiProperty({
    description:
      'List of rule conditions evaluated against transaction/deal facts',
  })
  conditions: RuleCondition[];

  @Column({
    name: 'logical_operator',
    type: 'varchar',
    length: 8,
    default: 'AND',
  })
  @ApiProperty({ enum: ['AND', 'OR'], default: 'AND' })
  logicalOperator: 'AND' | 'OR';

  @Column({ type: 'varchar', length: 16, default: 'draft' })
  @ApiProperty({
    enum: ['draft', 'testing', 'staged', 'active', 'deprecated'],
    default: 'draft',
  })
  status: RuleStatus;

  @Column({ type: 'int', default: 1 })
  @ApiProperty({ description: 'Incremental version number', default: 1 })
  version: number;

  @Column({ name: 'parent_rule_id', type: 'uuid', nullable: true })
  parentRuleId: string | null;

  @Column({ name: 'test_cases', type: 'jsonb', default: () => "'[]'" })
  testCases: RuleTestCase[];

  @Column({ name: 'test_results', type: 'jsonb', nullable: true })
  testResults: {
    passed: boolean;
    passedTestsCount: number;
    totalTestsCount: number;
    testedAt: string;
  } | null;

  @Column({ name: 'author_id', type: 'varchar', nullable: true })
  authorId: string | null;

  @Column({ name: 'change_notes', type: 'text', nullable: true })
  changeNotes: string | null;

  @Column({
    name: 'effective_from',
    type: 'timestamptz',
    default: () => 'CURRENT_TIMESTAMP',
  })
  effectiveFrom: Date;

  @Column({ name: 'effective_to', type: 'timestamptz', nullable: true })
  effectiveTo: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
