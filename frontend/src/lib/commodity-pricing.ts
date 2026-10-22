export type CommodityId = "cocoa" | "coffee" | "wheat" | "corn" | "soybeans";
export type Timeframe = "1M" | "1Y" | "3Y" | "5Y";
export type Currency = "USD" | "EUR" | "GBP" | "NGN" | "KES";

export interface PricePoint {
  date: string;
  price: number;
  forecast?: number;
  forecastUpper?: number;
  forecastLower?: number;
}

export interface RegionalPrice {
  region: string;
  price: number;
  change24h: number;
}

export interface CommodityMeta {
  id: CommodityId;
  name: string;
  unit: string;
  currentPriceUsd: number;
  change24hPct: number;
  high52w: number;
  low52w: number;
}

export interface PriceAlert {
  id: string;
  commodityId: CommodityId;
  targetPrice: number;
  condition: "above" | "below";
  createdAt: number;
  triggered?: boolean;
}

export const COMMODITIES: Record<CommodityId, CommodityMeta> = {
  cocoa: {
    id: "cocoa",
    name: "Cocoa (ICCO Grade A)",
    unit: "Metric Ton (MT)",
    currentPriceUsd: 8450,
    change24hPct: 2.45,
    high52w: 10200,
    low52w: 3900,
  },
  coffee: {
    id: "coffee",
    name: "Arabica Coffee",
    unit: "lb",
    currentPriceUsd: 2.85,
    change24hPct: -0.85,
    high52w: 3.15,
    low52w: 1.65,
  },
  wheat: {
    id: "wheat",
    name: "Hard Red Winter Wheat",
    unit: "Bushel",
    currentPriceUsd: 5.75,
    change24hPct: 1.2,
    high52w: 6.8,
    low52w: 5.1,
  },
  corn: {
    id: "corn",
    name: "Yellow Corn No. 2",
    unit: "Bushel",
    currentPriceUsd: 4.4,
    change24hPct: 0.45,
    high52w: 5.15,
    low52w: 3.95,
  },
  soybeans: {
    id: "soybeans",
    name: "Soybeans GMO Free",
    unit: "Bushel",
    currentPriceUsd: 11.2,
    change24hPct: -1.15,
    high52w: 13.4,
    low52w: 9.9,
  },
};

export const EXCHANGE_RATES: Record<
  Currency,
  { rate: number; symbol: string }
> = {
  USD: { rate: 1.0, symbol: "$" },
  EUR: { rate: 0.92, symbol: "€" },
  GBP: { rate: 0.79, symbol: "£" },
  NGN: { rate: 1650.0, symbol: "₦" },
  KES: { rate: 129.5, symbol: "KSh " },
};

export function convertPrice(priceUsd: number, currency: Currency): number {
  return priceUsd * EXCHANGE_RATES[currency].rate;
}

export function formatCurrencyPrice(
  priceUsd: number,
  currency: Currency,
): string {
  const converted = convertPrice(priceUsd, currency);
  const symbol = EXCHANGE_RATES[currency].symbol;
  if (converted >= 100) {
    return `${symbol}${converted.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  }
  return `${symbol}${converted.toFixed(2)}`;
}

export function getRegionalPrices(
  commodityId: CommodityId,
  currency: Currency,
): RegionalPrice[] {
  const base = COMMODITIES[commodityId].currentPriceUsd;
  const multipliers: Record<string, { mult: number; change: number }> = {
    "West Africa (Cote d'Ivoire / Ghana / Nigeria)": {
      mult: 0.96,
      change: 2.1,
    },
    "Latin America (Brazil / Colombia)": { mult: 1.02, change: -0.4 },
    "Southeast Asia (Vietnam / Indonesia)": { mult: 0.98, change: 1.5 },
    "North America (US / Canada)": { mult: 1.05, change: 0.8 },
    "European Port Terminals (CIF Rotterdam)": { mult: 1.08, change: 1.9 },
  };

  return Object.entries(multipliers).map(([region, data]) => ({
    region,
    price: convertPrice(base * data.mult, currency),
    change24h: data.change,
  }));
}

export function getHistoricalData(
  commodityId: CommodityId,
  timeframe: Timeframe,
  currency: Currency,
): PricePoint[] {
  const meta = COMMODITIES[commodityId];
  const base = meta.currentPriceUsd;

  let pointsCount = 30;
  let labelPrefix = "Day";
  if (timeframe === "1Y") {
    pointsCount = 12;
    labelPrefix = "Month";
  } else if (timeframe === "3Y") {
    pointsCount = 36;
    labelPrefix = "Month";
  } else if (timeframe === "5Y") {
    pointsCount = 20;
    labelPrefix = "Quarter";
  }

  const result: PricePoint[] = [];
  for (let i = pointsCount; i >= 1; i--) {
    const variance =
      Math.sin(i * 0.4) * 0.15 + ((pointsCount - i) / pointsCount) * 0.1;
    const priceUsd = base * (0.85 + variance);
    result.push({
      date: `${labelPrefix} -${i}`,
      price: Math.round(convertPrice(priceUsd, currency) * 100) / 100,
    });
  }

  // Current
  result.push({
    date: "Current",
    price: Math.round(convertPrice(base, currency) * 100) / 100,
    forecast: Math.round(convertPrice(base, currency) * 100) / 100,
    forecastUpper: Math.round(convertPrice(base, currency) * 100) / 100,
    forecastLower: Math.round(convertPrice(base, currency) * 100) / 100,
  });

  // 3 Future Forecast Periods
  for (let j = 1; j <= 3; j++) {
    const projected = base * (1 + j * 0.035);
    const upper = projected * 1.06;
    const lower = projected * 0.94;
    result.push({
      date: `+${j}Q Forecast`,
      price: Math.round(convertPrice(projected, currency) * 100) / 100,
      forecast: Math.round(convertPrice(projected, currency) * 100) / 100,
      forecastUpper: Math.round(convertPrice(upper, currency) * 100) / 100,
      forecastLower: Math.round(convertPrice(lower, currency) * 100) / 100,
    });
  }

  return result;
}

export function exportPriceDataCsv(
  commodityId: CommodityId,
  points: PricePoint[],
  currency: Currency,
): void {
  const headers = [
    "Date / Period",
    `Price (${currency})`,
    `Forecast (${currency})`,
    `Forecast Upper (${currency})`,
    `Forecast Lower (${currency})`,
  ];
  const rows = points.map((p) => [
    p.date,
    p.price,
    p.forecast ?? "",
    p.forecastUpper ?? "",
    p.forecastLower ?? "",
  ]);

  const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join(
    "\n",
  );
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", `${commodityId}_price_history_${currency}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
