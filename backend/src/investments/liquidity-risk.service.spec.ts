import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LiquidityRiskService } from './liquidity-risk.service';
import { Investment, InvestmentStatus } from './entities/investment.entity';
import { LiquiditySnapshot } from './entities/liquidity-snapshot.entity';

describe('LiquidityRiskService', () => {
  let service: LiquidityRiskService;
  let investmentRepo: any;
  let snapshotRepo: any;

  beforeEach(async () => {
    investmentRepo = {
      find: jest.fn(),
    };

    snapshotRepo = {
      create: jest.fn((dto) => ({ ...dto, id: 'snap-1' })),
      save: jest.fn((entity) =>
        Promise.resolve({ ...entity, id: entity.id || 'snap-1' }),
      ),
      createQueryBuilder: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LiquidityRiskService,
        {
          provide: getRepositoryToken(Investment),
          useValue: investmentRepo,
        },
        {
          provide: getRepositoryToken(LiquiditySnapshot),
          useValue: snapshotRepo,
        },
      ],
    }).compile();

    service = module.get<LiquidityRiskService>(LiquidityRiskService);
  });

  describe('calculateInvestmentLiquidity', () => {
    it('calculates high liquidity score for short-dated tokenized deals with escrow', () => {
      const nearFuture = new Date();
      nearFuture.setDate(nearFuture.getDate() + 10); // 10 days to maturity

      const inv: Partial<Investment> = {
        id: 'inv-1',
        tradeDealId: 'deal-1',
        amountUsd: 10000,
        status: InvestmentStatus.ACTIVE,
        tradeDeal: {
          id: 'deal-1',
          title: 'Immediate Maize Payout',
          commodity: 'Maize',
          deliveryDate: nearFuture,
          tokenSymbol: 'MAIZE-001',
          minLotSize: 50,
          sorobanCampaignContractId: 'CONTRACT-123',
        } as any,
      };

      const profile = service.calculateInvestmentLiquidity(inv as Investment);

      expect(profile.daysToMaturity).toBeLessThanOrEqual(10);
      expect(profile.liquidityScore).toBeGreaterThanOrEqual(75);
      expect(profile.liquidityTier).toBe('Highly Liquid');
      expect(profile.estimatedDaysToLiquidate).toBeLessThanOrEqual(5);
      expect(profile.secondaryMarketHaircutPct).toBeLessThan(5);
      expect(profile.scoringBreakdown.maturityFactor).toBe(40);
    });

    it('calculates lower liquidity score for long-dated non-tokenized deals', () => {
      const farFuture = new Date();
      farFuture.setDate(farFuture.getDate() + 250); // 250 days to maturity

      const inv: Partial<Investment> = {
        id: 'inv-2',
        tradeDealId: 'deal-2',
        amountUsd: 25000,
        status: InvestmentStatus.ACTIVE,
        tradeDeal: {
          id: 'deal-2',
          title: 'Long-cycle Cocoa Orchard',
          commodity: 'Cocoa',
          deliveryDate: farFuture,
        } as any,
      };

      const profile = service.calculateInvestmentLiquidity(inv as Investment);

      expect(profile.daysToMaturity).toBeGreaterThan(200);
      expect(profile.liquidityScore).toBeLessThan(55);
      expect(['Low Liquidity', 'Illiquid']).toContain(profile.liquidityTier);
      expect(profile.secondaryMarketHaircutPct).toBeGreaterThanOrEqual(10);
    });
  });

  describe('aggregatePortfolioLiquidity', () => {
    it('aggregates dollar-weighted liquidity metrics and cash conversion schedule across holdings', async () => {
      const d1 = new Date();
      d1.setDate(d1.getDate() + 15); // <= 30d
      const d2 = new Date();
      d2.setDate(d2.getDate() + 120); // > 90d

      const mockInvestments: Partial<Investment>[] = [
        {
          id: 'inv-1',
          investorId: 'investor-1',
          amountUsd: 20000,
          status: InvestmentStatus.ACTIVE,
          tradeDeal: {
            title: 'Short Term Deal',
            commodity: 'Maize',
            deliveryDate: d1,
            tokenSymbol: 'MAIZE-1',
            minLotSize: 10,
          } as any,
        },
        {
          id: 'inv-2',
          investorId: 'investor-1',
          amountUsd: 30000,
          status: InvestmentStatus.ACTIVE,
          tradeDeal: {
            title: 'Long Term Deal',
            commodity: 'Timber',
            deliveryDate: d2,
          } as any,
        },
      ];

      const summary = await service.aggregatePortfolioLiquidity(
        'investor-1',
        mockInvestments as Investment[],
      );

      expect(summary.totalPortfolioUsd).toBe(50000);
      expect(summary.portfolioLiquidityScore).toBeGreaterThan(0);
      expect(summary.investments).toHaveLength(2);
      expect(summary.cashConversionProfile.within30DaysUsd).toBe(20000);
      expect(summary.cashConversionProfile.within30DaysPct).toBe(40);
      expect(summary.liquidityCoverageRatioPct).toBeGreaterThan(0);
      expect(summary.tierBreakdown).toBeDefined();
    });

    it('returns empty portfolio structure when no active investments exist', async () => {
      const summary = await service.aggregatePortfolioLiquidity(
        'empty-investor',
        [],
      );
      expect(summary.totalPortfolioUsd).toBe(0);
      expect(summary.portfolioLiquidityScore).toBe(0);
      expect(summary.portfolioLiquidityTier).toBe('Illiquid');
      expect(summary.cashConversionProfile.within30DaysUsd).toBe(0);
    });
  });

  describe('liquidity stress testing', () => {
    it('applies market disruption shocks and calculates stressed LCR and shortfall', async () => {
      const deliveryDate = new Date();
      deliveryDate.setDate(deliveryDate.getDate() + 25);

      const mockInvestments: Partial<Investment>[] = [
        {
          id: 'inv-1',
          investorId: 'inv-user',
          amountUsd: 100000,
          status: InvestmentStatus.ACTIVE,
          tradeDeal: {
            title: 'Stressed Deal',
            commodity: 'Cashew',
            deliveryDate,
            tokenSymbol: 'CASHEW',
            minLotSize: 100,
          } as any,
        },
      ];

      const stressResult = await service.runStressTest(
        'inv-user',
        'COMBINED_CRISIS',
        mockInvestments as Investment[],
      );

      expect(stressResult.scenario).toBe('COMBINED_CRISIS');
      expect(stressResult.stressed.portfolioLiquidityScore).toBeLessThan(
        stressResult.baseline.portfolioLiquidityScore,
      );
      expect(stressResult.stressed.scoreDropPoints).toBeGreaterThan(0);
      expect(stressResult.resilienceRating).toBeDefined();
    });
  });

  describe('evaluateLiquidityAlerts', () => {
    it('triggers alerts when portfolio score, 30d buffer, or LCR breach thresholds', () => {
      const summary = {
        portfolioLiquidityScore: 30, // below 40
        cashConversionProfile: { within30DaysPct: 8 }, // below 15%
        liquidityCoverageRatioPct: 75, // below 100%
        totalPortfolioUsd: 100000,
        investments: [
          {
            dealTitle: 'Huge Illiquid Deal',
            liquidityTier: 'Illiquid' as const,
            amountUsd: 40000, // 40% of portfolio
          },
        ],
      } as any;

      const alerts = service.evaluateLiquidityAlerts(summary);

      expect(alerts.some((a) => a.type === 'LOW_PORTFOLIO_LIQUIDITY')).toBe(
        true,
      );
      expect(alerts.some((a) => a.type === 'BUFFER_WARNING')).toBe(true);
      expect(alerts.some((a) => a.type === 'LCR_BREACH')).toBe(true);
      expect(alerts.some((a) => a.type === 'CONCENTRATION_RISK')).toBe(true);
    });
  });

  describe('getLiquidityOptimizationSuggestions', () => {
    it('recommends rebalancing and secondary matching for illiquid portfolios', async () => {
      const farDate = new Date();
      farDate.setDate(farDate.getDate() + 200);

      const mockInvestments: Partial<Investment>[] = [
        {
          id: 'inv-1',
          investorId: 'inv-user',
          amountUsd: 50000,
          status: InvestmentStatus.ACTIVE,
          tradeDeal: {
            title: 'Slow Deal',
            commodity: 'Cocoa',
            deliveryDate: farDate,
          } as any,
        },
      ];

      const suggestions = await service.getLiquidityOptimizationSuggestions(
        'inv-user',
        mockInvestments as Investment[],
      );

      expect(suggestions.length).toBeGreaterThanOrEqual(2);
      expect(
        suggestions[0].potentialLiquidityScoreUplift,
      ).toBeGreaterThanOrEqual(suggestions[1].potentialLiquidityScoreUplift);
      expect(suggestions.some((s) => s.category === 'REBALANCING')).toBe(true);
      expect(suggestions.some((s) => s.category === 'SECONDARY_LISTING')).toBe(
        true,
      );
    });
  });

  describe('scenario analysis and planning', () => {
    it('runs custom scenario analysis with user parameters', async () => {
      const deliveryDate = new Date();
      deliveryDate.setDate(deliveryDate.getDate() + 20);

      investmentRepo.find.mockResolvedValue([
        {
          id: 'inv-1',
          investorId: 'inv-user',
          amountUsd: 40000,
          status: InvestmentStatus.ACTIVE,
          tradeDeal: { title: 'Test Deal', commodity: 'Rice', deliveryDate },
        },
      ]);

      const result = await service.runScenarioAnalysis('inv-user', {
        secondaryMarketHaircutPct: 15,
        harvestDelayDays: 30,
        investorWithdrawalDemandPct: 20,
      });

      expect(result.parametersApplied.harvestDelayDays).toBe(30);
      expect(result.simulatedPortfolioScore).toBeDefined();
      expect(result.liquidityDeficitOrSurplusUsd).toBeDefined();
    });

    it('generates forward liquidity plan projecting inflows across time horizons', async () => {
      const d1 = new Date();
      d1.setDate(d1.getDate() + 20);
      const d2 = new Date();
      d2.setDate(d2.getDate() + 75);

      investmentRepo.find.mockResolvedValue([
        {
          id: '1',
          amountUsd: 15000,
          status: InvestmentStatus.ACTIVE,
          tradeDeal: { title: 'Deal A', deliveryDate: d1 },
        },
        {
          id: '2',
          amountUsd: 25000,
          status: InvestmentStatus.ACTIVE,
          tradeDeal: { title: 'Deal B', deliveryDate: d2 },
        },
      ]);

      const plan = await service.generateLiquidityPlan('inv-user', 180);

      expect(plan.periods).toHaveLength(4);
      expect(plan.totalProjectedInflowsUsd).toBe(40000);
      expect(plan.recommendedReserveUsd).toBe(4000); // 10%
      expect(plan.periods[0].expectedInflowsUsd).toBe(15000);
    });

    it('generates Basel III compliance report', async () => {
      const d1 = new Date();
      d1.setDate(d1.getDate() + 15);

      investmentRepo.find.mockResolvedValue([
        {
          id: '1',
          amountUsd: 50000,
          status: InvestmentStatus.ACTIVE,
          tradeDeal: { title: 'Liquid Rice', deliveryDate: d1 },
        },
      ]);

      const report = await service.generateLiquidityReport('inv-user');

      expect(report.reportId).toContain('LIQ-REP');
      expect(report.framework).toBe('BASEL_III_LCR_NSFR_PROXY');
      expect(['PASSED', 'WARNING', 'FAILED']).toContain(
        report.complianceStatus,
      );
      expect(report.metrics.liquidityCoverageRatioPct).toBeGreaterThan(0);
    });
  });
});
