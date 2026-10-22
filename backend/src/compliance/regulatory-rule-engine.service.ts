import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import {
  RegulatoryRule,
  RuleJurisdiction,
  RuleCategory,
  RuleSeverity,
  RuleAction,
  RuleStatus,
  RuleCondition,
  RuleTestCase,
} from './entities/regulatory-rule.entity';
import { RegulatoryRuleExecution } from './entities/regulatory-rule-execution.entity';

export interface CreateRegulatoryRuleDto {
  ruleCode: string;
  name: string;
  description?: string;
  jurisdiction?: RuleJurisdiction;
  category: RuleCategory;
  severity?: RuleSeverity;
  action?: RuleAction;
  conditions: RuleCondition[];
  logicalOperator?: 'AND' | 'OR';
  testCases?: RuleTestCase[];
  effectiveFrom?: Date;
  effectiveTo?: Date;
  authorId?: string;
  changeNotes?: string;
}

export interface UpdateRegulatoryRuleDto {
  name?: string;
  description?: string;
  jurisdiction?: RuleJurisdiction;
  category?: RuleCategory;
  severity?: RuleSeverity;
  action?: RuleAction;
  conditions?: RuleCondition[];
  logicalOperator?: 'AND' | 'OR';
  testCases?: RuleTestCase[];
  effectiveFrom?: Date;
  effectiveTo?: Date;
  changeNotes?: string;
}

export interface RuleMatchedDetail {
  ruleId: string;
  ruleCode: string;
  ruleName: string;
  version: number;
  jurisdiction: string;
  category: string;
  severity: RuleSeverity;
  action: RuleAction;
  matchedConditions: string[];
}

export interface RuleExecutionResult {
  executionId: string;
  decision: RuleAction;
  isCompliant: boolean;
  evaluatedRulesCount: number;
  matchedRules: RuleMatchedDetail[];
  violations: Array<{ ruleCode: string; severity: string; message: string }>;
  executionTimeMs: number;
  auditHash: string;
}

export interface RuleTestExecutionReport {
  ruleId: string;
  ruleCode: string;
  passed: boolean;
  totalTests: number;
  passedTests: number;
  testDetails: Array<{
    testName: string;
    passed: boolean;
    expectedAction: RuleAction;
    actualAction: RuleAction;
    actualViolated: boolean;
  }>;
}

export interface RuleMonitoringMetrics {
  totalExecutions: number;
  overallComplianceRatePct: number;
  averageLatencyMs: number;
  activeRulesCount: number;
  executionsByDecision: Record<string, number>;
  topViolatedRules: Array<{
    ruleCode: string;
    ruleName: string;
    violationCount: number;
  }>;
}

export interface ComplianceJurisdictionReport {
  reportId: string;
  jurisdiction: string;
  generatedAt: string;
  summary: {
    totalScreenings: number;
    compliantCount: number;
    flaggedCount: number;
    rejectedCount: number;
    complianceRatePct: number;
  };
  categoryBreakdown: Record<string, { total: number; violations: number }>;
  activeRuleCodes: string[];
}

export interface RuleAlert {
  alertId: string;
  ruleCode: string;
  severity: RuleSeverity;
  action: RuleAction;
  entityType: string;
  entityId: string;
  message: string;
  createdAt: Date;
}

@Injectable()
export class RegulatoryRuleEngineService {
  private readonly logger = new Logger(RegulatoryRuleEngineService.name);

  constructor(
    @InjectRepository(RegulatoryRule)
    private readonly ruleRepo: Repository<RegulatoryRule>,
    @InjectRepository(RegulatoryRuleExecution)
    private readonly executionRepo: Repository<RegulatoryRuleExecution>,
  ) {}

  /**
   * 1. Rule Editor: Create new compliance rule
   */
  async createRule(dto: CreateRegulatoryRuleDto): Promise<RegulatoryRule> {
    if (!dto.conditions || dto.conditions.length === 0) {
      throw new BadRequestException('Rule must contain at least one condition');
    }

    const rule = this.ruleRepo.create({
      ruleCode: dto.ruleCode.trim().toUpperCase(),
      name: dto.name,
      description: dto.description || '',
      jurisdiction: dto.jurisdiction || 'GLOBAL',
      category: dto.category,
      severity: dto.severity || 'HIGH',
      action: dto.action || 'FLAG_REVIEW',
      conditions: dto.conditions,
      logicalOperator: dto.logicalOperator || 'AND',
      status: 'draft',
      version: 1,
      testCases: dto.testCases || [],
      authorId: dto.authorId || null,
      changeNotes: dto.changeNotes || 'Initial rule definition',
      effectiveFrom: dto.effectiveFrom || new Date(),
      effectiveTo: dto.effectiveTo || null,
    });

    const saved = await this.ruleRepo.save(rule);
    this.logger.log(
      `Created compliance rule ${saved.ruleCode} (v1) in status 'draft'`,
    );
    return saved;
  }

