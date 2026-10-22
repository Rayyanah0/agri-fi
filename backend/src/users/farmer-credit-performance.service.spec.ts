import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { KycSubmission } from '../auth/entities/kyc-submission.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { MilestoneVerification } from '../shipments/entities/milestone-verification.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';
import { FarmerCreditScoreHistory } from './entities/farmer-credit-score-history.entity';
import { FarmerCreditScoringService } from './farmer-credit-scoring.service';
import { FarmerCreditPerformanceService } from './farmer-credit-performance.service';
import { NotificationsService } from '../notifications/notifications.service';

describe('FarmerCreditPerformanceService (#1160)', () => {
  let service: FarmerCreditPerformanceService;

  let userRepo: any;
  let dealRepo: any;
  let milestoneRepo: any;
  let verificationRepo: any;
  let documentRepo: any;
  let paymentRepo: any;
  let kycRepo: any;
  let historyRepo: any;
  let scoringService: any;
  let notificationsService: any;

  const farmer = {
    id: 'farmer-1',
    role: 'farmer',
    country: 'Nigeria',
    creditScore: 700,
    createdAt: new Date('2024-01-01'),
  } as Partial<User>;

  beforeEach(async () => {
    userRepo = {
      findOne: jest.fn().mockResolvedValue(farmer),
      find: jest.fn().mockResolvedValue([]),
    };
    dealRepo = { find: jest.fn().mockResolvedValue([]) };
    milestoneRepo = { find: jest.fn().mockResolvedValue([]) };
    verificationRepo = { find: jest.fn().mockResolvedValue([]) };
    documentRepo = { find: jest.fn().mockResolvedValue([]) };
    paymentRepo = { find: jest.fn().mockResolvedValue([]) };
    kycRepo = { findOne: jest.fn().mockResolvedValue(null) };
    historyRepo = { find: jest.fn().mockResolvedValue([]) };
    scoringService = {
      deriveScoreTier: jest.fn((score: number) =>
        score >= 750 ? 'Excellent' : score >= 700 ? 'Good' : score >= 650 ? 'Fair' : 'Poor',
      ),
      deriveMaxDealSize: jest.fn((score: number) =>
        score < 650 ? 10000 : score < 750 ? 50000 : 200000,
      ),
      computeScore: jest.fn().mockResolvedValue({ score: 700, maxDealSizeUsdc: 50000 }),
    };
    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'n-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FarmerCreditPerformanceService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(TradeDeal), useValue: dealRepo },
        { provide: getRepositoryToken(ShipmentMilestone), useValue: milestoneRepo },
        { provide: getRepositoryToken(MilestoneVerification), useValue: verificationRepo },
        { provide: getRepositoryToken(Document), useValue: documentRepo },
        { provide: getRepositoryToken(PaymentDistribution), useValue: paymentRepo },
        { provide: getRepositoryToken(KycSubmission), useValue: kycRepo },
        { provide: getRepositoryToken(FarmerCreditScoreHistory), useValue: historyRepo },
        { provide: FarmerCreditScoringService, useValue: scoringService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<FarmerCreditPerformanceService>(
      FarmerCreditPerformanceService,
    );
  });

  describe('deriveFactors', () => {
    it('scores a farmer with no history at the neutral midpoint', async () => {
      const factors = await service.deriveFactors('farmer-1');

      expect(factors.onTimeRepaymentRate).toBe(0.5);
      expect(factors.dealCompletionRate).toBe(0.5);
      expect(factors.dealDefaultRate).toBe(0.5);
      expect(factors.shipmentAccuracyRate).toBe(0.5);
      expect(factors.documentQualityRate).toBe(0.5);
      expect(factors.kycVerificationAgeDays).toBe(0);
    });

    it('measures on-time delivery against the contractual delivery date', async () => {
      const deliveryDate = new Date('2026-06-30');
      dealRepo.find.mockResolvedValue([
        { id: 'd1', status: 'completed', deliveryDate },
        { id: 'd2', status: 'completed', deliveryDate },
      ]);
      milestoneRepo.find.mockResolvedValue([
        {
          id: 'm1',
          tradeDealId: 'd1',
          milestone: 'importer',
          recordedAt: new Date('2026-06-28'),
        },
        {
          id: 'm2',
          tradeDealId: 'd2',
          milestone: 'importer',
          recordedAt: new Date('2026-07-04'),
        },
      ]);

      const factors = await service.deriveFactors('farmer-1');

      // One of the two deliveries landed on time.
      expect(factors.onTimeRepaymentRate).toBe(0.5);
    });

    it('counts a delivery recorded on the delivery date itself as on time', async () => {
      const deliveryDate = new Date('2026-06-30');
      dealRepo.find.mockResolvedValue([
        { id: 'd1', status: 'completed', deliveryDate },
      ]);
      milestoneRepo.find.mockResolvedValue([
        {
          id: 'm1',
          tradeDealId: 'd1',
          milestone: 'importer',
          recordedAt: new Date('2026-06-30T18:00:00.000Z'),
        },
      ]);

      const factors = await service.deriveFactors('farmer-1');

      expect(factors.onTimeRepaymentRate).toBe(1);
    });

    it('separates a cancelled deal from a defaulted one', async () => {
      dealRepo.find.mockResolvedValue([
        { id: 'd1', status: 'completed', deliveryDate: new Date('2026-06-30') },
        { id: 'd2', status: 'canceled', deliveryDate: new Date('2026-06-30') },
        { id: 'd3', status: 'failed', deliveryDate: new Date('2026-06-30') },
      ]);

      const factors = await service.deriveFactors('farmer-1');

      // A cancelled deal still counts against the completion rate...
      expect(factors.dealCompletionRate).toBeCloseTo(1 / 3, 5);
      // ...but it is not a repayment failure.
      expect(factors.dealDefaultRate).toBeCloseTo(0.5, 5);
    });

    it('rejects a shipment whose milestone chain has a gap', async () => {
      dealRepo.find.mockResolvedValue([
        { id: 'd1', status: 'funded', deliveryDate: new Date('2026-06-30') },
        { id: 'd2', status: 'funded', deliveryDate: new Date('2026-06-30') },
      ]);
      milestoneRepo.find.mockResolvedValue([
        { id: 'm1', tradeDealId: 'd1', milestone: 'farm', recordedAt: new Date() },
        { id: 'm2', tradeDealId: 'd1', milestone: 'port', recordedAt: new Date() },
        { id: 'm3', tradeDealId: 'd2', milestone: 'farm', recordedAt: new Date() },
      ]);

      const factors = await service.deriveFactors('farmer-1');

      // d1 skipped `warehouse`, d2 is only at the farm stage (no gap yet).
      expect(factors.shipmentMilestoneComplianceRate).toBe(0.5);
    });

    it('uses verifier verdicts for shipment accuracy', async () => {
      milestoneRepo.find.mockResolvedValue([
        { id: 'm1', tradeDealId: 'd1', milestone: 'farm', recordedAt: new Date() },
        { id: 'm2', tradeDealId: 'd1', milestone: 'port', recordedAt: new Date() },
      ]);
      verificationRepo.find.mockResolvedValue([
        { id: 'v1', milestoneId: 'm1', status: 'verified' },
        { id: 'v2', milestoneId: 'm2', status: 'rejected' },
      ]);

      const factors = await service.deriveFactors('farmer-1');

      expect(factors.shipmentAccuracyRate).toBe(0.5);
    });

    it('ignores documents that are still awaiting a verdict', async () => {
      documentRepo.find.mockResolvedValue([
        { id: 'doc1', verificationStatus: 'approved' },
        { id: 'doc2', verificationStatus: 'rejected' },
        { id: 'doc3', verificationStatus: 'pending' },
      ]);

      const factors = await service.deriveFactors('farmer-1');

      expect(factors.documentQualityRate).toBe(0.5);
    });

    it('counts the days since the farmer was approved for KYC', async () => {
      kycRepo.findOne.mockResolvedValue({
        userId: 'farmer-1',
        status: 'approved',
        createdAt: new Date(Date.now() - 200 * 24 * 60 * 60 * 1000),
      });

      const factors = await service.deriveFactors('farmer-1');

      expect(factors.kycVerificationAgeDays).toBeGreaterThanOrEqual(199);
      expect(factors.kycVerificationAgeDays).toBeLessThanOrEqual(201);
    });
  });

  describe('recalculate', () => {
    it('stores the freshly measured score', async () => {
      const outcome = await service.recalculate('farmer-1', 'Test run');

      expect(scoringService.computeScore).toHaveBeenCalledWith(
        'farmer-1',
        'Test run',
        expect.any(Object),
      );
      expect(outcome.score).toBe(700);
    });

    it('notifies the farmer when the tier changes', async () => {
      userRepo.findOne.mockResolvedValue({ ...farmer, creditScore: 690 });

      const outcome = await service.recalculate('farmer-1');

      expect(outcome.tierChanged).toBe(true);
      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'farmer-1',
          type: 'alert',
          title: expect.stringContaining('Good'),
        }),
      );
    });

    it('stays quiet when the score did not move', async () => {
      const outcome = await service.recalculate('farmer-1');

      expect(outcome.scoreChanged).toBe(false);
      expect(outcome.tierChanged).toBe(false);
      expect(notificationsService.createNotification).not.toHaveBeenCalled();
    });

    it('does not fail the recalculation when the notification fails', async () => {
      notificationsService.createNotification.mockRejectedValue(new Error('redis down'));
      userRepo.findOne.mockResolvedValue({ ...farmer, creditScore: 690 });

      const outcome = await service.recalculate('farmer-1');

      expect(outcome.tierChanged).toBe(true);
      expect(outcome.score).toBe(700);
    });
  });

  describe('getMonthlyHistory', () => {
    it('keeps the most recent score of each month and reports the change', async () => {
      historyRepo.find.mockResolvedValue([
        {
          id: 'h3',
          score: 730,
          maxDealSizeUsdc: 50000,
          createdAt: new Date('2026-09-14T10:00:00.000Z'),
        },
        {
          id: 'h2',
          score: 710,
          maxDealSizeUsdc: 50000,
          createdAt: new Date('2026-08-20T10:00:00.000Z'),
        },
        {
          id: 'h1',
          score: 700,
          maxDealSizeUsdc: 50000,
          createdAt: new Date('2026-08-02T10:00:00.000Z'),
        },
      ]);

      const history = await service.getMonthlyHistory('farmer-1');

      expect(history).toHaveLength(2);
      expect(history[0].month).toBe('2026-08');
      expect(history[0].score).toBe(710);
      expect(history[0].change).toBeNull();
      expect(history[1].month).toBe('2026-09');
      expect(history[1].score).toBe(730);
      expect(history[1].change).toBe(20);
    });
  });

  describe('getPeerBenchmark', () => {
    it('compares the farmer against the regional average and median', async () => {
      userRepo.find.mockResolvedValue([
        { id: 'farmer-1', creditScore: 700 },
        { id: 'p1', creditScore: 600 },
        { id: 'p2', creditScore: 650 },
        { id: 'p3', creditScore: 800 },
        { id: 'p4', creditScore: null },
      ]);

      const benchmark = await service.getPeerBenchmark('farmer-1');

      expect(benchmark.country).toBe('Nigeria');
      // The unscored peer is excluded, and so is the farmer themselves.
      expect(benchmark.peerCount).toBe(3);
      // (600 + 650 + 800) / 3 = 683.33
      expect(benchmark.averageScore).toBe(683);
      expect(benchmark.medianScore).toBe(650);
      expect(benchmark.score).toBe(700);
      expect(benchmark.tier).toBe('Good');
      expect(benchmark.tierDistribution).toEqual({
        Excellent: 1,
        Good: 0,
        Fair: 1,
        Poor: 1,
      });
    });

    it('reports the percentile of the farmer within their region', async () => {
      userRepo.find.mockResolvedValue([
        { id: 'farmer-1', creditScore: 700 },
        { id: 'p1', creditScore: 600 },
        { id: 'p2', creditScore: 650 },
        { id: 'p3', creditScore: 800 },
      ]);

      const benchmark = await service.getPeerBenchmark('farmer-1');

      // Two of the three peers score at or below 700.
      expect(benchmark.percentile).toBe(67);
    });
  });

  describe('getInvestmentRecommendations', () => {
    it('only recommends deals from farmers at or above the requested tier', async () => {
      userRepo.find.mockResolvedValue([
        { id: 'farmer-high', creditScore: 780 },
        { id: 'farmer-low', creditScore: 500 },
      ]);
      dealRepo.find.mockResolvedValue([
        {
          id: 'd-good',
          farmerId: 'farmer-high',
          commodity: 'Cocoa',
          totalValue: 40000,
          expectedRoi: 12,
        },
        {
          id: 'd-bad',
          farmerId: 'farmer-low',
          commodity: 'Maize',
          totalValue: 10000,
          expectedRoi: 8,
        },
      ]);

      const recommendations = await service.getInvestmentRecommendations({
        minTier: 'Good',
      });

      expect(recommendations).toHaveLength(1);
      expect(recommendations[0].dealId).toBe('d-good');
      expect(recommendations[0].farmerCreditTier).toBe('Excellent');
      expect(recommendations[0].rationale).toContain('Excellent credit score');
    });

    it('skips a deal that exceeds the ceiling the farmer score grants', async () => {
      userRepo.find.mockResolvedValue([{ id: 'farmer-mid', creditScore: 700 }]);
      dealRepo.find.mockResolvedValue([
        {
          id: 'd-too-big',
          farmerId: 'farmer-mid',
          commodity: 'Cocoa',
          totalValue: 120000,
          expectedRoi: 12,
        },
      ]);

      const recommendations = await service.getInvestmentRecommendations({
        minTier: 'Good',
      });

      // A 700 score grants a $50K ceiling, so a $120K deal is not offered.
      expect(recommendations).toHaveLength(0);
    });
  });
});
