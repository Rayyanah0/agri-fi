import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  RegulatoryRuleEngineService,
  CreateRegulatoryRuleDto,
} from './regulatory-rule-engine.service';
import { RegulatoryRule } from './entities/regulatory-rule.entity';
import { RegulatoryRuleExecution } from './entities/regulatory-rule-execution.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('RegulatoryRuleEngineService', () => {
  let service: RegulatoryRuleEngineService;
  let ruleRepo: any;
  let executionRepo: any;

  beforeEach(async () => {
    ruleRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'rule-uuid-1' })),
      save: jest.fn((entity) =>
        Array.isArray(entity)
          ? Promise.resolve(entity)
          : Promise.resolve({ ...entity, id: entity.id || 'rule-uuid-1' }),
      ),
      findOne: jest.fn(),
      find: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    executionRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'exec-uuid-1' })),
      save: jest.fn((entity) =>
        Promise.resolve({ ...entity, id: entity.id || 'exec-uuid-1' }),
      ),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RegulatoryRuleEngineService,
        {
          provide: getRepositoryToken(RegulatoryRule),
          useValue: ruleRepo,
        },
        {
          provide: getRepositoryToken(RegulatoryRuleExecution),
          useValue: executionRepo,
        },
      ],
    }).compile();

    service = module.get<RegulatoryRuleEngineService>(
      RegulatoryRuleEngineService,
    );
  });

  describe('createRule', () => {
    it('creates a new regulatory rule in draft status', async () => {
      const dto: CreateRegulatoryRuleDto = {
        ruleCode: 'AML-001',
        name: 'High Transaction Cap Rule',
        category: 'AML_SANCTIONS',
        severity: 'HIGH',
        action: 'FLAG_REVIEW',
        jurisdiction: 'GLOBAL',
        conditions: [
          {
            field: 'transaction.amountUsd',
            operator: 'GREATER_THAN',
            value: 100000,
          },
        ],
      };

      const rule = await service.createRule(dto);

      expect(rule.ruleCode).toBe('AML-001');
      expect(rule.status).toBe('draft');
      expect(rule.version).toBe(1);
      expect(ruleRepo.save).toHaveBeenCalled();
    });

    it('rejects rules without conditions', async () => {
      await expect(
        service.createRule({
          ruleCode: 'EMPTY-001',
          name: 'Empty Rule',
          category: 'DEAL_LIMITS',
          conditions: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('condition evaluation logic', () => {
    it('correctly evaluates all operator types', () => {
      const facts = {
        deal: {
          commodity: 'Cocoa',
          totalValue: 75000,
          esgScore: 82,
          tags: ['organic', 'rainforest_alliance'],
        },
        user: {
          tier: 'retail',
          country: 'NG',
        },
      };

      // EQUALS
      expect(
        service.evaluateSingleCondition(
          { field: 'deal.commodity', operator: 'EQUALS', value: 'cocoa' },
          facts,
        ),
      ).toBe(true);

      // GREATER_THAN
      expect(
        service.evaluateSingleCondition(
          { field: 'deal.totalValue', operator: 'GREATER_THAN', value: 50000 },
          facts,
        ),
      ).toBe(true);

      // LESS_THAN
      expect(
        service.evaluateSingleCondition(
          { field: 'deal.esgScore', operator: 'LESS_THAN', value: 50 },
          facts,
        ),
      ).toBe(false);

      // IN
      expect(
        service.evaluateSingleCondition(
          { field: 'user.country', operator: 'IN', value: ['NG', 'GH', 'KE'] },
          facts,
        ),
      ).toBe(true);

      // NOT_IN
      expect(
        service.evaluateSingleCondition(
          {
            field: 'user.tier',
            operator: 'NOT_IN',
            value: ['accredited', 'institutional'],
          },
          facts,
        ),
      ).toBe(true);

      // CONTAINS
      expect(
        service.evaluateSingleCondition(
          { field: 'deal.commodity', operator: 'CONTAINS', value: 'co' },
          facts,
        ),
      ).toBe(true);
    });

    it('correctly handles AND vs OR logical combinations', () => {
      const facts = { amount: 15000, risk: 'high' };

      const conditions = [
        { field: 'amount', operator: 'GREATER_THAN' as const, value: 10000 },
        { field: 'risk', operator: 'EQUALS' as const, value: 'low' },
      ];

      // AND: true && false = false
      expect(service.evaluateConditionSet(conditions, 'AND', facts)).toBe(
        false,
      );

      // OR: true || false = true
      expect(service.evaluateConditionSet(conditions, 'OR', facts)).toBe(true);
    });
  });

  describe('editRule & versioning', () => {
    it('creates a new incremented version when editing an existing rule', async () => {
      ruleRepo.findOne.mockResolvedValue({
        id: 'rule-v1',
        ruleCode: 'AML-001',
        name: 'AML Rule v1',
        version: 1,
        status: 'active',
        category: 'AML_SANCTIONS',
        conditions: [
          { field: 'amount', operator: 'GREATER_THAN', value: 50000 },
        ],
        logicalOperator: 'AND',
      });

      const updated = await service.editRule(
        'rule-v1',
        { name: 'AML Rule v2 with Higher Threshold' },
        'admin-user',
        'Increased threshold',
      );

      expect(updated.ruleCode).toBe('AML-001');
      expect(updated.version).toBe(2);
      expect(updated.status).toBe('draft');
      expect(updated.parentRuleId).toBe('rule-v1');
    });

    it('rolls back to a previous version', async () => {
      ruleRepo.findOne.mockResolvedValue({
        id: 'rule-v1',
        ruleCode: 'AML-001',
        version: 1,
        name: 'Original Name',
        conditions: [
          { field: 'amount', operator: 'GREATER_THAN', value: 10000 },
        ],
      });
      ruleRepo.find.mockResolvedValue([]);
      ruleRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ max: 3 }),
      });

      const rolledBack = await service.rollbackRule(
        'AML-001',
        1,
        'admin-auditor',
      );

      expect(rolledBack.version).toBe(4);
      expect(rolledBack.name).toBe('Original Name');
      expect(rolledBack.status).toBe('active');
    });
  });

  describe('testRule & deployment', () => {
    it('runs test cases against rule and records test report', async () => {
      ruleRepo.findOne.mockResolvedValue({
        id: 'rule-1',
        ruleCode: 'DEAL-CAP-001',
        action: 'REJECT',
        logicalOperator: 'AND',
        conditions: [
          {
            field: 'deal.totalValue',
            operator: 'GREATER_THAN',
            value: 1000000,
          },
        ],
        testCases: [
          {
            name: 'Rejects deals over 1M',
            inputFacts: { deal: { totalValue: 1200000 } },
            expectedAction: 'REJECT',
            expectedViolated: true,
          },
          {
            name: 'Allows deals under 1M',
            inputFacts: { deal: { totalValue: 500000 } },
            expectedAction: 'ALLOW',
            expectedViolated: false,
          },
        ],
      });

      const report = await service.testRule('rule-1');

      expect(report.passed).toBe(true);
      expect(report.totalTests).toBe(2);
      expect(report.passedTests).toBe(2);
      expect(ruleRepo.save).toHaveBeenCalled();
    });

    it('rejects deployment to active if test cases fail', async () => {
      ruleRepo.findOne.mockResolvedValue({
        id: 'rule-fail',
        ruleCode: 'FAIL-001',
        action: 'REJECT',
        logicalOperator: 'AND',
        conditions: [{ field: 'amount', operator: 'GREATER_THAN', value: 100 }],
        testCases: [
          {
            name: 'Expect allow but rule rejects',
            inputFacts: { amount: 500 },
            expectedAction: 'ALLOW',
            expectedViolated: false,
          },
        ],
      });

      await expect(
        service.deployRule('rule-fail', 'active', 'admin'),
      ).rejects.toThrow(BadRequestException);
    });

    it('deploys rule and deprecates older active versions of same code', async () => {
      ruleRepo.findOne.mockResolvedValue({
        id: 'rule-v2',
        ruleCode: 'ESG-001',
        status: 'testing',
        testCases: [],
      });
      ruleRepo.find.mockResolvedValue([
        { id: 'rule-v1', ruleCode: 'ESG-001', status: 'active' },
      ]);

      const deployed = await service.deployRule('rule-v2', 'active', 'admin');

      expect(deployed.status).toBe('active');
      expect(ruleRepo.save).toHaveBeenCalled();
    });
  });

  describe('evaluateFacts & rule execution engine', () => {
    it('screens facts against active rules and returns decision with audit hash', async () => {
      ruleRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([
          {
            id: 'r-1',
            ruleCode: 'RETAIL-DEAL-CAP',
            name: 'Retail Deal Allocation Limit',
            category: 'DEAL_LIMITS',
            severity: 'HIGH',
            action: 'FLAG_REVIEW',
            logicalOperator: 'AND',
            conditions: [
              {
                field: 'user.accreditationTier',
                operator: 'EQUALS',
                value: 'retail',
              },
              {
                field: 'investment.amountUsd',
                operator: 'GREATER_THAN',
                value: 10000,
              },
            ],
          },
        ]),
      });

      const result = await service.evaluateFacts(
        {
          user: { accreditationTier: 'retail' },
          investment: { amountUsd: 15000 },
        },
        {
          entityType: 'investment',
          entityId: 'inv-123',
          jurisdiction: 'GLOBAL',
        },
      );

      expect(result.decision).toBe('FLAG_REVIEW');
      expect(result.isCompliant).toBe(false);
      expect(result.matchedRules).toHaveLength(1);
      expect(result.violations[0].ruleCode).toBe('RETAIL-DEAL-CAP');
      expect(result.auditHash).toBeDefined();
      expect(executionRepo.save).toHaveBeenCalled();
    });
  });

  describe('monitoring, alerts, and workflow integrations', () => {
    it('aggregates monitoring metrics and top violated rules', async () => {
      executionRepo.find.mockResolvedValue([
        {
          isCompliant: true,
          decision: 'ALLOW',
          executionTimeMs: 4,
          matchedRules: [],
        },
        {
          isCompliant: false,
          decision: 'REJECT',
          executionTimeMs: 6,
          matchedRules: [
            {
              ruleCode: 'SANCTION-01',
              reason: 'Sanctions hit',
              action: 'REJECT',
            },
          ],
        },
      ]);
      ruleRepo.count.mockResolvedValue(12);

      const metrics = await service.getRuleMonitoringMetrics();

      expect(metrics.totalExecutions).toBe(2);
      expect(metrics.overallComplianceRatePct).toBe(50);
      expect(metrics.activeRulesCount).toBe(12);
      expect(metrics.topViolatedRules).toHaveLength(1);
      expect(metrics.topViolatedRules[0].ruleCode).toBe('SANCTION-01');
    });

    it('generates high severity alerts', () => {
      const evaluation = {
        matchedRules: [
          {
            ruleCode: 'SANCTION-01',
            severity: 'CRITICAL' as const,
            action: 'REJECT' as const,
          },
        ],
      } as any;

      const alerts = service.generateRuleAlerts(evaluation, 'deal', 'deal-999');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].severity).toBe('CRITICAL');
      expect(alerts[0].entityId).toBe('deal-999');
    });

    it('integrates with screenDeal and screenTransaction helper workflows', async () => {
      ruleRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      const dealScreen = await service.screenDeal({
        id: 'deal-1',
        commodity: 'Coffee',
        totalValue: 50000,
      });
      expect(dealScreen.isCompliant).toBe(true);

      const txScreen = await service.screenTransaction({
        id: 'tx-1',
        amountUsd: 15000,
        fromCountry: 'US',
      });
      expect(txScreen.isCompliant).toBe(true);
    });
  });
});
