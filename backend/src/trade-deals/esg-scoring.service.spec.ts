import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PinoLogger } from 'nestjs-pino';
import { EsgScoringService, EsgQuestionnaireDto } from './esg-scoring.service';
import { TradeDeal } from './entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

describe('EsgScoringService', () => {
  let service: EsgScoringService;
  let dealRepo: any;
  let investmentRepo: any;

  const mockDeal: Partial<TradeDeal> = {
    id: 'deal-123',
    commodity: 'Cocoa',
    title: 'Fairtrade Cocoa Ghana',
    farmerId: 'farmer-1',
    traderId: 'trader-1',
    esgStatus: 'unrated',
    totalValue: 50000,
    quantity: 500,
    expectedRoi: 22,
  };

  beforeEach(async () => {
    dealRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      save: jest.fn((entity) => Promise.resolve(entity)),
    };

    investmentRepo = {
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EsgScoringService,
        {
          provide: getRepositoryToken(TradeDeal),
          useValue: dealRepo,
        },
        {
          provide: getRepositoryToken(Investment),
          useValue: investmentRepo,
        },
        {
          provide: PinoLogger,
          useValue: {
            setContext: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EsgScoringService>(EsgScoringService);
  });

  describe('calculateScore', () => {
    it('computes a high ESG score and AAA rating for sustainable practices', () => {
      const answers: EsgQuestionnaireDto = {
        deforestationFree: true,
        waterEfficiencyRating: 95,
        organicOrRegenerativePractices: true,
        renewableEnergyUsagePercent: 80,
        chemicalFertilizerReductionPercent: 70,

        childLaborSafeguardsVerified: true,
        workerSafetyProtocol: true,
        fairPricePremiumPercent: 15,
        femaleOrYouthFarmerInclusionPercent: 60,
        communityReinvestment: true,

        traceabilityLevel: 'blockchain_tokenized',
        clearLandTenureVerified: true,
        independentQualityAudit: true,
        antiCorruptionCompliance: true,
      };

      const result = service.calculateScore(answers);

      expect(result.esgScore).toBeGreaterThanOrEqual(85);
      expect(result.esgRating).toBe('AAA');
      expect(result.environmentalScore).toBeGreaterThan(80);
      expect(result.socialScore).toBeGreaterThan(80);
      expect(result.governanceScore).toBeGreaterThan(80);
      expect(result.breakdown.environmental.weight).toBe('40%');
      expect(result.breakdown.social.weight).toBe('35%');
      expect(result.breakdown.governance.weight).toBe('25%');
    });

    it('computes lower scores and CCC rating for poor ESG practices', () => {
      const answers: EsgQuestionnaireDto = {
        deforestationFree: false,
        waterEfficiencyRating: 20,
        organicOrRegenerativePractices: false,
        renewableEnergyUsagePercent: 0,

        childLaborSafeguardsVerified: false,
        workerSafetyProtocol: false,
        fairPricePremiumPercent: 0,
        femaleOrYouthFarmerInclusionPercent: 5,
        communityReinvestment: false,

        traceabilityLevel: 'basic',
        clearLandTenureVerified: false,
        independentQualityAudit: false,
        antiCorruptionCompliance: false,
      };

      const result = service.calculateScore(answers);

      expect(result.esgScore).toBeLessThan(35);
      expect(result.esgRating).toBe('CCC');
    });
  });

  describe('submitQuestionnaire', () => {
    it('saves score and sets status to pending_review for authorized trader', async () => {
      dealRepo.findOne.mockResolvedValue({ ...mockDeal });

      const answers: EsgQuestionnaireDto = {
        deforestationFree: true,
        waterEfficiencyRating: 80,
        organicOrRegenerativePractices: true,
        renewableEnergyUsagePercent: 50,
        childLaborSafeguardsVerified: true,
        workerSafetyProtocol: true,
        fairPricePremiumPercent: 10,
        femaleOrYouthFarmerInclusionPercent: 40,
        communityReinvestment: true,
        traceabilityLevel: 'iot_sensor_verified',
        clearLandTenureVerified: true,
        independentQualityAudit: true,
        antiCorruptionCompliance: true,
      };

      const saved = await service.submitQuestionnaire(
        'deal-123',
        'trader-1',
        answers,
      );

      expect(dealRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'deal-123' },
      });
      expect(saved.esgStatus).toBe('pending_review');
      expect(saved.esgScore).toBeDefined();
      expect(saved.esgRating).toBeDefined();
      expect(dealRepo.save).toHaveBeenCalled();
    });

    it('throws ForbiddenException if non-participant tries to submit', async () => {
      dealRepo.findOne.mockResolvedValue({ ...mockDeal });

      await expect(
        service.submitQuestionnaire('deal-123', 'unrelated-user', {} as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws NotFoundException if deal does not exist', async () => {
      dealRepo.findOne.mockResolvedValue(null);

      await expect(
        service.submitQuestionnaire('invalid-deal', 'trader-1', {} as any),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('collectDealEsgData', () => {
    it('updates specific ESG metrics and re-evaluates score', async () => {
      dealRepo.findOne.mockResolvedValue({
        ...mockDeal,
        esgBreakdown: {
          environmental: { deforestationFree: false, waterEfficiency: 50 },
          social: { fairPricePremium: 5 },
          governance: { traceabilityLevel: 'basic' },
        },
      });

      const updated = await service.collectDealEsgData('deal-123', 'farmer-1', {
        deforestationFree: true,
        waterEfficiencyRating: 90,
      });

      expect(updated.esgScore).toBeDefined();
      expect(dealRepo.save).toHaveBeenCalled();
    });
  });

  describe('reviewScore', () => {
    it('allows admin to approve an ESG score with review notes', async () => {
      dealRepo.findOne.mockResolvedValue({
        ...mockDeal,
        esgStatus: 'pending_review',
        esgScore: 82,
        esgRating: 'AA',
      });

      const updated = await service.reviewScore(
        'deal-123',
        'admin-user',
        true,
        'Verified satellite deforestation data',
      );

      expect(updated.esgStatus).toBe('approved');
      expect(updated.esgReviewedBy).toBe('admin-user');
      expect(updated.esgReviewNotes).toBe(
        'Verified satellite deforestation data',
      );
      expect(updated.esgReviewedAt).toBeDefined();
    });

    it('allows admin to approve with adjusted score', async () => {
      dealRepo.findOne.mockResolvedValue({
        ...mockDeal,
        esgStatus: 'pending_review',
        esgScore: 70,
        esgRating: 'A',
      });

      const updated = await service.reviewScore(
        'deal-123',
        'admin-user',
        true,
        'Awarded bonus for verified organic certification',
        88,
      );

      expect(updated.esgStatus).toBe('approved');
      expect(updated.esgScore).toBe(88);
      expect(updated.esgRating).toBe('AAA');
    });

    it('allows admin to reject ESG questionnaire submission', async () => {
      dealRepo.findOne.mockResolvedValue({
        ...mockDeal,
        esgStatus: 'pending_review',
      });

      const updated = await service.reviewScore(
        'deal-123',
        'admin-user',
        false,
        'Failed child labor audit documentation',
      );

      expect(updated.esgStatus).toBe('rejected');
      expect(updated.esgReviewNotes).toBe(
        'Failed child labor audit documentation',
      );
    });
  });

  describe('aggregatePortfolioEsg', () => {
    it('calculates dollar-weighted aggregate ESG scores across investor holdings', async () => {
      const mockInvestments = [
        {
          id: 'inv-1',
          investorId: 'investor-1',
          tradeDealId: 'deal-1',
          amountUsd: 10000,
          tradeDeal: {
            id: 'deal-1',
            commodity: 'Cocoa',
            esgScore: 90,
            environmentalScore: 92,
            socialScore: 88,
            governanceScore: 90,
            esgRating: 'AAA',
          },
        },
        {
          id: 'inv-2',
          investorId: 'investor-1',
          tradeDealId: 'deal-2',
          amountUsd: 10000,
          tradeDeal: {
            id: 'deal-2',
            commodity: 'Coffee',
            esgScore: 70,
            environmentalScore: 68,
            socialScore: 72,
            governanceScore: 70,
            esgRating: 'A',
          },
        },
      ] as unknown as Investment[];

      const summary = await service.aggregatePortfolioEsg(
        'investor-1',
        mockInvestments,
      );

      expect(summary.totalInvestedUsd).toBe(20000);
      expect(summary.portfolioEsgScore).toBe(80); // (90*10k + 70*10k)/20k = 80
      expect(summary.environmentalScore).toBe(80);
      expect(summary.portfolioRating).toBe('AA');
      expect(summary.esgCoveragePercent).toBe(100);
      expect(summary.dealContributions).toHaveLength(2);
      expect(summary.ratingDistribution['AAA'].percentage).toBe(50);
      expect(summary.ratingDistribution['A'].percentage).toBe(50);
    });

    it('returns zeroes for an empty portfolio', async () => {
      const summary = await service.aggregatePortfolioEsg('investor-empty', []);
      expect(summary.totalInvestedUsd).toBe(0);
      expect(summary.portfolioEsgScore).toBe(0);
      expect(summary.portfolioRating).toBe('CCC');
    });
  });

  describe('benchmarking', () => {
    it('returns SASB/GRI aligned benchmark for a commodity', () => {
      const benchmark = service.getIndustryBenchmarks('cocoa');
      expect(benchmark.standard).toBe('SASB_GRI_AGRI_2026');
      expect(benchmark.commodity).toBe('cocoa');
      expect(benchmark.overallScore).toBe(68.0);
    });

    it('benchmarks a deal against industry average', async () => {
      dealRepo.findOne.mockResolvedValue({
        id: 'deal-123',
        commodity: 'Cocoa',
        esgScore: 85,
        environmentalScore: 86,
        socialScore: 84,
        governanceScore: 85,
        esgRating: 'AAA',
      });

      const comparison = await service.benchmarkDeal('deal-123');

      expect(comparison.score).toBe(85);
      expect(comparison.variance.overall).toBe(17); // 85 - 68
      expect(comparison.performanceTier).toBe('Industry Leader');
      expect(comparison.percentileRank).toBeGreaterThan(80);
    });
  });

  describe('generateEsgReport', () => {
    it('generates an investor disclosure report for a deal', async () => {
      dealRepo.findOne.mockResolvedValue({
        id: 'deal-123',
        commodity: 'Coffee',
        quantity: 1000,
        esgScore: 82,
        environmentalScore: 80,
        socialScore: 85,
        governanceScore: 81,
        esgRating: 'AA',
        esgStatus: 'approved',
        esgBreakdown: {
          environmental: {
            deforestationFree: true,
            waterEfficiency: 85,
            renewableEnergy: 60,
          },
          social: {
            childLaborSafeguards: true,
            fairPricePremium: 12,
            workerSafety: true,
          },
          governance: {
            traceabilityLevel: 'blockchain_tokenized',
            antiCorruption: true,
          },
        },
      });

      const report = await service.generateEsgReport({
        dealId: 'deal-123',
        reportType: 'investor',
      });

      expect(report.reportId).toContain('ESG-REP');
      expect(report.entityType).toBe('deal');
      expect(report.summary.overallScore).toBe(82);
      expect(report.standardsAlignment.sasbMetrics.standardCode).toBe('FB-AG');
      expect(
        report.standardsAlignment.regulatoryDisclosures.euSfdrClassification,
      ).toBe('Article 8');
      expect(report.sustainabilityMetrics.deforestationFree).toBe(true);
    });

    it('generates a regulator disclosure report for an investor portfolio', async () => {
      const mockInvestments = [
        {
          id: 'inv-1',
          investorId: 'inv-user',
          amountUsd: 50000,
          tradeDeal: { id: 'd-1', esgScore: 88, commodity: 'Soy' },
        },
      ] as any;
      investmentRepo.find.mockResolvedValue(mockInvestments);

      const report = await service.generateEsgReport({
        investorId: 'inv-user',
        reportType: 'regulator',
      });

      expect(report.entityType).toBe('portfolio');
      expect(report.reportType).toBe('regulator');
      expect(report.summary.dataQualityGrade).toBe('Verified');
      expect(
        report.standardsAlignment.regulatoryDisclosures
          .principalAdverseImpactStatement,
      ).toBeDefined();
    });
  });

  describe('evaluateEsgAlerts', () => {
    it('creates alert on score drop >= 5 points', () => {
      const alerts = service.evaluateEsgAlerts('deal-1', 80, 72);
      expect(alerts).toHaveLength(2); // score_drop and rating_downgrade
      expect(alerts.some((a) => a.alertType === 'score_drop')).toBe(true);
      expect(alerts.some((a) => a.alertType === 'rating_downgrade')).toBe(true);
    });

    it('creates alert when institutional threshold of 60 is breached', () => {
      const alerts = service.evaluateEsgAlerts('deal-1', 65, 58);
      expect(alerts.some((a) => a.alertType === 'compliance_breach')).toBe(
        true,
      );
    });
  });

  describe('getOptimizationSuggestions', () => {
    it('returns ranked optimization recommendations for areas needing improvement', async () => {
      dealRepo.findOne.mockResolvedValue({
        id: 'deal-123',
        esgScore: 60,
        esgBreakdown: {
          environmental: { deforestationFree: false, waterEfficiency: 40 },
          social: { childLaborSafeguards: false, workerSafety: false },
          governance: { traceabilityLevel: 'basic', independentAudit: false },
        },
      });

      const suggestions = await service.getOptimizationSuggestions('deal-123');

      expect(suggestions.length).toBeGreaterThanOrEqual(4);
      expect(suggestions[0].potentialPointsGain).toBeGreaterThanOrEqual(
        suggestions[1].potentialPointsGain,
      );
      expect(suggestions.some((s) => s.pillar === 'environmental')).toBe(true);
      expect(suggestions.some((s) => s.pillar === 'social')).toBe(true);
    });
  });

  describe('certifyDeal', () => {
    it('issues a cryptographic certificate for eligible deal with score >= 80', async () => {
      dealRepo.findOne.mockResolvedValue({
        id: 'deal-cert-1',
        title: 'High ESG Cocoa',
        commodity: 'Cocoa',
        esgScore: 88,
        esgRating: 'AA',
        esgBreakdown: {
          social: { childLaborSafeguards: true },
        },
      });

      const cert = await service.certifyDeal('deal-cert-1', 'admin-auditor');

      expect(cert.certificateId).toContain('AGRIFI-ESG');
      expect(cert.tier).toBe('Gold');
      expect(cert.verificationHash).toBeDefined();
      expect(cert.criteriaMet.length).toBeGreaterThanOrEqual(3);
      expect(dealRepo.save).toHaveBeenCalled();
    });

    it('rejects certification if score is below 80', async () => {
      dealRepo.findOne.mockResolvedValue({
        id: 'deal-cert-2',
        esgScore: 74,
      });

      await expect(service.certifyDeal('deal-cert-2', 'admin')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('getEsgAnalytics', () => {
    it('aggregates platform statistics and ROI correlations', async () => {
      dealRepo.find.mockResolvedValue([
        {
          id: '1',
          commodity: 'Cocoa',
          esgScore: 85,
          esgRating: 'AAA',
          expectedRoi: 24,
        },
        {
          id: '2',
          commodity: 'Cocoa',
          esgScore: 80,
          esgRating: 'AA',
          expectedRoi: 22,
        },
        {
          id: '3',
          commodity: 'Coffee',
          esgScore: 65,
          esgRating: 'A',
          expectedRoi: 18,
        },
      ]);

      const analytics = await service.getEsgAnalytics();

      expect(analytics.totalRatedDeals).toBe(3);
      expect(analytics.averagePlatformEsgScore).toBeCloseTo(76.7, 1);
      expect(analytics.topCommoditiesByEsg.length).toBeGreaterThan(0);
      expect(analytics.financialCorrelation.highEsgAverageRoi).toBe(23); // (24+22)/2
      expect(analytics.financialCorrelation.standardAverageRoi).toBe(18);
    });
  });
});
