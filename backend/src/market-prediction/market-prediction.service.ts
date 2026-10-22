/**
 * MarketPredictionService (#1199)
 *
 * Rule-based commodity price forecasting for agricultural markets (cocoa,
 * coffee, wheat, maize, rice).  Produces 1-week, 1-month, and 3-month price
 * forecasts with confidence intervals and the top feature drivers behind each
 * prediction.  Designed to be extended with a real ML backend (Prophet, LSTM,
 * cloud AI) once historical training data and infrastructure are in place.
 *
 * Privacy / data note: no personal user data is stored or returned by this
 * service; inputs are commodity identifiers and market signals only.
 */

import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';

export type Commodity = 'cocoa' | 'coffee' | 'wheat' | 'maize' | 'rice';

export type ForecastHorizon = '1w' | '1m' | '3m';

export interface MarketSignal {
  name: string;
  value: number;       // normalised –1..+1; positive = upward price pressure
  description: string;
}

export interface PriceForecast {
  commodity: Commodity;
  horizon: ForecastHorizon;
  baselinePriceUsd: number;
  forecastPriceUsd: number;
  lowerBoundUsd: number;
  upperBoundUsd: number;
  confidencePct: number;       // 0–100
  changeDirection: 'up' | 'flat' | 'down';
  changePct: number;
  topDrivers: MarketSignal[];
  generatedAt: Date;
}

export interface CommodityForecastBundle {
  commodity: Commodity;
  forecasts: Record<ForecastHorizon, PriceForecast>;
}

// ── Baseline prices (USD per metric tonne, approximate 2024 averages) ────────

const BASELINE_PRICES_USD: Record<Commodity, number> = {
  cocoa:  7_800,
  coffee: 3_900,
  wheat:    230,
  maize:    180,
  rice:     430,
};

// ── Seasonal direction bias per commodity (month 0–11 → multiplier) ──────────

function seasonalBias(commodity: Commodity, month: number): number {
  const biases: Record<Commodity, number[]> = {
    cocoa:  [0.02, 0.01, -0.01, -0.02, -0.03, 0.00, 0.01, 0.02, 0.03, 0.02, 0.01, 0.00],
    coffee: [-0.01, 0.00, 0.01, 0.02, 0.03, 0.02, 0.01, -0.01, -0.02, -0.01, 0.00, 0.01],
    wheat:  [0.01, 0.01, 0.02, 0.03, 0.02, -0.01, -0.02, -0.03, -0.02, -0.01, 0.00, 0.01],
    maize:  [-0.01, 0.00, 0.01, 0.02, 0.03, 0.02, -0.01, -0.03, -0.02, -0.01, 0.00, 0.00],
    rice:   [0.00, 0.01, 0.02, 0.02, 0.01, -0.01, -0.02, -0.02, -0.01, 0.00, 0.01, 0.01],
  };
  return biases[commodity][month] ?? 0;
}

// ── Confidence widths per horizon ─────────────────────────────────────────────

const CONFIDENCE_SPREAD: Record<ForecastHorizon, number> = {
  '1w': 0.03,
  '1m': 0.07,
  '3m': 0.15,
};

const BASE_CONFIDENCE: Record<ForecastHorizon, number> = {
  '1w': 85,
  '1m': 70,
  '3m': 52,
};

@Injectable()
export class MarketPredictionService {
  constructor(private readonly logger: PinoLogger) {
    (this.logger as any).setContext(MarketPredictionService.name);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Returns price forecasts for all three horizons for a single commodity.
   * Accepts optional market signals to influence the prediction; without them
   * the service falls back to seasonal adjustments alone.
   */
  forecastCommodity(
    commodity: Commodity,
    signals: MarketSignal[] = [],
    now: Date = new Date(),
  ): CommodityForecastBundle {
    const forecasts = {
      '1w': this.computeForecast(commodity, '1w', signals, now),
      '1m': this.computeForecast(commodity, '1m', signals, now),
      '3m': this.computeForecast(commodity, '3m', signals, now),
    };
    return { commodity, forecasts };
  }

  /**
   * Returns forecasts for all supported commodities.
   */
  forecastAll(
    signals: Partial<Record<Commodity, MarketSignal[]>> = {},
    now: Date = new Date(),
  ): CommodityForecastBundle[] {
    const commodities: Commodity[] = ['cocoa', 'coffee', 'wheat', 'maize', 'rice'];
    return commodities.map((c) => this.forecastCommodity(c, signals[c] ?? [], now));
  }

  // ── Pure computation ────────────────────────────────────────────────────────

  computeForecast(
    commodity: Commodity,
    horizon: ForecastHorizon,
    signals: MarketSignal[],
    now: Date = new Date(),
  ): PriceForecast {
    const baseline = BASELINE_PRICES_USD[commodity];
    const month = now.getMonth();

    // Combine seasonal bias with external signals.
    const seasonal = seasonalBias(commodity, month);
    const signalImpact = signals.reduce((sum, s) => sum + s.value, 0) / Math.max(signals.length, 1);

    // Horizon multiplier: longer forecast amplifies directional bias.
    const horizonMultiplier: Record<ForecastHorizon, number> = { '1w': 0.3, '1m': 1.0, '3m': 2.5 };
    const totalBias = (seasonal + signalImpact * 0.05) * horizonMultiplier[horizon];

    const forecastPriceUsd = Math.max(1, baseline * (1 + totalBias));
    const spread = CONFIDENCE_SPREAD[horizon];
    const lowerBoundUsd = Math.max(1, forecastPriceUsd * (1 - spread));
    const upperBoundUsd = forecastPriceUsd * (1 + spread);
    const changePct = ((forecastPriceUsd - baseline) / baseline) * 100;
    const changeDirection: 'up' | 'flat' | 'down' =
      changePct > 0.5 ? 'up' : changePct < -0.5 ? 'down' : 'flat';

    // Top drivers: seasonal bias + up to 3 highest-impact signals.
    const topDrivers: MarketSignal[] = [
      {
        name: 'seasonal_pattern',
        value: seasonal,
        description: `Typical ${now.toLocaleString('default', { month: 'long' })} seasonal trend for ${commodity}`,
      },
      ...signals
        .slice()
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, 3),
    ];

    return {
      commodity,
      horizon,
      baselinePriceUsd: baseline,
      forecastPriceUsd: Math.round(forecastPriceUsd * 100) / 100,
      lowerBoundUsd: Math.round(lowerBoundUsd * 100) / 100,
      upperBoundUsd: Math.round(upperBoundUsd * 100) / 100,
      confidencePct: BASE_CONFIDENCE[horizon],
      changeDirection,
      changePct: Math.round(changePct * 100) / 100,
      topDrivers,
      generatedAt: now,
    };
  }
}
