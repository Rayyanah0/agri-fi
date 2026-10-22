import { BadRequestException } from '@nestjs/common';
import { PortfolioVaRService } from './portfolio-var.service';

function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - days);
  return date;
}

function createService(
  options: {
    feeds?: any[];
    observations?: any[];
    limit?: any;
  } = {},
) {
  const investmentRepo = {
    find: jest.fn().mockResolvedValue([
      {
        amountUsd: '1000',
        tradeDeal: { commodity: 'Cocoa' },
      },
    ]),
  };
  const feedRepo = {
    find: jest
      .fn()
      .mockResolvedValue(
        options.feeds ?? [{ feedId: 'COCOA/USD', enabled: true }],
      ),
  };
  const observationRepo = {
    find: jest.fn().mockResolvedValue(
      options.observations ?? [
        {
          feedId: 'COCOA/USD',
          value: '100',
          valid: true,
          selected: true,
          fetchedAt: daysAgo(2),
        },
        {
          feedId: 'COCOA/USD',
          value: '90',
          valid: true,
          selected: true,
          fetchedAt: daysAgo(1),
        },
      ],
    ),
  };
  const limitRepo = {
    findOne: jest.fn().mockResolvedValue(options.limit ?? null),
    create: jest.fn((value) => value),
    save: jest.fn((value) => Promise.resolve(value)),
  };
  const notificationsService = {
    createNotification: jest.fn().mockResolvedValue({}),
  };

  return {
    service: new PortfolioVaRService(
      investmentRepo as any,
      feedRepo as any,
      observationRepo as any,
      limitRepo as any,
      notificationsService as any,
    ),
    limitRepo,
    notificationsService,
  };
}

describe('PortfolioVaRService', () => {
  it('calculates risk from selected commodity observations and reports its data timestamp', async () => {
    const { service } = createService();

    const result = await service.calculate('investor-1');

    expect(result.varUsd).toBeCloseTo(100);
    expect(result.expectedShortfallUsd).toBeCloseTo(100);
    expect(result.portfolioValueUsd).toBe(1000);
    expect(result.components).toHaveLength(1);
    expect(result.marketDataAsOf).toBe(daysAgo(1).toISOString());
  });

  it('rejects portfolio commodities without an enabled oracle feed', async () => {
    const { service } = createService({ feeds: [] });

    await expect(service.calculate('investor-1')).rejects.toThrow(
      new BadRequestException(
        'No enabled commodity oracle feed maps to: cocoa',
      ),
    );
  });

  it('applies commodity-keyed and portfolio-wide stress shocks', async () => {
    const { service } = createService();

    const result = await service.stressTest('investor-1', [
      { name: 'Cocoa shock', shocks: { cocoa: -0.2 } },
      { name: 'Market shock', shocks: { '*': -0.4 } },
    ]);

    expect(result.scenarios[0].lossUsd).toBeCloseTo(200);
    expect(result.scenarios[1].lossUsd).toBeCloseTo(400);
    expect(result.scenarios[1].stressedValueUsd).toBeCloseTo(600);
  });

  it('stores each investor limit by confidence and horizon', async () => {
    const { service, limitRepo } = createService();
    const dto = { confidenceLevel: 0.99, horizonDays: 10, limitUsd: 250 };

    await service.setLimit('investor-1', dto);

    expect(limitRepo.create).toHaveBeenCalledWith({
      ...dto,
      investorId: 'investor-1',
    });
  });

  it('sends one notification when a VaR limit first breaches', async () => {
    const limit = {
      limitUsd: '50',
      lastBreached: false,
      lastAlertedAt: null,
    };
    const { service, limitRepo, notificationsService } = createService({
      limit,
    });

    const result = await service.calculate('investor-1');

    expect(result.limit).toEqual({ limitUsd: 50, breached: true });
    expect(notificationsService.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'investor-1',
        type: 'alert',
        title: 'Portfolio VaR limit exceeded',
      }),
    );
    expect(limit.lastBreached).toBe(true);
    expect(limitRepo.save).toHaveBeenCalledWith(limit);
  });
});
