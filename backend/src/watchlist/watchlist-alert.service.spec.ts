import { WatchlistItem } from './entities/watchlist-item.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { WatchlistAlertService } from './watchlist-alert.service';
import { NotificationsService } from '../notifications/notifications.service';

const USER_ID = 'investor-uuid';
const DEAL_ID = 'deal-uuid';

function stubRepo(rows: Partial<WatchlistItem>[] = []) {
  const items = rows.map((row) => ({ ...row }));
  return {
    find: jest.fn(async () => items),
    save: jest.fn(async (value: WatchlistItem) => value),
  };
}

const deal = (overrides: Partial<TradeDeal> = {}): TradeDeal =>
  ({
    id: DEAL_ID,
    commodity: 'Cocoa',
    tokenSymbol: 'COCOA24',
    status: 'open',
    totalValue: 5000,
    totalInvested: 3000,
    ...overrides,
  }) as TradeDeal;

const item = (overrides: Partial<WatchlistItem> = {}): WatchlistItem =>
  ({
    id: 'watchlist-uuid',
    userId: USER_ID,
    dealId: DEAL_ID,
    notifyFundingPct: [50, 100],
    notifyStatusChange: true,
    alertedPct: 0,
    alertedStatus: 'open',
    ...overrides,
  }) as WatchlistItem;

