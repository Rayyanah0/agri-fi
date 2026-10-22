import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthGuard } from '@nestjs/passport';
import { WatchlistController } from './watchlist.controller';
import { WatchlistService } from './watchlist.service';

const USER_ID = 'investor-uuid';
const DEAL_ID = 'deal-uuid';

const entry = {
  id: 'watchlist-uuid',
  deal_id: DEAL_ID,
  notify_funding_pct: [50, 100],
  notify_status_change: true,
  alerted_pct: 60,
  alerted_status: 'open',
  created_at: new Date('2026-10-01T00:00:00.000Z'),
  deal: null,
};

describe('WatchlistController', () => {
  const service = {
    list: jest.fn(),
    add: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  let controller: WatchlistController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new WatchlistController(
      service as unknown as WatchlistService,
    );
  });

  it('requires a JWT on every route', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      WatchlistController,
    ) as unknown[];
    expect(guards).toContain(AuthGuard('jwt'));
  });

  it('lists the caller watchlist', async () => {
    service.list.mockResolvedValue([entry]);
    await expect(controller.list(USER_ID)).resolves.toEqual([entry]);
    expect(service.list).toHaveBeenCalledWith(USER_ID);
  });

  it('reports whether starring created a new row', async () => {
    service.add.mockResolvedValue({ item: entry, created: true });
    await expect(
      controller.add(USER_ID, { deal_id: DEAL_ID, notify_funding_pct: [75] }),
    ).resolves.toEqual({ created: true, item: entry });
    expect(service.add).toHaveBeenCalledWith(USER_ID, {
      deal_id: DEAL_ID,
      notify_funding_pct: [75],
    });
  });

  it('updates thresholds for one deal', async () => {
    service.update.mockResolvedValue(entry);
    await expect(
      controller.update(USER_ID, DEAL_ID, { notify_status_change: false }),
    ).resolves.toEqual(entry);
    expect(service.update).toHaveBeenCalledWith(USER_ID, DEAL_ID, {
      notify_status_change: false,
    });
  });

  it('unstars a deal', async () => {
    service.remove.mockResolvedValue(undefined);
    await expect(controller.remove(USER_ID, DEAL_ID)).resolves.toBeUndefined();
    expect(service.remove).toHaveBeenCalledWith(USER_ID, DEAL_ID);
  });
});