  /**
   * 2. Rule Versioning & Editing: Edits create a new incremented version
   * preserving immutable historical versions.
   */
  async editRule(
    ruleId: string,
    dto: UpdateRegulatoryRuleDto,
    authorId: string,
    changeNotes?: string,
  ): Promise<RegulatoryRule> {
    const existing = await this.ruleRepo.findOne({ where: { id: ruleId } });
    if (!existing) {
      throw new NotFoundException(`Rule ${ruleId} not found`);
    }

    // Deprecate previous version if it was active/staged
    if (existing.status === 'active' || existing.status === 'staged') {
      existing.status = 'deprecated';
      existing.effectiveTo = new Date();
      await this.ruleRepo.save(existing);
    }

    const newRule = this.ruleRepo.create({
      ruleCode: existing.ruleCode,
      name: dto.name || existing.name,
      description: dto.description ?? existing.description,
      jurisdiction: dto.jurisdiction || existing.jurisdiction,
      category: dto.category || existing.category,
      severity: dto.severity || existing.severity,
      action: dto.action || existing.action,
      conditions: dto.conditions || existing.conditions,
      logicalOperator: dto.logicalOperator || existing.logicalOperator,
      status: 'draft',
      version: existing.version + 1,
      parentRuleId: existing.id,
      testCases: dto.testCases || existing.testCases,
      authorId,
      changeNotes:
        changeNotes ||
        dto.changeNotes ||
        `Updated to version ${existing.version + 1}`,
      effectiveFrom: dto.effectiveFrom || new Date(),
      effectiveTo: dto.effectiveTo || null,
    });

    const saved = await this.ruleRepo.save(newRule);
    this.logger.log(
      `Created new version ${saved.version} for rule ${saved.ruleCode}`,
    );
    return saved;
  }

  async getRule(ruleId: string): Promise<RegulatoryRule> {
    const rule = await this.ruleRepo.findOne({ where: { id: ruleId } });
    if (!rule) {
      throw new NotFoundException(`Regulatory rule ${ruleId} not found`);
    }
    return rule;
  }

  async listRules(options?: {
    jurisdiction?: RuleJurisdiction;
    status?: RuleStatus;
    category?: RuleCategory;
  }): Promise<RegulatoryRule[]> {
    const qb = this.ruleRepo.createQueryBuilder('r');
    if (options?.jurisdiction) {
      qb.andWhere('r.jurisdiction = :jurisdiction', {
        jurisdiction: options.jurisdiction,
      });
    }
    if (options?.status) {
      qb.andWhere('r.status = :status', { status: options.status });
    }
    if (options?.category) {
      qb.andWhere('r.category = :category', { category: options.category });
    }
    return qb
      .orderBy('r.ruleCode', 'ASC')
      .addOrderBy('r.version', 'DESC')
      .getMany();
  }

  async getRuleVersionHistory(ruleCode: string): Promise<RegulatoryRule[]> {
    return this.ruleRepo.find({
      where: { ruleCode: ruleCode.trim().toUpperCase() },
      order: { version: 'DESC' },
    });
  }

  async rollbackRule(
    ruleCode: string,
    targetVersion: number,
    authorId: string,
  ): Promise<RegulatoryRule> {
    const targetRule = await this.ruleRepo.findOne({
      where: {
        ruleCode: ruleCode.trim().toUpperCase(),
        version: targetVersion,
      },
    });
    if (!targetRule) {
      throw new NotFoundException(
        `Version ${targetVersion} for rule ${ruleCode} not found for rollback`,
      );
    }

    // Deprecate all currently active versions for this rule code
    const activeRules = await this.ruleRepo.find({
      where: { ruleCode: ruleCode.trim().toUpperCase(), status: 'active' },
    });
    for (const ar of activeRules) {
      ar.status = 'deprecated';
      ar.effectiveTo = new Date();
      await this.ruleRepo.save(ar);
    }

    // Spawn new version with target rule properties
    const latestVersion = await this.ruleRepo
      .createQueryBuilder('r')
      .where('r.ruleCode = :code', { code: ruleCode.trim().toUpperCase() })
      .select('MAX(r.version)', 'max')
      .getRawOne();

    const nextVersion = (Number(latestVersion?.max) || targetVersion) + 1;

    const rolledBack = this.ruleRepo.create({
      ruleCode: targetRule.ruleCode,
      name: targetRule.name,
      description: targetRule.description,
      jurisdiction: targetRule.jurisdiction,
      category: targetRule.category,
      severity: targetRule.severity,
      action: targetRule.action,
      conditions: targetRule.conditions,
      logicalOperator: targetRule.logicalOperator,
      status: 'active',
      version: nextVersion,
      parentRuleId: targetRule.id,
      testCases: targetRule.testCases,
      authorId,
      changeNotes: `Rolled back to configuration of version ${targetVersion}`,
      effectiveFrom: new Date(),
    });

    return this.ruleRepo.save(rolledBack);
  }

