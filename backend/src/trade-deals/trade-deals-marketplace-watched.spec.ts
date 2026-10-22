import { In } from 'typeorm';
import { TradeDealsService } from './trade-deals.service';

const deals = [
  { id: 'deal-1', totalValue: 100, totalInvested: 50 },
  { id: 'deal-2', totalValue: 100, totalInvested: 10 },
];

/** Every chainable SelectQueryBuilder method returns the builder again. */
function stubQueryBuilder(rows: any[]) {
  const qb: any = new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === 'getManyAndCount') {
          return async () => [rows, rows.length];
        }
        return () => qb;
      },
    },
  );
  return qb;
}

function buildService(rows: { dealId: string }[], listed: any[] = deals) {
  const watchlistRepo = { find: jest.fn(async (_options: any) => rows) };
  const service = new TradeDealsService(
    {
      createQueryBuilder: jest.fn(() => stubQueryBuilder(listed)),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    undefined,
    { setContext: jest.fn(), log: jest.fn() } as any,
    {} as any,
    watchlistRepo as any,
  );
  return { service, watchlistRepo };
}

describe('TradeDealsService.findOpen watchlist flag (#1003)', () => {
  it('marks the rows the signed-in viewer starred', async () => {
    const { service, watchlistRepo } = buildService([{ dealId: 'deal-1' }]);
    const result = await service.findOpen({ viewerId: 'investor-1' });

    expect(result.data.map((deal: any) => deal.watched)).toEqual([true, false]);
    const options = watchlistRepo.find.mock.calls[0][0];
    expect(options.where.userId).toBe('investor-1');
    expect(options.where.dealId).toEqual(In(['deal-1', 'deal-2']));
  });

  it('does not read the watchlist for anonymous callers', async () => {
    const { service, watchlistRepo } = buildService([{ dealId: 'deal-1' }]);
    const result = await service.findOpen({});

    expect(result.data.map((deal: any) => deal.watched)).toEqual([
      false,
      false,
    ]);
    expect(watchlistRepo.find).not.toHaveBeenCalled();
  });

  it('skips the lookup when the page has no deals', async () => {
    const { service, watchlistRepo } = buildService([], []);
    await service.findOpen({ viewerId: 'investor-1' });
    expect(watchlistRepo.find).not.toHaveBeenCalled();
  });

  it('serves unstarred rows when the watchlist table is not wired', async () => {
    const service = new TradeDealsService(
      {
        createQueryBuilder: jest.fn(() => stubQueryBuilder(deals)),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      undefined,
      { setContext: jest.fn(), log: jest.fn() } as any,
      {} as any,
    );

    const result = await service.findOpen({ viewerId: 'investor-1' });
    expect(result.data.map((deal: any) => deal.watched)).toEqual([
      false,
      false,
    ]);
  });
});
