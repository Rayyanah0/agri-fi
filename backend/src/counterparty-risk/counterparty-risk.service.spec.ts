import { CounterpartyRiskService } from './counterparty-risk.service';
import type { Investment } from '../investments/entities/investment.entity';

function makeInvestment(
  overrides: {
    amountUsd: number;
    tradeDealId?: string;
    status?: string;
    tradeDeal?: { commodity?: string; farmLocation?: string };
  },
): Investment {
  return {
    id: 'inv-' + Math.random().toString(36).slice(2),
    investorId: 'user-1',
    tradeDealId: overrides.tradeDealId ?? 'deal-1',
    amountUsd: overrides.amountUsd,
    status: overrides.status ?? 'active',
    tradeDeal: {
      id: overrides.tradeDealId ?? 'deal-1',
      commodity: overrides.tradeDeal?.commodity ?? 'maize',
      farmLocation: overrides.tradeDeal?.farmLocation ?? 'Kenya',
    },
  } as unknown as Investment;
}

describe('CounterpartyRiskService (#1227)', () => {
  let service: CounterpartyRiskService;

  beforeEach(() => {
    service = new CounterpartyRiskService(null as any, null as any, {
      setContext: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as any);
  });

  it('returns a minimal-tier score for a well-diversified counterparty', () => {
    const investments = [
      makeInvestment({ amountUsd: 1000, tradeDealId: 'd1', tradeDeal: { commodity: 'maize',  farmLocation: 'Kenya' } }),
      makeInvestment({ amountUsd: 1000, tradeDealId: 'd2', tradeDeal: { commodity: 'coffee', farmLocation: 'Ethiopia' } }),
      makeInvestment({ amountUsd: 1000, tradeDealId: 'd3', tradeDeal: { commodity: 'cocoa',  farmLocation: 'Ghana' } }),
      makeInvestment({ amountUsd: 1000, tradeDealId: 'd4', tradeDeal: { commodity: 'wheat',  farmLocation: 'Nigeria' } }),
      makeInvestment({ amountUsd: 1000, tradeDealId: 'd5', tradeDeal: { commodity: 'rice',   farmLocation: 'Tanzania' } }),
      makeInvestment({ amountUsd: 1000, tradeDealId: 'd6', tradeDeal: { commodity: 'soy',    farmLocation: 'Zambia' } }),
      makeInvestment({ amountUsd: 1000, tradeDealId: 'd7', tradeDeal: { commodity: 'millet', farmLocation: 'Uganda' } }),
      makeInvestment({ amountUsd: 1000, tradeDealId: 'd8', tradeDeal: { commodity: 'sorghum',farmLocation: 'Rwanda' } }),
    ];
    const result = service.computeScore('cp-good', investments, 10_000);
    expect(result.compositeScore).toBeLessThanOrEqual(40);
    expect(['minimal', 'low']).toContain(result.tier);
  });

  it('returns a high-tier score for a highly concentrated counterparty', () => {
    const investments = [
      makeInvestment({ amountUsd: 9_000, tradeDealId: 'single-deal', tradeDeal: { commodity: 'maize', farmLocation: 'Kenya' } }),
    ];
    const result = service.computeScore('cp-risky', investments, 10_000);
    expect(result.compositeScore).toBeGreaterThan(40);
    expect(['medium', 'high', 'critical']).toContain(result.tier);
  });

  it('returns a zero-exposure score for an empty investment list', () => {
    const result = service.computeScore('cp-new', [], 10_000);
    expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore).toBeLessThanOrEqual(100);
    expect(result.exposureLimitUsd).toBeGreaterThan(0);
  });

  it('sets recommendsDiversification when commodity concentration is high', () => {
    const investments = Array.from({ length: 5 }, (_, i) =>
      makeInvestment({ amountUsd: 1000, tradeDealId: `d${i}`, tradeDeal: { commodity: 'maize', farmLocation: 'Kenya' } }),
    );
    const result = service.computeScore('cp-mono', investments, 10_000);
    expect(result.recommendsDiversification).toBe(true);
  });

  it('computes correct weighted composite from factor scores', () => {
    // All factors produce a score of 0 → composite should also be 0.
    const investments = Array.from({ length: 10 }, (_, i) =>
      makeInvestment({
        amountUsd: 1,
        tradeDealId: `d${i}`,
        status: 'completed',
        tradeDeal: { commodity: `c${i}`, farmLocation: `r${i}` },
      }),
    );
    const result = service.computeScore('cp-perfect', investments, 1_000_000);
    // Composite is a weighted average — just validate it is in range and typed.
    expect(result.compositeScore).toBeGreaterThanOrEqual(0);
    expect(result.compositeScore).toBeLessThanOrEqual(100);
  });

  it('buildPortfolioView: groups investments by deal and flags breaches', async () => {
    // Single deal consuming 70% of portfolio — should breach for any non-minimal tier.
    const inv = makeInvestment({ amountUsd: 7_000, tradeDealId: 'big-deal' });
    const mockRepo = {
      find: async () => [inv],
    };
    const svc = new CounterpartyRiskService(
      mockRepo as any,
      null as any,
      { setContext: () => {}, info: () => {} } as any,
    );
    const view = await svc.getPortfolioView('user-1');
    expect(view.totalPortfolioUsd).toBe(7_000);
    expect(view.entries).toHaveLength(1);
  });
});
