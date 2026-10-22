# AI-Powered Market Prediction

_Issue #1199 — Backend: Implement AI-powered market prediction for agricultural commodity prices_

## Overview

The `MarketPredictionService` forecasts agricultural commodity prices for
cocoa, coffee, wheat, maize, and rice over three time horizons: 1 week, 1
month, and 3 months.

The current implementation uses a deterministic rule-based model combining
**seasonal bias tables** with **externally supplied market signals**.  It is
designed to be a drop-in for a real ML backend (Prophet, LSTM, or a cloud AI
service) once historical training data and infrastructure are available.

## Supported Commodities

`cocoa` · `coffee` · `wheat` · `maize` · `rice`

## Forecast Horizons

| Horizon | Confidence | Spread |
|---------|-----------|--------|
| 1 week  | 85%       | ±3%    |
| 1 month | 70%       | ±7%    |
| 3 months| 52%       | ±15%   |

## Market Signals

Callers can inject external signals to adjust forecasts:

```typescript
const signals: MarketSignal[] = [
  { name: 'drought',        value:  0.8, description: 'Severe drought in West Africa' },
  { name: 'bumper_harvest', value: -0.6, description: 'Record cocoa crop in Côte d\'Ivoire' },
];
const bundle = marketPredictionService.forecastCommodity('cocoa', signals);
```

`value` is a normalised float in `[-1, +1]`.  Positive values apply upward
price pressure; negative values push prices down.

## Output Structure

```typescript
interface PriceForecast {
  commodity: Commodity;
  horizon: ForecastHorizon;
  baselinePriceUsd: number;       // current reference price (USD/tonne)
  forecastPriceUsd: number;       // point estimate
  lowerBoundUsd: number;          // confidence interval lower bound
  upperBoundUsd: number;          // confidence interval upper bound
  confidencePct: number;          // 0–100
  changeDirection: 'up' | 'flat' | 'down';
  changePct: number;
  topDrivers: MarketSignal[];     // top factors behind this forecast
  generatedAt: Date;
}
```

## Roadmap to Real ML

1. **Data ingestion** — ingest historical CBOT/ICE prices, weather (NOAA/ECMWF),
   geopolitical event feeds, and supply chain delay data into a time-series
   store (TimescaleDB or InfluxDB).
2. **Model training** — train Prophet or LSTM models per commodity on 5+ years
   of data; expose via a FastAPI microservice.
3. **Feature importance** — use SHAP values to populate `topDrivers` with real
   feature attributions.
4. **Prediction accuracy tracking** — compare weekly point predictions to
   realised prices; expose via `GET /api/market-prediction/:commodity/accuracy`.
5. **Prediction alerts** — publish to the notifications queue when a forecast
   exceeds a ±5% threshold vs. the previous forecast.