  /**
   * 3. Rule Testing: Test rule conditions against predefined test cases
   */
  async testRule(
    ruleId: string,
    customTestCases?: RuleTestCase[],
  ): Promise<RuleTestExecutionReport> {
    const rule = await this.getRule(ruleId);
    const testCases = customTestCases || rule.testCases || [];

    if (testCases.length === 0) {
      return {
        ruleId: rule.id,
        ruleCode: rule.ruleCode,
        passed: true,
        totalTests: 0,
        passedTests: 0,
        testDetails: [],
      };
    }

    let passedTests = 0;
    const testDetails: RuleTestExecutionReport['testDetails'] = [];

    for (const tc of testCases) {
      const isMatched = this.evaluateConditionSet(
        rule.conditions,
        rule.logicalOperator,
        tc.inputFacts,
      );
      const actualAction = isMatched ? rule.action : 'ALLOW';
      const actualViolated = isMatched && rule.action !== 'ALLOW';

      const passed =
        actualAction === tc.expectedAction &&
        actualViolated === tc.expectedViolated;

      if (passed) passedTests++;

      testDetails.push({
        testName: tc.name,
        passed,
        expectedAction: tc.expectedAction,
        actualAction,
        actualViolated,
      });
    }

    const allPassed = passedTests === testCases.length;

    rule.testResults = {
      passed: allPassed,
      passedTestsCount: passedTests,
      totalTestsCount: testCases.length,
      testedAt: new Date().toISOString(),
    };
    if (allPassed && rule.status === 'draft') {
      rule.status = 'testing';
    }
    await this.ruleRepo.save(rule);

    return {
      ruleId: rule.id,
      ruleCode: rule.ruleCode,
      passed: allPassed,
      totalTests: testCases.length,
      passedTests,
      testDetails,
    };
  }

  /**
   * 4. Rule Deployment: Deploy rule to staged or active (production)
   */
  async deployRule(
    ruleId: string,
    targetStatus: 'staged' | 'active',
    authorId: string,
  ): Promise<RegulatoryRule> {
    const rule = await this.getRule(ruleId);

    // If deploying to production (active), verify test cases
    if (targetStatus === 'active') {
      if (rule.testCases && rule.testCases.length > 0) {
        const testReport = await this.testRule(rule.id);
        if (!testReport.passed) {
          throw new BadRequestException(
            `Cannot deploy rule ${rule.ruleCode} to production: ${testReport.totalTests - testReport.passedTests} test case(s) failed.`,
          );
        }
      }

      // Deprecate any previously active versions of this same ruleCode
      const existingActive = await this.ruleRepo.find({
        where: { ruleCode: rule.ruleCode, status: 'active' },
      });
      for (const ear of existingActive) {
        if (ear.id !== rule.id) {
          ear.status = 'deprecated';
          ear.effectiveTo = new Date();
          await this.ruleRepo.save(ear);
        }
      }
    }

    rule.status = targetStatus;
    rule.authorId = authorId;
    rule.effectiveFrom = new Date();
    const saved = await this.ruleRepo.save(rule);

    this.logger.log(
      `Deployed regulatory rule ${saved.ruleCode} (v${saved.version}) to status '${saved.status}'`,
    );
    return saved;
  }

