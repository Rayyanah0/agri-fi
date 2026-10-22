import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { DataSource } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { KycSubmission } from '../auth/entities/kyc-submission.entity';
import { AuditLog } from '../database/entities/audit-log.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';
import { Investment } from '../investments/entities/investment.entity';
import { ShipmentMilestone } from '../shipments/entities/shipment-milestone.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { UsersService } from './users.service';

/**
 * Cross-device appearance preferences (#1170).
 */
describe('UsersService — theme preferences', () => {
  let service: UsersService;
  let userRepository: { findOne: jest.Mock; save: jest.Mock };

  const baseUser = {
    id: 'user-1',
    email: 'farmer@example.com',
    role: 'farmer',
    kycStatus: 'verified',
    walletAddress: null,
    isCompany: false,
    isMfaEnabled: false,
    companyDetails: null,
    country: 'GH',
    createdAt: new Date('2026-01-01'),
    themePreferences: null,
  };

  beforeEach(async () => {
    userRepository = { findOne: jest.fn(), save: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        {
          provide: getRepositoryToken(TradeDeal),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(Investment),
          useValue: { find: jest.fn() },
        },
        {
          provide: getRepositoryToken(ShipmentMilestone),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(PaymentDistribution),
          useValue: { findOne: jest.fn() },
        },
        {
          provide: getRepositoryToken(KycSubmission),
          useValue: { find: jest.fn(), findOne: jest.fn(), save: jest.fn() },
        },
        {
          provide: getRepositoryToken(Document),
          useValue: { find: jest.fn(), findOne: jest.fn(), save: jest.fn() },
        },
        {
          provide: getRepositoryToken(AuditLog),
          useValue: { find: jest.fn(), findOne: jest.fn(), save: jest.fn() },
        },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
        {
          provide: CACHE_MANAGER,
          useValue: { get: jest.fn(), set: jest.fn(), del: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  describe('getProfile', () => {
    it('includes the theme preferences', async () => {
      userRepository.findOne.mockResolvedValue({
        ...baseUser,
        themePreferences: { variant: 'dark', accent: 'teal' },
      });

      const result = await service.getProfile('user-1');

      expect(result.themePreferences).toEqual({
        variant: 'dark',
        accent: 'teal',
      });
    });

    it('returns null when no preferences have been saved yet', async () => {
      userRepository.findOne.mockResolvedValue(baseUser);

      const result = await service.getProfile('user-1');

      expect(result.themePreferences).toBeNull();
    });
  });

  describe('updatePreferences', () => {
    it('persists the supplied theme preferences', async () => {
      const user = { ...baseUser };
      userRepository.findOne.mockResolvedValue(user);
      userRepository.save.mockImplementation(async (entity: unknown) => entity);

      const result = await service.updatePreferences('user-1', {
        themePreferences: {
          variant: 'high-contrast',
          accent: 'violet',
          fontSize: 'large',
          contrast: 'high',
          customBrandColor: '142 50% 24%',
        },
      });

      expect(userRepository.save).toHaveBeenCalledTimes(1);
      expect(result.themePreferences).toEqual(
        expect.objectContaining({
          variant: 'high-contrast',
          accent: 'violet',
          fontSize: 'large',
          contrast: 'high',
          customBrandColor: '142 50% 24%',
        }),
      );
    });

    it('stamps the preferences with an updatedAt timestamp', async () => {
      const user = { ...baseUser };
      userRepository.findOne.mockResolvedValue(user);
      userRepository.save.mockImplementation(async (entity: unknown) => entity);

      const result = await service.updatePreferences('user-1', {
        themePreferences: {
          variant: 'dark',
          accent: 'emerald',
          fontSize: 'medium',
          contrast: 'normal',
        },
      });

      expect(typeof result.themePreferences?.updatedAt).toBe('string');
      expect(
        Date.parse(result.themePreferences?.updatedAt as string),
      ).not.toBeNaN();
    });

    it('keeps the client supplied updatedAt when present', async () => {
      const user = { ...baseUser };
      userRepository.findOne.mockResolvedValue(user);
      userRepository.save.mockImplementation(async (entity: unknown) => entity);

      const result = await service.updatePreferences('user-1', {
        themePreferences: {
          variant: 'dark',
          accent: 'emerald',
          fontSize: 'medium',
          contrast: 'normal',
          updatedAt: '2026-01-15T10:30:00.000Z',
        },
      });

      expect(result.themePreferences?.updatedAt).toBe(
        '2026-01-15T10:30:00.000Z',
      );
    });

    it('throws NotFoundException when the user does not exist', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updatePreferences('missing-user', {
          themePreferences: {
            variant: 'dark',
            accent: 'emerald',
            fontSize: 'medium',
            contrast: 'normal',
          },
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
