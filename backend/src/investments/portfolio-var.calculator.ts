export type VaRMethod = 'historical' | 'parametric' | 'monte_carlo';

export interface VaRCalculationOptions {
  confidenceLevel: number;
  horizonDays: number;
  method: VaRMethod;
  portfolioValueUsd: number;
  simulations?: number;
}

export interface VaRCalculation {
  varUsd: number;
  expectedShortfallUsd: number;
  sampleCount: number;
  horizonSampleCount: number;
}

export function getHorizonReturns(
  dailyReturns: readonly number[],
  horizonDays: number,
): number[] {
  if (!Number.isInteger(horizonDays) || horizonDays < 1) {
    throw new RangeError('horizonDays must be a positive integer');
  }

  const horizonReturns: number[] = [];
  for (let start = 0; start <= dailyReturns.length - horizonDays; start += 1) {
    let cumulativeReturn = 1;
    for (let offset = 0; offset < horizonDays; offset += 1) {
      const dailyReturn = dailyReturns[start + offset];
      if (!Number.isFinite(dailyReturn) || dailyReturn <= -1) {
        throw new RangeError(
          'daily returns must be finite and greater than -1',
        );
      }
      cumulativeReturn *= 1 + dailyReturn;
    }
    horizonReturns.push(cumulativeReturn - 1);
  }
  return horizonReturns;
}

export function calculatePortfolioVaR(
  dailyReturns: readonly number[],
  options: VaRCalculationOptions,
): VaRCalculation {
  const { confidenceLevel, horizonDays, method, portfolioValueUsd } = options;
  if (confidenceLevel <= 0 || confidenceLevel >= 1) {
    throw new RangeError('confidenceLevel must be between 0 and 1');
  }
  if (!Number.isFinite(portfolioValueUsd) || portfolioValueUsd < 0) {
    throw new RangeError(
      'portfolioValueUsd must be a non-negative finite number',
    );
  }
  if (dailyReturns.length === 0) {
    throw new RangeError('at least one daily return is required');
  }

  const horizonReturns = getHorizonReturns(dailyReturns, horizonDays);
  if (method === 'historical') {
    if (horizonReturns.length === 0) {
      throw new RangeError('not enough observations for the requested horizon');
    }
    const losses = horizonReturns.map((value) => -value * portfolioValueUsd);
    const varUsd = Math.max(0, quantile(losses, confidenceLevel));
    const tailLosses = losses.filter((loss) => loss >= varUsd);
    return {
      varUsd,
      expectedShortfallUsd: Math.max(0, average(tailLosses)),
      sampleCount: dailyReturns.length,
      horizonSampleCount: horizonReturns.length,
    };
  }

  const dailyMean = average(dailyReturns);
  const dailyDeviation = standardDeviation(dailyReturns, dailyMean);
  const horizonMean = dailyMean * horizonDays;
  const horizonDeviation = dailyDeviation * Math.sqrt(horizonDays);

  if (method === 'parametric') {
    const zScore = inverseNormalCdf(confidenceLevel);
    const varUsd = Math.max(
      0,
      portfolioValueUsd * (zScore * horizonDeviation - horizonMean),
    );
    const tailMeanLoss =
      portfolioValueUsd *
      ((horizonDeviation * normalPdf(zScore)) / (1 - confidenceLevel) -
        horizonMean);
    return {
      varUsd,
      expectedShortfallUsd: Math.max(0, tailMeanLoss),
      sampleCount: dailyReturns.length,
      horizonSampleCount: horizonReturns.length,
    };
  }

  if (method === 'monte_carlo') {
    const losses = simulateBootstrapLosses(
      dailyReturns,
      horizonDays,
      portfolioValueUsd,
      options.simulations ?? 10_000,
    );
    const varUsd = Math.max(0, quantile(losses, confidenceLevel));
    const tailLosses = losses.filter((loss) => loss >= varUsd);
    return {
      varUsd,
      expectedShortfallUsd: Math.max(0, average(tailLosses)),
      sampleCount: dailyReturns.length,
      horizonSampleCount: losses.length,
    };
  }

  throw new RangeError(`unsupported VaR method: ${String(method)}`);
}

export function quantile(
  values: readonly number[],
  probability: number,
): number {
  if (values.length === 0) throw new RangeError('values must not be empty');
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(probability * sorted.length) - 1);
  return sorted[Math.min(index, sorted.length - 1)];
}

export function average(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

export function standardDeviation(
  values: readonly number[],
  mean = average(values),
): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function simulateBootstrapLosses(
  dailyReturns: readonly number[],
  horizonDays: number,
  portfolioValueUsd: number,
  simulations: number,
): number[] {
  if (!Number.isInteger(simulations) || simulations < 1) {
    throw new RangeError('simulations must be a positive integer');
  }

  const random = seededRandom(dailyReturns);
  return Array.from({ length: simulations }, () => {
    let cumulativeReturn = 1;
    for (let day = 0; day < horizonDays; day += 1) {
      cumulativeReturn *=
        1 + dailyReturns[Math.floor(random() * dailyReturns.length)];
    }
    return -(cumulativeReturn - 1) * portfolioValueUsd;
  });
}

function seededRandom(values: readonly number[]): () => number {
  let seed = 2166136261;
  for (const value of values) {
    const text = value.toPrecision(12);
    for (let index = 0; index < text.length; index += 1) {
      seed ^= text.charCodeAt(index);
      seed = Math.imul(seed, 16777619);
    }
  }
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function normalPdf(value: number): number {
  return Math.exp(-(value ** 2) / 2) / Math.sqrt(2 * Math.PI);
}

function inverseNormalCdf(probability: number): number {
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [
    7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
    3.754408661907416,
  ];
  const lowerBoundary = 0.02425;
  const upperBoundary = 1 - lowerBoundary;

  if (probability < lowerBoundary) {
    const q = Math.sqrt(-2 * Math.log(probability));
    const numerator =
      ((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5];
    const denominator = (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1;
    return numerator / denominator;
  }
  if (probability > upperBoundary) {
    const q = Math.sqrt(-2 * Math.log(1 - probability));
    const numerator =
      ((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5];
    const denominator = (((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1;
    return -numerator / denominator;
  }

  const q = probability - 0.5;
  const r = q * q;
  const numerator =
    (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q;
  const denominator =
    ((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1;
  return numerator / denominator;
}