  /**
   * 5. Rule Execution Engine: Evaluates facts against all active rules
   */
  async evaluateFacts(
    facts: Record<string, any>,
    context: {
      jurisdiction?: RuleJurisdiction;
      entityType: string;
      entityId: string;
    },
  ): Promise<RuleExecutionResult> {
    const startTime = Date.now();
    const targetJurisdiction = context.jurisdiction || 'GLOBAL';

    // Fetch active rules for this jurisdiction + GLOBAL
    const qb = this.ruleRepo.createQueryBuilder('r');
    qb.where('r.status = :status', { status: 'active' });
    qb.andWhere('(r.jurisdiction = :jur OR r.jurisdiction = :global)', {
      jur: targetJurisdiction,
      global: 'GLOBAL',
    });
    const rules = await qb.getMany();

    const matchedRules: RuleMatchedDetail[] = [];
    const violations: Array<{
      ruleCode: string;
      severity: string;
      message: string;
    }> = [];

    let overallDecision: RuleAction = 'ALLOW';

    // Hierarchy of decisions: REJECT > REQUIRE_ENHANCED_DUE_DILIGENCE > FLAG_REVIEW > CAP_TRANSACTION > ALLOW
    const decisionPriority: Record<RuleAction, number> = {
      REJECT: 5,
      REQUIRE_ENHANCED_DUE_DILIGENCE: 4,
      FLAG_REVIEW: 3,
      CAP_TRANSACTION: 2,
      ALLOW: 1,
    };

    for (const rule of rules) {
      const isMatch = this.evaluateConditionSet(
        rule.conditions,
        rule.logicalOperator,
        facts,
      );
      if (isMatch) {
        matchedRules.push({
          ruleId: rule.id,
          ruleCode: rule.ruleCode,
          ruleName: rule.name,
          version: rule.version,
          jurisdiction: rule.jurisdiction,
          category: rule.category,
          severity: rule.severity,
          action: rule.action,
          matchedConditions: rule.conditions.map(
            (c) => `${c.field} ${c.operator} ${JSON.stringify(c.value)}`,
          ),
        });

        if (rule.action !== 'ALLOW') {
          violations.push({
            ruleCode: rule.ruleCode,
            severity: rule.severity,
            message: `${rule.name}: ${rule.description || 'Condition criteria matched'}`,
          });
        }

        if (decisionPriority[rule.action] > decisionPriority[overallDecision]) {
          overallDecision = rule.action;
        }
      }
    }

    const executionTimeMs = Date.now() - startTime;
    const isCompliant = overallDecision === 'ALLOW';

    const auditHash = crypto
      .createHash('sha256')
      .update(
        `${context.entityType}:${context.entityId}:${targetJurisdiction}:${overallDecision}:${matchedRules.length}:${Date.now()}`,
      )
      .digest('hex');

    // Persist execution log asynchronously
    const execution = this.executionRepo.create({
      entityType: context.entityType,
      entityId: context.entityId,
      jurisdiction: targetJurisdiction,
      decision: overallDecision,
      isCompliant,
      evaluatedRulesCount: rules.length,
      matchedRules: matchedRules.map((m) => ({
        ruleCode: m.ruleCode,
        version: m.version,
        severity: m.severity,
        action: m.action,
        reason: m.ruleName,
      })),
      executionTimeMs,
      auditHash,
    });
    await this.executionRepo.save(execution);

    return {
      executionId: execution.id,
      decision: overallDecision,
      isCompliant,
      evaluatedRulesCount: rules.length,
      matchedRules,
      violations,
      executionTimeMs,
      auditHash,
    };
  }

  /**
   * Evaluates a set of conditions against facts using logicalOperator (AND / OR)
   */
  public evaluateConditionSet(
    conditions: RuleCondition[],
    operator: 'AND' | 'OR',
    facts: Record<string, any>,
  ): boolean {
    if (!conditions || conditions.length === 0) return false;

    if (operator === 'AND') {
      return conditions.every((c) => this.evaluateSingleCondition(c, facts));
    } else {
      return conditions.some((c) => this.evaluateSingleCondition(c, facts));
    }
  }

