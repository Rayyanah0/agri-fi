import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { User } from '../auth/entities/user.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { FarmerCreditScoringService } from './farmer-credit-scoring.service';
import { FarmerCreditPerformanceService } from './farmer-credit-performance.service';
import { FarmerCreditDisputeService } from './farmer-credit-dispute.service';
import { FarmerCreditScoreDispute } from './entities/farmer-credit-score-dispute.entity';

describe('FarmerCreditDisputeService (#1160)', () => {
  let service: FarmerCreditDisputeService;

  let disputeRepo: any;
  let userRepo: any;
  let scoringService: any;
  let performanceService: any;
  let notificationsService: any;

  const farmer = {
    id: 'farmer-1',
    role: 'farmer',
    creditScore: 690,
  } as Partial<User>;

  beforeEach(async () => {
    disputeRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((data) => ({ id: 'dispute-1', ...data })),
      save: jest.fn((data) => Promise.resolve(data)),
    };
    userRepo = {
      findOne: jest.fn().mockResolvedValue(farmer),
    };
    scoringService = {
      manualOverride: jest.fn().mockResolvedValue({ id: 'h-1' }),
    };
    performanceService = {
      recalculate: jest.fn().mockResolvedValue({ score: 742 }),
    };
    notificationsService = {
      createNotification: jest.fn().mockResolvedValue({ id: 'n-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FarmerCreditDisputeService,
        { provide: getRepositoryToken(FarmerCreditScoreDispute), useValue: disputeRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: FarmerCreditScoringService, useValue: scoringService },
        { provide: FarmerCreditPerformanceService, useValue: performanceService },
        { provide: NotificationsService, useValue: notificationsService },
      ],
    }).compile();

    service = module.get<FarmerCreditDisputeService>(FarmerCreditDisputeService);
  });

  describe('fileDispute', () => {
    it('records the score the farmer was shown', async () => {
      const dispute = await service.fileDispute('farmer-1', {
        reason: 'My delivery was on time.',
        factor: 'onTimeRepayment',
      });

      expect(dispute.userId).toBe('farmer-1');
      expect(dispute.disputedScore).toBe(690);
      expect(dispute.status).toBe('open');
      expect(dispute.factor).toBe('onTimeRepayment');
    });

    it('refuses a dispute from a non-farmer', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'inv-1', role: 'investor' });

      await expect(
        service.fileDispute('inv-1', { reason: 'Not my score.' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refuses a second dispute while one is still open', async () => {
      disputeRepo.findOne.mockResolvedValue({ id: 'dispute-0', status: 'open' });

      await expect(
        service.fileDispute('farmer-1', { reason: 'Another one.' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a dispute for an unknown user', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.fileDispute('nope', { reason: 'Hello.' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('resolveDispute', () => {
    const openDispute = {
      id: 'dispute-1',
      userId: 'farmer-1',
      disputedScore: 690,
      reason: 'My delivery was on time.',
      factor: 'onTimeRepayment',
      status: 'open' as const,
      resolution: null,
      correctedScore: null,
      resolvedBy: null,
      resolvedAt: null,
    };

    it('applies the administrator score when the dispute is upheld', async () => {
      disputeRepo.findOne.mockResolvedValue({ ...openDispute });

      const resolved = await service.resolveDispute('admin-1', 'dispute-1', {
        status: 'resolved',
        resolution: 'Delivery confirmed on time.',
        correctedScore: 742,
      });

      expect(scoringService.manualOverride).toHaveBeenCalledWith(
        'admin-1',
        'farmer-1',
        742,
        expect.stringContaining('dispute-1'),
      );
      expect(resolved.status).toBe('resolved');
      expect(resolved.correctedScore).toBe(742);
      expect(resolved.resolvedBy).toBe('admin-1');
      expect(resolved.resolvedAt).toBeInstanceOf(Date);
    });

    it('re-measures the farmer when no corrected score is supplied', async () => {
      disputeRepo.findOne.mockResolvedValue({ ...openDispute });

      const resolved = await service.resolveDispute('admin-1', 'dispute-1', {
        status: 'resolved',
        resolution: 'Milestone corrected upstream.',
      });

      expect(performanceService.recalculate).toHaveBeenCalledWith(
        'farmer-1',
        expect.stringContaining('dispute-1'),
      );
      expect(scoringService.manualOverride).not.toHaveBeenCalled();
      expect(resolved.correctedScore).toBe(742);
    });

    it('closes a rejected dispute without touching the score', async () => {
      disputeRepo.findOne.mockResolvedValue({ ...openDispute });

      const resolved = await service.resolveDispute('admin-1', 'dispute-1', {
        status: 'rejected',
        resolution: 'The milestone was recorded late.',
      });

      expect(scoringService.manualOverride).not.toHaveBeenCalled();
      expect(performanceService.recalculate).not.toHaveBeenCalled();
      expect(resolved.status).toBe('rejected');
      expect(resolved.correctedScore).toBeNull();
    });

    it('refuses to resolve a dispute twice', async () => {
      disputeRepo.findOne.mockResolvedValue({ ...openDispute, status: 'resolved' });

      await expect(
        service.resolveDispute('admin-1', 'dispute-1', {
          status: 'rejected',
          resolution: 'Too late.',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an unknown dispute', async () => {
      disputeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.resolveDispute('admin-1', 'missing', {
          status: 'resolved',
          resolution: 'Nope.',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('tells the farmer how the dispute was handled', async () => {
      disputeRepo.findOne.mockResolvedValue({ ...openDispute });

      await service.resolveDispute('admin-1', 'dispute-1', {
        status: 'resolved',
        resolution: 'Delivery confirmed on time.',
        correctedScore: 742,
      });

      expect(notificationsService.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'farmer-1',
          title: expect.stringContaining('upheld'),
        }),
      );
    });
  });
});
