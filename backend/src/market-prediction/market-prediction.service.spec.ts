import { MarketPredictionService } from './market-prediction.service';
import type { MarketSignal } from './market-prediction.service';

const logger = { setContext: () => {}, info: () => {}, warn: () => {}, error: () => {} } as any;

const NOW = new Date('2024-07-15T12:00:00Z'); // July — mid-year

describe('MarketPredictionService (#1199)', () => {
  let service: MarketPredictionService;

  beforeEach(() => {
    service = new MarketPredictionService(logger);
  });

  it('returns a forecast bundle with all three horizons', () => {
    const bundle = service.forecastCommodity('cocoa', [], NOW);
    expect(bundle.commodity).toBe('cocoa');
    expect(bundle.forecasts['1w']).toBeDefined();
    expect(bundle.forecasts['1m']).toBeDefined();
    expect(bundle.forecasts['3m']).toBeDefined();
  });

  it('forecast price is within lower and upper bounds', () => {
    for (const commodity of ['cocoa', 'coffee', 'wheat', 'maize', 'rice'] as const) {
      const bundle = service.forecastCommodity(commodity, [], NOW);
      for (const forecast of Object.values(bundle.forecasts)) {
        expect(forecast.forecastPriceUsd).toBeGreaterThanOrEqual(forecast.lowerBoundUsd);
        expect(forecast.forecastPriceUsd).toBeLessThanOrEqual(forecast.upperBoundUsd);
      }
    }
  });

  it('confidence decreases for longer horizons', () => {
    const bundle = service.forecastCommodity('wheat', [], NOW);
    expect(bundle.forecasts['1w'].confidencePct)
      .toBeGreaterThan(bundle.forecasts['1m'].confidencePct);
    expect(bundle.forecasts['1m'].confidencePct)
      .toBeGreaterThan(bundle.forecasts['3m'].confidencePct);
  });

  it('positive signal pushes forecast price above baseline', () => {
    const signals: MarketSignal[] = [
      { name: 'drought', value: 0.8, description: 'Severe drought in growing region' },
    ];
    const withSignal = service.computeForecast('maize', '1m', signals, NOW);
    const withoutSignal = service.computeForecast('maize', '1m', [], NOW);
    expect(withSignal.forecastPriceUsd).toBeGreaterThan(withoutSignal.forecastPriceUsd);
  });

  it('negative signal pushes forecast price below baseline', () => {
    const signals: MarketSignal[] = [
      { name: 'bumper_harvest', value: -0.7, description: 'Record harvest expected' },
    ];
    const withSignal = service.computeForecast('rice', '1m', signals, NOW);
    const withoutSignal = service.computeForecast('rice', '1m', [], NOW);
    expect(withSignal.forecastPriceUsd).toBeLessThan(withoutSignal.forecastPriceUsd);
  });

  it('topDrivers includes seasonal_pattern entry', () => {
    const forecast = service.computeForecast('coffee', '1w', [], NOW);
    const seasonal = forecast.topDrivers.find((d) => d.name === 'seasonal_pattern');
    expect(seasonal).toBeDefined();
  });

  it('forecastAll returns a bundle per commodity', () => {
    const bundles = service.forecastAll({}, NOW);
    const commodities = bundles.map((b) => b.commodity);
    expect(commodities).toContain('cocoa');
    expect(commodities).toContain('wheat');
    expect(commodities).toContain('rice');
  });

  it('changePct is consistent with direction field', () => {
    const bundle = service.forecastCommodity('cocoa', [], NOW);
    for (const forecast of Object.values(bundle.forecasts)) {
      if (forecast.changePct > 0.5) expect(forecast.changeDirection).toBe('up');
      if (forecast.changePct < -0.5) expect(forecast.changeDirection).toBe('down');
    }
  });
});