  public evaluateSingleCondition(
    condition: RuleCondition,
    facts: Record<string, any>,
  ): boolean {
    const factValue = this.resolvePath(facts, condition.field);
    const targetValue = condition.value;

    if (factValue === undefined || factValue === null) {
      if (condition.operator === 'EQUALS')
        return targetValue === null || targetValue === undefined;
      if (condition.operator === 'NOT_EQUALS')
        return targetValue !== null && targetValue !== undefined;
      return false;
    }

    switch (condition.operator) {
      case 'EQUALS':
        return (
          String(factValue).toLowerCase() === String(targetValue).toLowerCase()
        );

      case 'NOT_EQUALS':
        return (
          String(factValue).toLowerCase() !== String(targetValue).toLowerCase()
        );

      case 'GREATER_THAN':
        return Number(factValue) > Number(targetValue);

      case 'GREATER_THAN_OR_EQUAL':
        return Number(factValue) >= Number(targetValue);

      case 'LESS_THAN':
        return Number(factValue) < Number(targetValue);

      case 'LESS_THAN_OR_EQUAL':
        return Number(factValue) <= Number(targetValue);

      case 'IN':
        if (!Array.isArray(targetValue)) return false;
        return targetValue
          .map((v) => String(v).toLowerCase())
          .includes(String(factValue).toLowerCase());

      case 'NOT_IN':
        if (!Array.isArray(targetValue)) return true;
        return !targetValue
          .map((v) => String(v).toLowerCase())
          .includes(String(factValue).toLowerCase());

      case 'CONTAINS':
        return String(factValue)
          .toLowerCase()
          .includes(String(targetValue).toLowerCase());

      default:
        return false;
    }
  }

  private resolvePath(obj: any, path: string): any {
    if (!obj || !path) return undefined;
    return path
      .split('.')
      .reduce((acc, part) => (acc != null ? acc[part] : undefined), obj);
  }

  /**
   * 6. Rule Monitoring: Aggregates execution volume, latency, and rule effectiveness
   */
  async getRuleMonitoringMetrics(): Promise<RuleMonitoringMetrics> {
    const executions = await this.executionRepo.find({
      order: { createdAt: 'DESC' },
      take: 1000,
    });
    const activeRulesCount = await this.ruleRepo.count({
      where: { status: 'active' },
    });

    if (executions.length === 0) {
      return {
        totalExecutions: 0,
        overallComplianceRatePct: 100,
        averageLatencyMs: 0,
        activeRulesCount,
        executionsByDecision: {},
        topViolatedRules: [],
      };
    }

    let compliantCount = 0;
    let latencySum = 0;
    const executionsByDecision: Record<string, number> = {};
    const violationCounts: Record<string, { ruleName: string; count: number }> =
      {};

    for (const ex of executions) {
      if (ex.isCompliant) compliantCount++;
      latencySum += Number(ex.executionTimeMs || 0);

      const decision = ex.decision || 'ALLOW';
      executionsByDecision[decision] =
        (executionsByDecision[decision] || 0) + 1;

      for (const m of ex.matchedRules || []) {
        if (m.action !== 'ALLOW') {
          if (!violationCounts[m.ruleCode]) {
            violationCounts[m.ruleCode] = {
              ruleName: m.reason || m.ruleCode,
              count: 0,
            };
          }
          violationCounts[m.ruleCode].count += 1;
        }
      }
    }

    const topViolatedRules = Object.entries(violationCounts)
      .map(([ruleCode, data]) => ({
        ruleCode,
        ruleName: data.ruleName,
        violationCount: data.count,
      }))
      .sort((a, b) => b.violationCount - a.violationCount)
      .slice(0, 10);

    return {
      totalExecutions: executions.length,
      overallComplianceRatePct:
        Math.round((compliantCount / executions.length) * 1000) / 10,
      averageLatencyMs: Math.round((latencySum / executions.length) * 10) / 10,
      activeRulesCount,
      executionsByDecision,
      topViolatedRules,
    };
  }

  /**
   * 7. Rule Alerts: Formulates high-priority compliance notifications
   */
  public generateRuleAlerts(
    evaluation: RuleExecutionResult,
    entityType: string,
    entityId: string,
  ): RuleAlert[] {
    const alerts: RuleAlert[] = [];

    for (const matched of evaluation.matchedRules) {
      if (matched.severity === 'HIGH' || matched.severity === 'CRITICAL') {
        alerts.push({
          alertId: `ALERT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`,
          ruleCode: matched.ruleCode,
          severity: matched.severity,
          action: matched.action,
          entityType,
          entityId,
          message: `Regulatory rule ${matched.ruleCode} triggered action '${matched.action}' on ${entityType} ${entityId}`,
          createdAt: new Date(),
        });
      }
    }

    return alerts;
  }

