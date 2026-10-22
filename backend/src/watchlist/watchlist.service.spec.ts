import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WatchlistItem } from './entities/watchlist-item.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { WatchlistService } from './watchlist.service';

const USER_ID = 'investor-uuid';
const DEAL_ID = 'deal-uuid';

interface RepoStub {
  find: jest.Mock;
  findOne: jest.Mock;
  save: jest.Mock;
  create: jest.Mock;
  remove: jest.Mock;
}

function stubRepo(): RepoStub {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn(async (value: unknown) => ({
      id: 'watchlist-uuid',
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      ...(value as object),
    })),
    create: jest.fn((value: object) => value),
    remove: jest.fn().mockResolvedValue(undefined),
  };
}

const deal = (overrides: Partial<TradeDeal> = {}): TradeDeal =>
  ({
    id: DEAL_ID,
    title: 'Cocoa harvest',
    commodity: 'Cocoa',
    country: 'Nigeria',
    status: 'open',
    tokenSymbol: 'COCOA24',
    totalValue: 5000,
    totalInvested: 3000,
    expectedRoi: 12,
    deliveryDate: new Date('2026-12-01'),
    escrowSecretKey: 'SSECRET',
    issuerSecretKey: 'SSECRET2',
    ...overrides,
  }) as TradeDeal;

const item = (overrides: Partial<WatchlistItem> = {}): WatchlistItem =>
  ({
    id: 'watchlist-uuid',
    userId: USER_ID,
    dealId: DEAL_ID,
    notifyFundingPct: [50, 100],
    notifyStatusChange: true,
    alertedPct: 60,
    alertedStatus: 'open',
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...overrides,
  }) as WatchlistItem;

