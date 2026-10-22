import { ConcentrationRiskService } from './concentration-risk.service';
import { Investment, InvestmentStatus } from './entities/investment.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';

function makeInvestment(
  overrides: Partial<Investment> & {
    amountUsd: number;
    tradeDeal?: Partial<TradeDeal>;
  },
): Investment {
  const td = {
    id: overrides.tradeDealId ?? 'deal-1',
    commodity: 'maize',
    farmLocation: 'Kenya',
    title: 'Test Deal',
    ...overrides.tradeDeal,
  } as TradeDeal;

  return {
    id: 'inv-' + Math.random().toString(36).slice(2),
    investorId: 'user-1',
    tradeDealId: td.id,
    tradeDeal: td,
    status: InvestmentStatus.ACTIVE,
    tokenAmount: 100,
    amountUsd: overrides.amountUsd,
    ...overrides,
  } as unknown as Investment;
}

describe('ConcentrationRiskService', () => {
  let service: ConcentrationRiskService;

  beforeEach(() => {
    // No DB needed — we exercise the pure computeConcentration path.
    service = new ConcentrationRiskService(null as any);
  });

  it('returns an empty result for an empty portfolio', () => {
    const result = service.computeConcentration([]);
    expect(result.totalPortfolioUsd).toBe(0);
    expect(result.byCommodity).toHaveLength(0);
    expect(result.byRegion).toHaveLength(0);
    expect(result.byDeal).toHaveLength(0);
    expect(result.alerts).toHaveLength(0);
  });

  it('calculates correct weights for a two-commodity portfolio', () => {
    const investments = [
      makeInvestment({ amountUsd: 6000, tradeDeal: { commodity: 'maize', farmLocation: 'Kenya', title: 'Maize Deal', id: 'deal-1' }, tradeDealId: 'deal-1' }),
      makeInvestment({ amountUsd: 4000, tradeDeal: { commodity: 'cocoa', farmLocation: 'Ghana', title: 'Cocoa Deal', id: 'deal-2' }, tradeDealId: 'deal-2' }),
    ];

    const result = service.computeConcentration(investments);

    expect(result.totalPortfolioUsd).toBe(10000);

    const maize = result.byCommodity.find((b) => b.dimension === 'maize');
    expect(maize?.weight).toBeCloseTo(0.6);

    const cocoa = result.byCommodity.find((b) => b.dimension === 'cocoa');
    expect(cocoa?.weight).toBeCloseTo(0.4);
  });

  it('raises a commodity alert when weight exceeds the threshold', () => {
    const investments = [
      makeInvestment({ amountUsd: 8000, tradeDeal: { commodity: 'wheat', farmLocation: 'Egypt', id: 'deal-1' }, tradeDealId: 'deal-1' }),
      makeInvestment({ amountUsd: 2000, tradeDeal: { commodity: 'rice', farmLocation: 'Nigeria', id: 'deal-2' }, tradeDealId: 'deal-2' }),
    ];

    const result = service.computeConcentration(investments, { commodity: 0.4, region: 0.4, deal: 0.25 });

    const commodityAlerts = result.alerts.filter((a) => a.type === 'commodity');
    expect(commodityAlerts).toHaveLength(1);
    expect(commodityAlerts[0].label).toBe('wheat');
    expect(commodityAlerts[0].weight).toBeCloseTo(0.8);
  });

  it('raises a region alert when a single location dominates', () => {
    const investments = [
      makeInvestment({ amountUsd: 5000, tradeDeal: { commodity: 'maize', farmLocation: 'Kenya', id: 'deal-1' }, tradeDealId: 'deal-1' }),
      makeInvestment({ amountUsd: 5000, tradeDeal: { commodity: 'coffee', farmLocation: 'Kenya', id: 'deal-2' }, tradeDealId: 'deal-2' }),
    ];

    const result = service.computeConcentration(investments, { commodity: 0.4, region: 0.4, deal: 0.25 });

    const regionAlerts = result.alerts.filter((a) => a.type === 'region');
    expect(regionAlerts).toHaveLength(1);
    expect(regionAlerts[0].label).toBe('Kenya');
    expect(regionAlerts[0].weight).toBeCloseTo(1.0);
  });

  it('raises a deal alert when a single deal exceeds the per-deal threshold', () => {
    const investments = [
      makeInvestment({ amountUsd: 3000, tradeDeal: { commodity: 'maize', farmLocation: 'Kenya', title: 'Big Deal', id: 'deal-big' }, tradeDealId: 'deal-big' }),
      makeInvestment({ amountUsd: 1000, tradeDeal: { commodity: 'cocoa', farmLocation: 'Ghana', title: 'Small Deal', id: 'deal-small' }, tradeDealId: 'deal-small' }),
    ];

    const result = service.computeConcentration(investments, { commodity: 0.4, region: 0.4, deal: 0.25 });

    const dealAlerts = result.alerts.filter((a) => a.type === 'deal');
    expect(dealAlerts).toHaveLength(1);
    expect(dealAlerts[0].label).toBe('Big Deal');
  });

  it('aggregates multiple investments in the same deal', () => {
    const investments = [
      makeInvestment({ amountUsd: 3000, tradeDealId: 'deal-1', tradeDeal: { id: 'deal-1', commodity: 'maize', farmLocation: 'Kenya', title: 'Maize Deal' } }),
      makeInvestment({ amountUsd: 2000, tradeDealId: 'deal-1', tradeDeal: { id: 'deal-1', commodity: 'maize', farmLocation: 'Kenya', title: 'Maize Deal' } }),
      makeInvestment({ amountUsd: 5000, tradeDealId: 'deal-2', tradeDeal: { id: 'deal-2', commodity: 'cocoa', farmLocation: 'Ghana', title: 'Cocoa Deal' } }),
    ];

    const result = service.computeConcentration(investments);

    expect(result.totalPortfolioUsd).toBe(10000);

    const maize = result.byCommodity.find((b) => b.dimension === 'maize');
    expect(maize?.amountUsd).toBe(5000);
    expect(maize?.weight).toBeCloseTo(0.5);

    const deal1 = result.byDeal.find((b) => b.dimension === 'deal-1');
    expect(deal1?.amountUsd).toBe(5000);
  });

  it('produces no alerts for a well-diversified portfolio', () => {
    const investments = [
      makeInvestment({ amountUsd: 2500, tradeDealId: 'deal-1', tradeDeal: { id: 'deal-1', commodity: 'maize', farmLocation: 'Kenya', title: 'A' } }),
      makeInvestment({ amountUsd: 2500, tradeDealId: 'deal-2', tradeDeal: { id: 'deal-2', commodity: 'cocoa', farmLocation: 'Ghana', title: 'B' } }),
      makeInvestment({ amountUsd: 2500, tradeDealId: 'deal-3', tradeDeal: { id: 'deal-3', commodity: 'coffee', farmLocation: 'Ethiopia', title: 'C' } }),
      makeInvestment({ amountUsd: 2500, tradeDealId: 'deal-4', tradeDeal: { id: 'deal-4', commodity: 'wheat', farmLocation: 'Egypt', title: 'D' } }),
    ];

    const result = service.computeConcentration(investments, { commodity: 0.4, region: 0.4, deal: 0.25 });

    expect(result.alerts).toHaveLength(0);
  });

  it('sorts breakdowns by weight descending', () => {
    const investments = [
      makeInvestment({ amountUsd: 1000, tradeDealId: 'deal-1', tradeDeal: { id: 'deal-1', commodity: 'rice', farmLocation: 'Nigeria', title: 'Small' } }),
      makeInvestment({ amountUsd: 9000, tradeDealId: 'deal-2', tradeDeal: { id: 'deal-2', commodity: 'maize', farmLocation: 'Kenya', title: 'Large' } }),
    ];

    const result = service.computeConcentration(investments);

    expect(result.byCommodity[0].dimension).toBe('maize');
    expect(result.byDeal[0].dimension).toBe('deal-2');
  });

  it('handles missing tradeDeal gracefully by falling back to "unknown"', () => {
    const inv = {
      id: 'inv-orphan',
      investorId: 'user-1',
      tradeDealId: 'deal-gone',
      tradeDeal: null as any,
      status: InvestmentStatus.ACTIVE,
      tokenAmount: 10,
      amountUsd: 1000,
    } as unknown as Investment;

    const result = service.computeConcentration([inv]);

    expect(result.byCommodity[0].dimension).toBe('unknown');
    expect(result.byRegion[0].dimension).toBe('unknown');
  });
});