  /**
   * 8. Rule Reporting: Generates compliance reports by jurisdiction & category
   */
  async generateComplianceReport(filter: {
    jurisdiction?: RuleJurisdiction;
    fromDate?: Date;
    toDate?: Date;
  }): Promise<ComplianceJurisdictionReport> {
    const jurisdiction = filter.jurisdiction || 'GLOBAL';

    const qb = this.executionRepo.createQueryBuilder('e');
    if (filter.jurisdiction && filter.jurisdiction !== 'GLOBAL') {
      qb.andWhere('(e.jurisdiction = :jur OR e.jurisdiction = :global)', {
        jur: filter.jurisdiction,
        global: 'GLOBAL',
      });
    }
    if (filter.fromDate) {
      qb.andWhere('e.createdAt >= :fromDate', { fromDate: filter.fromDate });
    }
    if (filter.toDate) {
      qb.andWhere('e.createdAt <= :toDate', { toDate: filter.toDate });
    }

    const executions = await qb.getMany();
    const activeRules = await this.ruleRepo.find({
      where: { status: 'active' },
      select: ['ruleCode'],
    });

    let compliantCount = 0;
    let flaggedCount = 0;
    let rejectedCount = 0;
    const categoryBreakdown: Record<
      string,
      { total: number; violations: number }
    > = {};

    for (const ex of executions) {
      if (ex.decision === 'ALLOW') compliantCount++;
      else if (
        ex.decision === 'FLAG_REVIEW' ||
        ex.decision === 'REQUIRE_ENHANCED_DUE_DILIGENCE'
      )
        flaggedCount++;
      else if (ex.decision === 'REJECT') rejectedCount++;

      for (const m of ex.matchedRules || []) {
        const cat = (m as any).category || 'GENERAL';
        if (!categoryBreakdown[cat])
          categoryBreakdown[cat] = { total: 0, violations: 0 };
        categoryBreakdown[cat].total++;
        if (m.action !== 'ALLOW') categoryBreakdown[cat].violations++;
      }
    }

    const totalScreenings = executions.length;
    const complianceRatePct =
      totalScreenings > 0
        ? Math.round((compliantCount / totalScreenings) * 1000) / 10
        : 100;

    return {
      reportId: `COMP-REP-${Date.now().toString(36).toUpperCase()}`,
      jurisdiction,
      generatedAt: new Date().toISOString(),
      summary: {
        totalScreenings,
        compliantCount,
        flaggedCount,
        rejectedCount,
        complianceRatePct,
      },
      categoryBreakdown,
      activeRuleCodes: Array.from(new Set(activeRules.map((r) => r.ruleCode))),
    };
  }

  /**
   * 9. Workflow Integrations: Screen deals, transactions, and users
   */
  async screenDeal(deal: {
    id: string;
    commodity: string;
    totalValue: number;
    farmLocation?: string | null;
    esgScore?: number | null;
    country?: string;
  }): Promise<RuleExecutionResult> {
    const facts = {
      deal: {
        id: deal.id,
        commodity: deal.commodity,
        totalValue: Number(deal.totalValue),
        farmLocation: deal.farmLocation || '',
        esgScore: Number(deal.esgScore || 0),
        country: deal.country || 'GLOBAL',
      },
    };

    return this.evaluateFacts(facts, {
      entityType: 'deal',
      entityId: deal.id,
      jurisdiction: (deal.country as RuleJurisdiction) || 'GLOBAL',
    });
  }

  async screenTransaction(tx: {
    id: string;
    amountUsd: number;
    fromCountry?: string;
    toCountry?: string;
    commodity?: string;
  }): Promise<RuleExecutionResult> {
    const facts = {
      transaction: {
        id: tx.id,
        amountUsd: Number(tx.amountUsd),
        fromCountry: tx.fromCountry || 'GLOBAL',
        toCountry: tx.toCountry || 'GLOBAL',
        commodity: tx.commodity || '',
      },
    };

    return this.evaluateFacts(facts, {
      entityType: 'transaction',
      entityId: tx.id,
      jurisdiction: (tx.fromCountry as RuleJurisdiction) || 'GLOBAL',
    });
  }

  async screenUser(user: {
    id: string;
    accreditationTier?: string;
    countryCode?: string;
    kycStatus?: string;
    totalInvestedUsd?: number;
  }): Promise<RuleExecutionResult> {
    const facts = {
      user: {
        id: user.id,
        accreditationTier: user.accreditationTier || 'retail',
        country: user.countryCode || 'GLOBAL',
        kycStatus: user.kycStatus || 'pending',
        totalInvestedUsd: Number(user.totalInvestedUsd || 0),
      },
    };

    return this.evaluateFacts(facts, {
      entityType: 'user',
      entityId: user.id,
      jurisdiction: (user.countryCode as RuleJurisdiction) || 'GLOBAL',
    });
  }
}