describe('WatchlistService', () => {
  let watchlistRepo: RepoStub;
  let dealRepo: RepoStub;
  let service: WatchlistService;

  beforeEach(() => {
    watchlistRepo = stubRepo();
    dealRepo = stubRepo();
    dealRepo.findOne.mockImplementation(async ({ where }: any) =>
      where?.id === DEAL_ID ? deal() : null,
    );
    service = new WatchlistService(watchlistRepo as any, dealRepo as any);
  });

  describe('normalizeThresholds', () => {
    it('falls back to the default milestones when omitted', () => {
      expect(service.normalizeThresholds()).toEqual([50, 100]);
      expect(service.normalizeThresholds(undefined)).toEqual([50, 100]);
    });

    it('de-duplicates and sorts ascending', () => {
      expect(service.normalizeThresholds([100, 25, 50, 25])).toEqual([
        25, 50, 100,
      ]);
    });

    it('accepts an explicit empty list (no funding alerts)', () => {
      expect(service.normalizeThresholds([])).toEqual([]);
    });

    it.each([[0], [101], [-5], [12.5], [NaN]])('rejects %p', (value) => {
      expect(() => service.normalizeThresholds([value])).toThrow(
        BadRequestException,
      );
    });

    it('rejects more thresholds than the cap', () => {
      expect(() =>
        service.normalizeThresholds([1, 2, 3, 4, 5, 6, 7, 8, 9]),
      ).toThrow(BadRequestException);
    });
  });

  describe('add', () => {
    const addDefault = async () => {
      const result = await service.add(USER_ID, { deal_id: DEAL_ID });
      return { item: result.item, isNew: result.created };
    };

    it('404s for an unknown deal', async () => {
      await expect(
        service.add(USER_ID, { deal_id: 'missing-deal' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses to watch an unpublished draft', async () => {
      dealRepo.findOne.mockResolvedValue(deal({ status: 'draft' as any }));
      await expect(service.add(USER_ID, { deal_id: DEAL_ID })).rejects.toThrow(
        BadRequestException,
      );
      expect(watchlistRepo.save).not.toHaveBeenCalled();
    });

    it('seeds the alert watermarks from the deal as it is today', async () => {
      const { item: created, isNew } = await addDefault();
      expect(isNew).toBe(true);
      // 3000 of 5000 is 60% funded, so the 50% milestone is already history.
      expect(created.alerted_pct).toBe(60);
      expect(created.alerted_status).toBe('open');
      expect(watchlistRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          dealId: DEAL_ID,
          notifyFundingPct: [50, 100],
          notifyStatusChange: true,
          alertedPct: 60,
          alertedStatus: 'open',
        }),
      );
    });

    it('stores the caller thresholds and honours notify_status_change=false', async () => {
      await service.add(USER_ID, {
        deal_id: DEAL_ID,
        notify_funding_pct: [75, 90, 100],
        notify_status_change: false,
      });
      expect(watchlistRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          notifyFundingPct: [75, 90, 100],
          notifyStatusChange: false,
        }),
      );
    });

    it('is idempotent and leaves the existing watermarks alone', async () => {
      watchlistRepo.findOne.mockResolvedValue(item());
      const { item: existing, isNew } = await addDefault();
      expect(isNew).toBe(false);
      expect(existing.alerted_pct).toBe(60);
      expect(watchlistRepo.create).not.toHaveBeenCalled();
      expect(watchlistRepo.save).not.toHaveBeenCalled();
    });

    it('caps the seeded watermark at 100 for an overfunded deal', async () => {
      dealRepo.findOne.mockResolvedValue(
        deal({ totalInvested: 6000 as any, status: 'funded' as any }),
      );
      const { item: created } = await service.add(USER_ID, {
        deal_id: DEAL_ID,
      });
      expect(created.alerted_pct).toBe(100);
    });
  });

  describe('update', () => {
    it('404s when the deal is not on the watchlist', async () => {
      await expect(
        service.update(USER_ID, DEAL_ID, { notify_funding_pct: [80] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('requires at least one field', async () => {
      watchlistRepo.findOne.mockResolvedValue(item());
      await expect(service.update(USER_ID, DEAL_ID, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('replaces thresholds without rewinding the watermark', async () => {
      watchlistRepo.findOne.mockResolvedValue(item());
      const updated = await service.update(USER_ID, DEAL_ID, {
        notify_funding_pct: [25, 50, 100],
      });
      expect(updated.notify_funding_pct).toEqual([25, 50, 100]);
      expect(watchlistRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ alertedPct: 60 }),
      );
    });

    it('toggles status notifications', async () => {
      watchlistRepo.findOne.mockResolvedValue(item());
      const updated = await service.update(USER_ID, DEAL_ID, {
        notify_status_change: false,
      });
      expect(updated.notify_status_change).toBe(false);
    });
  });

  describe('remove', () => {
    it('404s when nothing is watched', async () => {
      await expect(service.remove(USER_ID, DEAL_ID)).rejects.toThrow(
        NotFoundException,
      );
      expect(watchlistRepo.remove).not.toHaveBeenCalled();
    });

    it('removes the row', async () => {
      const existing = item();
      watchlistRepo.findOne.mockResolvedValue(existing);
      await service.remove(USER_ID, DEAL_ID);
      expect(watchlistRepo.remove).toHaveBeenCalledWith(existing);
    });
  });

  describe('list', () => {
    it('returns an empty list without touching the deal table', async () => {
      watchlistRepo.find.mockResolvedValue([]);
      await expect(service.list(USER_ID)).resolves.toEqual([]);
      expect(dealRepo.find).not.toHaveBeenCalled();
    });

    it('joins a whitelisted deal summary and never leaks escrow keys', async () => {
      watchlistRepo.find.mockResolvedValue([item()]);
      dealRepo.find.mockResolvedValue([deal()]);
      const [entry] = await service.list(USER_ID);

      expect(entry.deal).toEqual({
        id: DEAL_ID,
        title: 'Cocoa harvest',
        commodity: 'Cocoa',
        country: 'Nigeria',
        status: 'open',
        token_symbol: 'COCOA24',
        total_value: 5000,
        total_invested: 3000,
        funded_pct: 60,
        expected_roi: 12,
        delivery_date: new Date('2026-12-01'),
      });
      expect(JSON.stringify(entry)).not.toContain('SSECRET');
    });

    it('keeps the entry when the deal row is gone', async () => {
      watchlistRepo.find.mockResolvedValue([item()]);
      dealRepo.find.mockResolvedValue([]);
      const [entry] = await service.list(USER_ID);
      expect(entry.deal).toBeNull();
      expect(entry.deal_id).toBe(DEAL_ID);
    });
  });

  describe('watchedDealIds', () => {
    it('skips the query when there are no ids to check', async () => {
      await expect(service.watchedDealIds(USER_ID, [])).resolves.toEqual(
        new Set(),
      );
      expect(watchlistRepo.find).not.toHaveBeenCalled();
    });

    it('returns the starred subset', async () => {
      watchlistRepo.find.mockResolvedValue([{ dealId: 'a' }, { dealId: 'c' }]);
      const watched = await service.watchedDealIds(USER_ID, ['a', 'b', 'c']);
      expect(watched).toEqual(new Set(['a', 'c']));
    });
  });
});
