import { PortfolioSummaryService } from './portfolio-summary.service';
import { Investment, InvestmentStatus } from './entities/investment.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { PaymentDistribution } from '../escrow/entities/payment-distribution.entity';

interface DealSeed {
  id: string;
  title?: string;
  tokenSymbol?: string | null;
  commodity?: string | null;
  status?: string;
  tokenCount?: number;
  totalValue?: number;
}

function deal(seed: DealSeed): TradeDeal {
  return {
    id: seed.id,
    title: seed.title ?? `Deal ${seed.id}`,
    tokenSymbol: seed.tokenSymbol ?? 'COCOA',
    commodity: seed.commodity ?? 'Cocoa',
    status: seed.status ?? 'funded',
    tokenCount: seed.tokenCount ?? 100,
    totalValue: seed.totalValue ?? 1200,
  } as unknown as TradeDeal;
}

function position(
  dealId: string,
  amountUsd: number | string,
  tokenAmount: number,
  status: InvestmentStatus = InvestmentStatus.CONFIRMED,
  tradeDeal?: TradeDeal | null,
): Investment {
  return {
    id: `inv-${dealId}-${tokenAmount}`,
    investorId: 'investor-1',
    tradeDealId: dealId,
    amountUsd,
    tokenAmount,
    status,
    tradeDeal:
      tradeDeal === undefined ? deal({ id: dealId }) : (tradeDeal ?? null),
  } as unknown as Investment;
}

function build(
  positions: Investment[],
  distributions: Partial<PaymentDistribution>[] = [],
) {
  const investmentRepo = {
    find: jest.fn(async () => positions),
  };
  const distributionRepo = { find: jest.fn(async () => distributions) };
  const dataSource = {
    getRepository: jest.fn(() => distributionRepo),
  };
  const service = new PortfolioSummaryService(
    investmentRepo as unknown as never,
    dataSource as unknown as never,
  );
  return { service, investmentRepo, distributionRepo, dataSource };
}

