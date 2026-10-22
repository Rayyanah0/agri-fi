import {
  calculatePortfolioVaR,
  getHorizonReturns,
} from './portfolio-var.calculator';

describe('portfolio VaR calculator', () => {
  it('calculates historical VaR and expected shortfall at the requested confidence', () => {
    const result = calculatePortfolioVaR([-0.1, 0.02, -0.05, 0.01], {
      confidenceLevel: 0.75,
      horizonDays: 1,
      method: 'historical',
      portfolioValueUsd: 1000,
    });

    expect(result.varUsd).toBeCloseTo(50);
    expect(result.expectedShortfallUsd).toBeCloseTo(75);
    expect(result.horizonSampleCount).toBe(4);
  });

  it('compounds returns over overlapping horizons', () => {
    const horizonReturns = getHorizonReturns([0.1, -0.1, 0.05], 2);
    expect(horizonReturns[0]).toBeCloseTo(-0.01);
    expect(horizonReturns[1]).toBeCloseTo(-0.055);
  });

  it('supports parametric and reproducible Monte Carlo calculations', () => {
    const returns = [-0.03, -0.01, 0.005, 0.01, 0.02];
    const parametric = calculatePortfolioVaR(returns, {
      confidenceLevel: 0.99,
      horizonDays: 10,
      method: 'parametric',
      portfolioValueUsd: 5000,
    });
    const monteCarloOptions = {
      confidenceLevel: 0.95,
      horizonDays: 1,
      method: 'monte_carlo' as const,
      portfolioValueUsd: 5000,
      simulations: 2000,
    };

    expect(parametric.varUsd).toBeGreaterThan(0);
    expect(parametric.expectedShortfallUsd).toBeGreaterThanOrEqual(
      parametric.varUsd,
    );
    expect(calculatePortfolioVaR(returns, monteCarloOptions)).toEqual(
      calculatePortfolioVaR(returns, monteCarloOptions),
    );
  });

  it('supports a 30-day historical horizon', () => {
    const returns = Array.from({ length: 60 }, (_, index) =>
      index % 2 === 0 ? -0.01 : 0.005,
    );
    const result = calculatePortfolioVaR(returns, {
      confidenceLevel: 0.999,
      horizonDays: 30,
      method: 'historical',
      portfolioValueUsd: 10_000,
    });

    expect(result.horizonSampleCount).toBe(31);
    expect(result.varUsd).toBeGreaterThanOrEqual(0);
    expect(result.expectedShortfallUsd).toBeGreaterThanOrEqual(result.varUsd);
  });

  it('rejects invalid confidence levels and insufficient historical horizons', () => {
    expect(() =>
      calculatePortfolioVaR([-0.01], {
        confidenceLevel: 1,
        horizonDays: 1,
        method: 'historical',
        portfolioValueUsd: 100,
      }),
    ).toThrow('confidenceLevel');
    expect(() =>
      calculatePortfolioVaR([-0.01], {
        confidenceLevel: 0.95,
        horizonDays: 2,
        method: 'historical',
        portfolioValueUsd: 100,
      }),
    ).toThrow('not enough observations');
  });
});
