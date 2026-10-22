import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NettingService, CreateObligationDto } from './netting.service';
import { NettingCycle } from './entities/netting-cycle.entity';
import { NettingObligation } from './entities/netting-obligation.entity';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('NettingService', () => {
  let service: NettingService;
  let cycleRepo: any;
  let obligationRepo: any;

  beforeEach(async () => {
    cycleRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'cycle-uuid-1' })),
      save: jest.fn((entity) =>
        Promise.resolve({ ...entity, id: entity.id || 'cycle-uuid-1' }),
      ),
      findOne: jest.fn(),
      find: jest.fn(),
    };

    obligationRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'ob-uuid-1' })),
      save: jest.fn((entity) =>
        Array.isArray(entity)
          ? Promise.resolve(entity)
          : Promise.resolve({ ...entity, id: entity.id || 'ob-uuid-1' }),
      ),
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NettingService,
        {
          provide: getRepositoryToken(NettingCycle),
          useValue: cycleRepo,
        },
        {
          provide: getRepositoryToken(NettingObligation),
          useValue: obligationRepo,
        },
      ],
    }).compile();

    service = module.get<NettingService>(NettingService);
  });

  describe('createObligation', () => {
    it('creates a new payment obligation', async () => {
      const dto: CreateObligationDto = {
        payerId: 'trader-1',
        payerName: 'Global Commodities Ltd',
        payeeId: 'farmer-1',
        payeeName: 'Cooperative Union Ghana',
        amountUsd: 15000,
        obligationType: 'deal_payout',
      };

      const ob = await service.createObligation(dto);
      expect(ob.payerId).toBe('trader-1');
      expect(ob.amountUsd).toBe(15000);
      expect(ob.status).toBe('pending');
      expect(obligationRepo.save).toHaveBeenCalled();
    });

    it('rejects self-payment or non-positive amounts', async () => {
      await expect(
        service.createObligation({
          payerId: 'user-1',
          payerName: 'Same User',
          payeeId: 'user-1',
          payeeName: 'Same User',
          amountUsd: 1000,
          obligationType: 'deal_payout',
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createObligation({
          payerId: 'user-1',
          payerName: 'User 1',
          payeeId: 'user-2',
          payeeName: 'User 2',
          amountUsd: -500,
          obligationType: 'deal_payout',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('calculateBilateralNetting', () => {
    it('nets reciprocal payment obligations between two parties down to single balance', () => {
      const obligations: Partial<NettingObligation>[] = [
        { payerId: 'A', payeeId: 'B', amountUsd: 10000 },
        { payerId: 'B', payeeId: 'A', amountUsd: 4000 },
        { payerId: 'A', payeeId: 'B', amountUsd: 2000 },
      ];

      // A owes B: 10k + 2k = 12k
      // B owes A: 4k
      // Net: A owes B 8k
      const result = service.calculateBilateralNetting(
        obligations as NettingObligation[],
      );

      expect(result.parties).toHaveLength(2);
      expect(result.pairwiseNetPositions).toHaveLength(1);
      const pair = result.pairwiseNetPositions[0];
      expect(pair.netPayer).toBe('A');
      expect(pair.netPayee).toBe('B');
      expect(pair.netAmountUsd).toBe(8000);
      expect(pair.originalGrossCount).toBe(3);
    });
  });

  describe('calculateMultilateralNetting', () => {
    it('multilaterally nets obligations across 4 parties and achieves >= 40% transaction reduction', () => {
      // Setup circular and cross obligations between 4 parties:
      // A owes B: $50,000
      // B owes C: $40,000
      // C owes D: $35,000
      // D owes A: $30,000
      // B owes A: $10,000
      // C owes B: $5,000
      // Total 6 transactions, Gross volume: $170,000
      const obligations: Partial<NettingObligation>[] = [
        {
          payerId: 'A',
          payerName: 'Trader A',
          payeeId: 'B',
          payeeName: 'Coop B',
          amountUsd: 50000,
        },
        {
          payerId: 'B',
          payerName: 'Coop B',
          payeeId: 'C',
          payeeName: 'Warehouse C',
          amountUsd: 40000,
        },
        {
          payerId: 'C',
          payerName: 'Warehouse C',
          payeeId: 'D',
          payeeName: 'Shipper D',
          amountUsd: 35000,
        },
        {
          payerId: 'D',
          payerName: 'Shipper D',
          payeeId: 'A',
          payeeName: 'Trader A',
          amountUsd: 30000,
        },
        {
          payerId: 'B',
          payerName: 'Coop B',
          payeeId: 'A',
          payeeName: 'Trader A',
          amountUsd: 10000,
        },
        {
          payerId: 'C',
          payerName: 'Warehouse C',
          payeeId: 'B',
          payeeName: 'Coop B',
          amountUsd: 5000,
        },
      ];

      const result = service.calculateMultilateralNetting(
        obligations as NettingObligation[],
      );

      // Verify zero-sum conservation
      expect(result.isBalanced).toBe(true);

      // Verify gross metrics
      expect(result.grossObligationCount).toBe(6);
      expect(result.grossTotalVolumeUsd).toBe(170000);

      // Net transactions must be significantly reduced (e.g. from 6 to at most 3)
      expect(result.netSettlementCount).toBeLessThanOrEqual(3);

      // Verify transaction count reduction is at least 40% (6 -> <=3 is >= 50%)
      expect(result.transactionCountReductionPct).toBeGreaterThanOrEqual(40);

      // Net volume must be substantially lower than gross volume
      expect(result.netTotalVolumeUsd).toBeLessThan(result.grossTotalVolumeUsd);
      expect(result.volumeReductionPct).toBeGreaterThan(50);

      // Estimated fee savings should be positive
      expect(result.estimatedFeeSavingsUsd).toBeGreaterThan(0);

      // Check net position of A:
      // A payables = 50,000
      // A receivables = 10,000 + 30,000 = 40,000
      // A net balance = 40,000 - 50,000 = -10,000 (net debtor)
      expect(result.partyPositions['A'].netBalanceUsd).toBe(-10000);
      expect(result.partyPositions['A'].status).toBe('net_debtor');
    });
  });

  describe('executeNettingCycle', () => {
    it('executes netting cycle and updates records to settled with batch proof', async () => {
      cycleRepo.findOne.mockResolvedValue({
        id: 'cycle-1',
        cycleNumber: 'CYCLE-20261019-001',
        status: 'scheduled',
      });

      obligationRepo.find.mockResolvedValue([
        {
          id: 'ob-1',
          payerId: 'A',
          payerName: 'A',
          payeeId: 'B',
          payeeName: 'B',
          amountUsd: 20000,
          status: 'pending',
        },
        {
          id: 'ob-2',
          payerId: 'B',
          payerName: 'B',
          payeeId: 'A',
          payeeName: 'A',
          amountUsd: 12000,
          status: 'pending',
        },
        {
          id: 'ob-3',
          payerId: 'A',
          payerName: 'A',
          payeeId: 'C',
          payeeName: 'C',
          amountUsd: 5000,
          status: 'pending',
        },
      ]);

      const execution = await service.executeNettingCycle('cycle-1');

      expect(execution.cycle.status).toBe('settled');
      expect(execution.cycle.settlementBatchTxHash).toBeDefined();
      expect(execution.cycle.grossObligationsCount).toBe(3);
      expect(execution.cycle.netSettlementCount).toBeLessThan(3);
      expect(execution.cycle.transactionReductionPct).toBeGreaterThanOrEqual(
        33,
      );
      expect(obligationRepo.save).toHaveBeenCalled();
      expect(cycleRepo.save).toHaveBeenCalled();
    });

    it('throws if cycle does not exist or is already settled', async () => {
      cycleRepo.findOne.mockResolvedValue(null);
      await expect(
        service.executeNettingCycle('missing-cycle'),
      ).rejects.toThrow(NotFoundException);

      cycleRepo.findOne.mockResolvedValue({
        status: 'settled',
        cycleNumber: 'CYCLE-001',
      });
      await expect(
        service.executeNettingCycle('settled-cycle'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('risk management & unwinding', () => {
    it('assesses counterparty risk against credit limit', () => {
      const lowRisk = service.checkCounterpartyRisk('party-1', 50000, 250000);
      expect(lowRisk.riskTier).toBe('low');
      expect(lowRisk.isApproved).toBe(true);

      const highRisk = service.checkCounterpartyRisk('party-2', 220000, 250000);
      expect(highRisk.riskTier).toBe('high');
      expect(highRisk.requiresCollateral).toBe(true);
    });

    it('unwinds a defaulting party and re-nets remaining obligations', async () => {
      cycleRepo.findOne.mockResolvedValue({
        id: 'cycle-1',
        cycleNumber: 'CYCLE-001',
      });
      obligationRepo.find.mockResolvedValue([
        {
          id: 'ob-1',
          payerId: 'SOLVENT_A',
          payerName: 'A',
          payeeId: 'SOLVENT_B',
          payeeName: 'B',
          amountUsd: 10000,
          status: 'pending',
        },
        {
          id: 'ob-2',
          payerId: 'DEFAULTER',
          payerName: 'Defaulter',
          payeeId: 'SOLVENT_A',
          payeeName: 'A',
          amountUsd: 8000,
          status: 'pending',
        },
        {
          id: 'ob-3',
          payerId: 'SOLVENT_B',
          payerName: 'B',
          payeeId: 'SOLVENT_A',
          payeeName: 'A',
          amountUsd: 4000,
          status: 'pending',
        },
      ]);

      const result = await service.unwindDefaultingCounterparty(
        'cycle-1',
        'DEFAULTER',
      );

      expect(obligationRepo.save).toHaveBeenCalled();
      expect(result.grossObligationCount).toBe(2);
      expect(result.partyPositions['DEFAULTER']).toBeUndefined();
    });
  });

  describe('reporting, analytics & compliance', () => {
    it('generates a detailed netting reconciliation report', async () => {
      cycleRepo.findOne.mockResolvedValue({
        id: 'cycle-1',
        cycleNumber: 'CYCLE-20261019-001',
        status: 'settled',
        grossObligationsCount: 10,
        grossTotalAmountUsd: 100000,
        netSettlementCount: 3,
        netTotalAmountUsd: 35000,
        transactionReductionPct: 70,
        feeSavingsUsd: 272.5,
        settlementBatchTxHash: 'abc123hash',
        settlementMetadata: { partyPositions: {}, netTransfers: [] },
      });

      const report = await service.generateNettingReport('cycle-1');

      expect(report.cycleId).toBe('cycle-1');
      expect(report.summary.transactionCountReductionPct).toBe(70);
      expect(report.summary.capitalEfficiencyGainPct).toBe(65);
      expect(report.complianceStatement.framework).toBe('CPMI_IOSCO_PFMI_2026');
    });

    it('calculates aggregate netting analytics and confirms >= 40% reduction target is met', async () => {
      cycleRepo.find.mockResolvedValue([
        {
          grossObligationsCount: 10,
          grossTotalAmountUsd: 100000,
          netSettlementCount: 4,
          netTotalAmountUsd: 40000,
          transactionReductionPct: 60,
          feeSavingsUsd: 240,
        },
        {
          grossObligationsCount: 8,
          grossTotalAmountUsd: 80000,
          netSettlementCount: 4,
          netTotalAmountUsd: 35000,
          transactionReductionPct: 50,
          feeSavingsUsd: 167,
        },
      ]);

      const analytics = await service.getNettingAnalytics();

      expect(analytics.totalCyclesExecuted).toBe(2);
      expect(analytics.averageTransactionCountReductionPct).toBe(55);
      expect(analytics.targetMet).toBe(true);
      expect(analytics.capitalEfficiencyGainPct).toBeGreaterThan(50);
    });

    it('verifies regulatory compliance under ISDA and CPMI-IOSCO standards', async () => {
      cycleRepo.findOne.mockResolvedValue({
        id: 'cycle-1',
        cycleNumber: 'CYCLE-001',
        status: 'settled',
        settlementBatchTxHash: 'tx-audit-hash',
      });

      const compliance = await service.verifyNettingCompliance('cycle-1');

      expect(compliance.isCompliant).toBe(true);
      expect(compliance.legalEnforceability).toBe(
        'Enforceable_Under_ISDA_Model',
      );
      expect(compliance.verificationToken).toBeDefined();
      expect(compliance.checks.every((c) => c.passed)).toBe(true);
    });
  });
});