describe('PortfolioSummaryService', () => {
  describe('empty portfolio', () => {
    it('reports zeros without dividing by an empty invested total', async () => {
      const { service, dataSource } = build([]);
      const summary = await service.getSummary('investor-1');

      expect(summary).toMatchObject({
        investor_id: 'investor-1',
        currency: 'USD',
        total_invested: 0,
        current_value: 0,
        expected_returns: 0,
        returns_paid: 0,
        roi_pct: 0,
        active_deal_count: 0,
        invested_deal_count: 0,
        position_count: 0,
        allocation: [],
      });
      // No deals means there is nothing to look payouts up for.
      expect(dataSource.getRepository).not.toHaveBeenCalled();
    });
  });

  describe('totals', () => {
    it('values a position as its pro-rata claim on the deal', async () => {
      // 25 of 100 tokens of a deal worth 1200 => a 300 claim on 1000 invested.
      const { service } = build([position('deal-1', 1000, 25)]);
      const summary = await service.getSummary('investor-1');

      expect(summary.total_invested).toBe(1000);
      expect(summary.expected_returns).toBe(300);
      expect(summary.current_value).toBe(300);
      expect(summary.roi_pct).toBe(-70);
      expect(summary.returns_paid).toBe(0);
    });

    it('sums every position an investor holds in one deal', async () => {
      const { service } = build([
        position('deal-1', 1000, 25),
        position('deal-1', 500, 12.5),
      ]);
      const summary = await service.getSummary('investor-1');

      expect(summary.total_invested).toBe(1500);
      expect(summary.expected_returns).toBe(450);
      expect(summary.invested_deal_count).toBe(1);
      expect(summary.position_count).toBe(2);
      expect(summary.allocation).toHaveLength(1);
      expect(summary.allocation[0]).toMatchObject({
        deal_id: 'deal-1',
        amount_usd: 1500,
        share_pct: 100,
        position_count: 2,
      });
    });

    it('counts only open positions as active deals', async () => {
      const { service } = build([
        position('deal-1', 100, 10, InvestmentStatus.PENDING),
        position('deal-2', 100, 10, InvestmentStatus.COMPLETED),
        position('deal-3', 100, 10, InvestmentStatus.RELEASING),
      ]);
      const summary = await service.getSummary('investor-1');

      expect(summary.active_deal_count).toBe(2);
      expect(summary.invested_deal_count).toBe(3);
    });

    it('reads decimal columns delivered as strings', async () => {
      const { service } = build([position('deal-1', '1000.5', 50)]);
      const summary = await service.getSummary('investor-1');

      expect(summary.total_invested).toBe(1000.5);
      expect(summary.expected_returns).toBe(600);
    });

    it('ignores non-numeric amounts instead of poisoning the totals', async () => {
      const { service } = build([
        position('deal-1', 'not-a-number', 10),
        position('deal-2', 200, 10),
      ]);
      const summary = await service.getSummary('investor-1');

      expect(summary.total_invested).toBe(200);
      expect(Number.isFinite(summary.roi_pct)).toBe(true);
    });
  });

  describe('realised payouts', () => {
    it('replaces the expected claim with what was actually paid', async () => {
      const { service } = build(
        [position('deal-1', 1000, 50, InvestmentStatus.COMPLETED)],
        [{ tradeDealId: 'deal-1', amountUsd: 1150, status: 'confirmed' }],
      );
      const summary = await service.getSummary('investor-1');

      expect(summary.returns_paid).toBe(1150);
      expect(summary.current_value).toBe(1150);
      expect(summary.roi_pct).toBe(15);
      expect(summary.allocation[0].realized_return_usd).toBe(1150);
      expect(summary.allocation[0].expected_return_usd).toBe(600);
    });

    it('sums several payouts of the same deal', async () => {
      const { service } = build(
        [position('deal-1', 1000, 50, InvestmentStatus.COMPLETED)],
        [
          { tradeDealId: 'deal-1', amountUsd: 600 },
          { tradeDealId: 'deal-1', amountUsd: 550 },
        ],
      );
      const summary = await service.getSummary('investor-1');

      expect(summary.returns_paid).toBe(1150);
    });

    it('keeps expecting a payout while the deal has not paid', async () => {
      const { service } = build(
        [position('deal-1', 1000, 50)],
        [{ tradeDealId: 'other-deal', amountUsd: 999 }],
      );
      const summary = await service.getSummary('investor-1');

      expect(summary.returns_paid).toBe(0);
      expect(summary.current_value).toBe(600);
      expect(summary.allocation[0].realized_return_usd).toBeNull();
    });

    it('asks for payouts scoped to this investor', async () => {
      const { service, distributionRepo } = build(
        [position('deal-1', 1000, 50)],
        [],
      );
      await service.getSummary('investor-1');

      const options = distributionRepo.find.mock.calls[0][0];
      expect(options.where.recipientId).toBe('investor-1');
      expect(options.where.recipientType).toBe('investor');
      expect(options.where.status).toBe('confirmed');
    });
  });

  describe('per-deal allocation', () => {
    it('orders slices by capital and shares out of the total', async () => {
      const { service } = build([
        position('deal-1', 250, 10),
        position(
          'deal-2',
          750,
          10,
          InvestmentStatus.CONFIRMED,
          deal({ id: 'deal-2', title: 'Coffee' }),
        ),
      ]);
      const summary = await service.getSummary('investor-1');

      expect(summary.allocation.map((slice) => slice.deal_id)).toEqual([
        'deal-2',
        'deal-1',
      ]);
      expect(summary.allocation.map((slice) => slice.share_pct)).toEqual([
        75, 25,
      ]);
      expect(summary.allocation[0].title).toBe('Coffee');
    });

    it('reports a removed deal as capital with no claim', async () => {
      const { service } = build([
        position('deal-1', 400, 10, InvestmentStatus.CONFIRMED, null),
      ]);
      const summary = await service.getSummary('investor-1');

      expect(summary.total_invested).toBe(400);
      expect(summary.expected_returns).toBe(0);
      expect(summary.allocation[0]).toMatchObject({
        deal_id: 'deal-1',
        title: 'Removed deal',
        deal_status: null,
        expected_return_usd: 0,
      });
      // Valued at the capital left in it, not at zero.
      expect(summary.current_value).toBe(400);
    });

    it('guards against a deal with no tokens or no value', async () => {
      const { service } = build([
        position(
          'deal-1',
          100,
          10,
          InvestmentStatus.CONFIRMED,
          deal({ id: 'deal-1', tokenCount: 0 }),
        ),
        position(
          'deal-2',
          100,
          10,
          InvestmentStatus.CONFIRMED,
          deal({ id: 'deal-2', totalValue: 0 }),
        ),
      ]);
      const summary = await service.getSummary('investor-1');

      expect(summary.expected_returns).toBe(0);
      expect(summary.current_value).toBe(200);
      expect(summary.roi_pct).toBe(0);
    });
  });

  describe('query scoping', () => {
    it('loads only the statuses that carry committed capital', async () => {
      const { service, investmentRepo } = build([]);
      await service.getSummary('investor-1');

      const options = investmentRepo.find.mock.calls[0][0];
      const statuses = options.where.map(
        (clause: { status: InvestmentStatus }) => clause.status,
      );
      expect(statuses).toEqual([
        InvestmentStatus.PENDING,
        InvestmentStatus.CONFIRMED,
        InvestmentStatus.ACTIVE,
        InvestmentStatus.RELEASING,
        InvestmentStatus.COMPLETED,
      ]);
      expect(
        options.where.every(
          (clause: { investorId: string }) =>
            clause.investorId === 'investor-1',
        ),
      ).toBe(true);
      expect(options.relations).toEqual(['tradeDeal']);
    });
  });
});