describe('WatchlistAlertService', () => {
  let notifications: { createNotification: jest.Mock };
  let watchlistRepo: ReturnType<typeof stubRepo>;
  let dealRepo: { find: jest.Mock };
  let service: WatchlistAlertService;

  const build = (items: Partial<WatchlistItem>[], deals: TradeDeal[]) => {
    watchlistRepo = stubRepo(items as WatchlistItem[]);
    dealRepo = { find: jest.fn(async () => deals) };
    service = new WatchlistAlertService(
      watchlistRepo as any,
      dealRepo as any,
      notifications as unknown as NotificationsService,
    );
  };

  beforeEach(() => {
    notifications = {
      createNotification: jest.fn(async (params: any) => params),
    };
  });

  describe('funding thresholds', () => {
    it('alerts once per watcher and stores the watermark', async () => {
      build([item()], [deal()]); // 3000 / 5000 = 60%

      const result = await service.scanWatchlistedDeals();

      expect(result.fundingAlerts).toBe(1);
      expect(notifications.createNotification).toHaveBeenCalledWith({
        userId: USER_ID,
        type: 'deal',
        title: 'COCOA24 is 50% funded',
        message:
          'COCOA24 has reached 50% of its funding target: $3,000.00 of $5,000.00 raised.',
        linkUrl: `/marketplace/${DEAL_ID}`,
        metadataJson: {
          alertType: 'watchlist_funding',
          dealId: DEAL_ID,
          thresholds: [50],
          fundedPct: 60,
          watchlistItemId: 'watchlist-uuid',
        },
      });
      expect(watchlistRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ alertedPct: 50 }),
      );
    });

    it('sends nothing on the next pass over the same state', async () => {
      build([item({ alertedPct: 50 })], [deal()]);
      const result = await service.scanWatchlistedDeals();
      expect(result.fundingAlerts).toBe(0);
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('collapses several milestones crossed at once into one alert', async () => {
      build(
        [item({ notifyFundingPct: [25, 50, 75, 100] })],
        [deal({ totalInvested: 5000 })],
      );

      const result = await service.scanWatchlistedDeals();

      expect(result.fundingAlerts).toBe(1);
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'COCOA24 is 100% funded' }),
      );
      expect(
        notifications.createNotification.mock.calls[0][0].metadataJson,
      ).toEqual(
        expect.objectContaining({
          thresholds: [25, 50, 75, 100],
          fundedPct: 100,
        }),
      );
    });

    it('stays quiet while funding is below the lowest threshold', async () => {
      build([item()], [deal({ totalInvested: 500 })]); // 10%
      const result = await service.scanWatchlistedDeals();
      expect(result.fundingAlerts).toBe(0);
      expect(watchlistRepo.save).not.toHaveBeenCalled();
    });

    it('never alerts a deal with no funding target', async () => {
      build([item()], [deal({ totalValue: 0 })]);
      await expect(service.scanWatchlistedDeals()).resolves.toMatchObject({
        fundingAlerts: 0,
      });
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('notifies every watcher of the deal separately', async () => {
      build(
        [
          item({ id: 'a', userId: 'investor-1' }),
          item({ id: 'b', userId: 'investor-2' }),
        ],
        [deal()],
      );
      const result = await service.scanWatchlistedDeals();
      expect(result.fundingAlerts).toBe(2);
      expect(notifications.createNotification).toHaveBeenCalledTimes(2);
    });

    it('leaves the threshold eligible when the notification cannot be stored', async () => {
      notifications.createNotification.mockRejectedValue(new Error('db down'));
      build([item()], [deal()]);

      const result = await service.scanWatchlistedDeals();

      expect(result.fundingAlerts).toBe(0);
      expect(watchlistRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('status changes', () => {
    it('alerts watchers when the deal moves on', async () => {
      build([item({ alertedStatus: 'open' })], [deal({ status: 'funded' })]);

      const result = await service.scanWatchlistedDeals();

      expect(result.statusAlerts).toBe(1);
      expect(notifications.createNotification).toHaveBeenCalledWith({
        userId: USER_ID,
        type: 'deal',
        title: 'COCOA24 is now fully funded',
        message: 'COCOA24 moved from open for investment to fully funded.',
        linkUrl: `/marketplace/${DEAL_ID}`,
        metadataJson: {
          alertType: 'watchlist_status',
          dealId: DEAL_ID,
          fromStatus: 'open',
          toStatus: 'funded',
          watchlistItemId: 'watchlist-uuid',
        },
      });
      expect(watchlistRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ alertedStatus: 'funded' }),
      );
    });

    it('does not repeat a status the watcher already saw', async () => {
      build([item({ alertedStatus: 'funded' })], [deal({ status: 'funded' })]);
      const result = await service.scanWatchlistedDeals();
      expect(result.statusAlerts).toBe(0);
    });

    it('respects notify_status_change = false', async () => {
      build(
        [
          item({
            notifyStatusChange: false,
            alertedStatus: 'open',
            alertedPct: 50,
          }),
        ],
        [deal({ status: 'funded' })],
      );
      const result = await service.scanWatchlistedDeals();
      expect(result.statusAlerts).toBe(0);
      expect(notifications.createNotification).not.toHaveBeenCalled();
      expect(watchlistRepo.save).not.toHaveBeenCalled();
    });

    it('learns the current status silently when nothing was recorded yet', async () => {
      build([item({ alertedStatus: null })], [deal({ status: 'completed' })]);

      const result = await service.scanWatchlistedDeals();

      expect(result.statusAlerts).toBe(0);
      expect(watchlistRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ alertedStatus: 'completed' }),
      );
    });

    it('falls back to the raw status when there is no friendly label', async () => {
      build(
        [item({ alertedStatus: 'open' })],
        [deal({ status: 'auction' as any })],
      );
      await service.scanWatchlistedDeals();
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'COCOA24 is now auction',
        }),
      );
    });
  });

  describe('pass behaviour', () => {
    it('does nothing when nobody has a watchlist', async () => {
      build([], []);
      await expect(service.scanWatchlistedDeals()).resolves.toEqual({
        fundingAlerts: 0,
        statusAlerts: 0,
        watched: 0,
      });
      expect(dealRepo.find).not.toHaveBeenCalled();
    });

    it('reads each watched deal once, whatever the number of watchers', async () => {
      build(
        [
          item({ id: 'a', userId: 'investor-1', alertedStatus: 'funded' }),
          item({ id: 'b', userId: 'investor-2', alertedStatus: 'funded' }),
          item({ id: 'c', userId: 'investor-3', dealId: 'deal-2' }),
        ],
        [deal(), deal({ id: 'deal-2', totalInvested: 1000 })],
      );

      await service.scanWatchlistedDeals();

      expect(dealRepo.find).toHaveBeenCalledTimes(1);
    });

    it('skips an item whose deal row is gone', async () => {
      build([item()], []);
      const result = await service.scanWatchlistedDeals();
      expect(result).toMatchObject({ fundingAlerts: 0, statusAlerts: 0 });
      expect(watchlistRepo.save).not.toHaveBeenCalled();
    });

    it('swallows a repository failure instead of rejecting the cron run', async () => {
      watchlistRepo = stubRepo([item()]);
      dealRepo = {
        find: jest.fn(async () => {
          throw new Error('timeout');
        }),
      };
      service = new WatchlistAlertService(
        watchlistRepo as any,
        dealRepo as any,
        notifications as unknown as NotificationsService,
      );

      await expect(service.scanWatchlistedDeals()).resolves.toMatchObject({
        fundingAlerts: 0,
        statusAlerts: 0,
      });
    });

    it('still advances watermarks when the notifications module is not wired', async () => {
      build([item()], [deal()]);
      const withoutNotifications = new WatchlistAlertService(
        watchlistRepo as any,
        dealRepo as any,
        undefined,
      );

      const result = await withoutNotifications.scanWatchlistedDeals();

      expect(result.fundingAlerts).toBe(1);
      expect(watchlistRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ alertedPct: 50 }),
      );
    });
  });

  describe('deal labelling', () => {
    it('uses the commodity when there is no token symbol', async () => {
      build([item()], [deal({ tokenSymbol: null as any })]);
      await service.scanWatchlistedDeals();
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'The Cocoa deal is 50% funded',
        }),
      );
    });
  });
});
