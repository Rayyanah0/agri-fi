import { BadRequestException } from '@nestjs/common';
import { OracleService } from './oracle.service';
import { OracleValidationService } from './oracle-validation.service';
import { OracleFeed } from './entities/oracle-feed.entity';

type MockRepo = Record<string, jest.Mock>;

function feedFactory(overrides: Partial<OracleFeed> = {}): OracleFeed {
  return {
    id: 'f1',
    feedId: 'COCOA/USD',
    description: null,
    dataType: 'commodity',
    providers: ['chainlink', 'band'],
    quorum: 1,
    decimals: 7,
    heartbeatSeconds: 3600,
    maxDeviationBps: 1000,
    contractId: 'CABC',
    oracleAddress: 'GABC',
    maxDailyCostXlm: null,
    enabled: true,
    lastValue: 100,
    lastRoundId: null,
    lastObservedAt: null,
    lastChangedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as OracleFeed;
}

function reading(value: number, provider: 'chainlink' | 'band' = 'chainlink') {
  return {
    value,
    decimals: 7,
    roundId: '1',
    observedAt: new Date(),
    provider,
  };
}

describe('OracleService (#1235)', () => {
  let service: OracleService;
  let feedRepo: MockRepo;
  let observationRepo: MockRepo;
  let chainlink: { fetch: jest.Mock };
  let band: { fetch: jest.Mock };
  let onChain: { submitPrice: jest.Mock; estimateGasCostXlm: jest.Mock };
  let config: { get: jest.Mock };

  beforeEach(() => {
    feedRepo = {
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
      findOne: jest.fn(async () => feedFactory()),
      find: jest.fn(async () => []),
    };
    observationRepo = {
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
      find: jest.fn(async () => []),
      update: jest.fn(async () => undefined),
    };
    chainlink = { fetch: jest.fn(async () => reading(101)) };
    band = { fetch: jest.fn(async () => reading(102, 'band')) };
    onChain = {
      submitPrice: jest.fn(async () => ({
        txId: 'tx-1',
        gasCostXlm: 0.01,
        onChainValue: '1010000000',
      })),
      estimateGasCostXlm: jest.fn(() => 0.01),
    };
    config = { get: jest.fn((_key: string, fallback?: unknown) => fallback) };

    service = new OracleService(
      feedRepo as never,
      observationRepo as never,
      new OracleValidationService(),
      onChain as never,
      config as never,
      chainlink as never,
      band as never,
    );
  });

  describe('createFeed', () => {
    it('rejects duplicate feed ids', async () => {
      feedRepo.findOne.mockResolvedValueOnce(feedFactory());
      await expect(
        service.createFeed('admin', {
          feedId: 'COCOA/USD',
          providers: ['chainlink'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects unknown providers', async () => {
      feedRepo.findOne.mockResolvedValueOnce(null);
      await expect(
        service.createFeed('admin', {
          feedId: 'NEW/USD',
          providers: ['bogus' as never],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('persists a valid feed', async () => {
      feedRepo.findOne.mockResolvedValueOnce(null);
      const feed = await service.createFeed('admin', {
        feedId: 'NEW/USD',
        providers: ['chainlink', 'band'],
        quorum: 2,
      });
      expect(feedRepo.save).toHaveBeenCalled();
      expect(feed.lastChangedBy).toBe('admin');
    });
  });

  describe('runFeed', () => {
    it('fetches, stores observations and submits on-chain', async () => {
      const result = await service.runFeed('COCOA/USD');
      expect(result.ok).toBe(true);
      expect(result.submitted).toBe(true);
      expect(result.stellarTxId).toBe('tx-1');
      expect(observationRepo.save).toHaveBeenCalled();
      expect(onChain.submitPrice).toHaveBeenCalled();
    });

    it('falls back to the secondary provider when the primary fails', async () => {
      chainlink.fetch.mockRejectedValueOnce(new Error('down'));
      const result = await service.runFeed('COCOA/USD');
      expect(result.ok).toBe(true);
      const bandOutcome = result.readings.find((r) => r.provider === 'band');
      expect(bandOutcome?.isFallback).toBe(true);
      expect(bandOutcome?.valid).toBe(true);
    });

    it('does not submit when consensus fails', async () => {
      feedRepo.findOne.mockResolvedValueOnce(feedFactory({ quorum: 2 }));
      chainlink.fetch.mockResolvedValueOnce(reading(100));
      band.fetch.mockResolvedValueOnce(reading(500, 'band'));
      const result = await service.runFeed('COCOA/USD', { submit: true });
      expect(result.ok).toBe(false);
      expect(result.submitted).toBe(false);
    });

    it('enforces the daily cost budget', async () => {
      feedRepo.findOne.mockResolvedValueOnce(
        feedFactory({ maxDailyCostXlm: 0.005 }),
      );
      observationRepo.find.mockResolvedValueOnce([
        { gasCostXlm: 0.01, fetchedAt: new Date() },
      ]);
      await expect(service.runFeed('COCOA/USD')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects disabled feeds', async () => {
      feedRepo.findOne.mockResolvedValueOnce(feedFactory({ enabled: false }));
      await expect(service.runFeed('COCOA/USD')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('testFeed', () => {
    it('never writes on-chain', async () => {
      const result = await service.testFeed('COCOA/USD');
      expect(result.submitted).toBe(false);
      expect(onChain.submitPrice).not.toHaveBeenCalled();
    });
  });

  describe('getAnalytics', () => {
    it('aggregates validity, latency and cost', async () => {
      observationRepo.find.mockResolvedValueOnce([
        {
          feedId: 'COCOA/USD',
          provider: 'chainlink',
          valid: true,
          latencyMs: 100,
          deviationBps: 10,
          onChain: true,
          gasCostXlm: 0.01,
          fetchedAt: new Date(),
        },
        {
          feedId: 'COCOA/USD',
          provider: 'band',
          valid: false,
          latencyMs: 200,
          deviationBps: null,
          onChain: false,
          gasCostXlm: null,
          fetchedAt: new Date(),
        },
      ]);
      const analytics = await service.getAnalytics('COCOA/USD');
      expect(analytics.totalObservations).toBe(2);
      expect(analytics.validRate).toBe(0.5);
      expect(analytics.onChainSubmissions).toBe(1);
      expect(analytics.totalGasCostXlm).toBeCloseTo(0.01);
      expect(analytics.byProvider).toHaveLength(2);
    });
  });
});

describe('OracleValidationService (#1235)', () => {
  const validation = new OracleValidationService();

  it('rejects non-positive values', () => {
    const result = validation.validateReading(
      reading(0),
      feedFactory(),
      100,
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe('invalid_value');
  });

  it('rejects stale readings', () => {
    const stale = { ...reading(101), observedAt: new Date(Date.now() - 7_200_000) };
    const result = validation.validateReading(stale, feedFactory(), 100);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('stale_reading');
  });

  it('rejects excessive deviation', () => {
    const result = validation.validateReading(reading(200), feedFactory(), 100);
    expect(result.valid).toBe(false);
    expect(result.error).toBe('deviation_too_high');
  });

  it('accepts a reading within bounds', () => {
    const result = validation.validateReading(reading(101), feedFactory(), 100);
    expect(result.valid).toBe(true);
  });

  it('requires quorum to agree on the median', () => {
    const feed = feedFactory({ quorum: 2, maxDeviationBps: 100 });
    expect(validation.consensus([reading(100), reading(101)], feed).ok).toBe(
      true,
    );
    const divergent = validation.consensus(
      [reading(100), reading(500, 'band')],
      feed,
    );
    expect(divergent.ok).toBe(false);
    expect(divergent.reason).toBe('quorum_not_met');
  });
});
