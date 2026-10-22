"use client";

import React, { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import {
  COMMODITIES,
  EXCHANGE_RATES,
  CommodityId,
  Timeframe,
  Currency,
  getHistoricalData,
  getRegionalPrices,
  formatCurrencyPrice,
  exportPriceDataCsv,
  PriceAlert,
} from "@/lib/commodity-pricing";

export const CommodityPriceVisualization: React.FC = () => {
  const [selectedCommodity, setSelectedCommodity] =
    useState<CommodityId>("cocoa");
  const [timeframe, setTimeframe] = useState<Timeframe>("1Y");
  const [currency, setCurrency] = useState<Currency>("USD");
  const [activeTab, setActiveTab] = useState<"trends" | "regional">("trends");

  // Alerts
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [alertTargetPrice, setAlertTargetPrice] = useState<string>("");
  const [alertCondition, setAlertCondition] = useState<"above" | "below">(
    "above",
  );
  const [alertModalOpen, setAlertModalOpen] = useState(false);
  const [alertNotice, setAlertNotice] = useState<string | null>(null);

  const meta = COMMODITIES[selectedCommodity];
  const chartData = useMemo(
    () => getHistoricalData(selectedCommodity, timeframe, currency),
    [selectedCommodity, timeframe, currency],
  );
  const regionalData = useMemo(
    () => getRegionalPrices(selectedCommodity, currency),
    [selectedCommodity, currency],
  );

  const handleCreateAlert = (e: React.FormEvent) => {
    e.preventDefault();
    const target = parseFloat(alertTargetPrice);
    if (isNaN(target) || target <= 0) return;

    const newAlert: PriceAlert = {
      id: `alert-${Date.now()}`,
      commodityId: selectedCommodity,
      targetPrice: target,
      condition: alertCondition,
      createdAt: Date.now(),
    };
    setAlerts((prev) => [...prev, newAlert]);
    setAlertTargetPrice("");
    setAlertModalOpen(false);
    setAlertNotice(
      `Alert saved: Notify when ${meta.name} is ${alertCondition} ${EXCHANGE_RATES[currency].symbol}${target}`,
    );
    setTimeout(() => setAlertNotice(null), 5000);
  };

  return (
    <div className="space-y-6 bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
      {/* Top Header & Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {meta.name}
            </h2>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                meta.change24hPct >= 0
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                  : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
              }`}
            >
              {meta.change24hPct >= 0 ? "▲ +" : "▼ "}
              {meta.change24hPct}%
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Pricing Unit: {meta.unit} · Real-time Agricultural Exchange Feed
          </p>
        </div>

        {/* Currency & Export Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Currency Switcher */}
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 p-0.5 text-xs bg-slate-50 dark:bg-slate-800">
            {(["USD", "EUR", "GBP", "NGN", "KES"] as Currency[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCurrency(c)}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                  currency === c
                    ? "bg-blue-600 text-white"
                    : "text-slate-600 dark:text-slate-300 hover:text-slate-900"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setAlertModalOpen(true)}
            className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            🔔 Set Alert
          </button>

          <button
            type="button"
            onClick={() =>
              exportPriceDataCsv(selectedCommodity, chartData, currency)
            }
            className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 transition-colors"
          >
            📥 Export CSV
          </button>
        </div>
      </div>

      {alertNotice && (
        <div
          role="status"
          className="rounded-lg bg-blue-50 dark:bg-blue-950/60 p-3 text-xs text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
        >
          {alertNotice}
        </div>
      )}

      {/* Commodity Selector Ribbon */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2">
        {(Object.keys(COMMODITIES) as CommodityId[]).map((cid) => {
          const item = COMMODITIES[cid];
          const isSelected = selectedCommodity === cid;
          return (
            <button
              key={cid}
              type="button"
              onClick={() => setSelectedCommodity(cid)}
              className={`flex flex-col text-left px-3.5 py-2 rounded-xl border transition-all shrink-0 ${
                isSelected
                  ? "border-blue-600 bg-blue-50/50 dark:bg-blue-950/30"
                  : "border-slate-200 dark:border-slate-800 hover:border-slate-300"
              }`}
            >
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {item.name.split(" ")[0]}
              </span>
              <span className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                {formatCurrencyPrice(item.currentPriceUsd, currency)}
              </span>
            </button>
          );
        })}
      </div>

      {/* View Tabs & Timeframe Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("trends")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
              activeTab === "trends"
                ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            Historical & Forecast Trends
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("regional")}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
              activeTab === "regional"
                ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
                : "text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            }`}
          >
            Regional Comparison
          </button>
        </div>

        {activeTab === "trends" && (
          <div className="flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 text-xs">
            {(["1M", "1Y", "3Y", "5Y"] as Timeframe[]).map((tf) => (
              <button
                key={tf}
                type="button"
                onClick={() => setTimeframe(tf)}
                className={`px-2.5 py-1 rounded-md font-medium capitalize ${
                  timeframe === tf
                    ? "bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-white"
                    : "text-slate-500 hover:text-slate-900 dark:hover:text-white"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chart Display Area */}
      <div className="h-[360px] w-full pt-4">
        {activeTab === "trends" ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                domain={["auto", "auto"]}
                tickFormatter={(val) =>
                  `${EXCHANGE_RATES[currency].symbol}${val}`
                }
              />
              <Tooltip
                formatter={(val: number) => [
                  `${EXCHANGE_RATES[currency].symbol}${val}`,
                  "Price",
                ]}
                contentStyle={{
                  backgroundColor: "#0f172a",
                  borderRadius: "0.75rem",
                  border: "none",
                  color: "#fff",
                  fontSize: "12px",
                }}
              />
              <Legend verticalAlign="top" height={36} />
              <Line
                type="monotone"
                dataKey="price"
                name={`Actual Spot Price (${currency})`}
                stroke="#2563eb"
                strokeWidth={2.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="forecast"
                name={`Predictive Forecast (${currency})`}
                stroke="#10b981"
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="forecastUpper"
                name="Confidence Range Upper"
                stroke="#cbd5e1"
                strokeWidth={1}
                strokeDasharray="2 2"
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="forecastLower"
                name="Confidence Range Lower"
                stroke="#cbd5e1"
                strokeWidth={1}
                strokeDasharray="2 2"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={regionalData}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
              <XAxis dataKey="region" tick={{ fontSize: 10 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                tickFormatter={(val) =>
                  `${EXCHANGE_RATES[currency].symbol}${val}`
                }
              />
              <Tooltip
                formatter={(val: number) => [
                  `${EXCHANGE_RATES[currency].symbol}${val}`,
                  "Regional Price",
                ]}
                contentStyle={{
                  backgroundColor: "#0f172a",
                  borderRadius: "0.75rem",
                  border: "none",
                  color: "#fff",
                  fontSize: "12px",
                }}
              />
              <Legend verticalAlign="top" height={36} />
              <Bar
                dataKey="price"
                name={`Spot Price (${currency})`}
                fill="#3b82f6"
                radius={[4, 4, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Alert Configuration Modal */}
      {alertModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
        >
          <div className="w-full max-w-sm rounded-xl bg-white dark:bg-slate-900 p-6 shadow-xl border border-slate-200 dark:border-slate-800">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Create Price Alert for {meta.name}
            </h3>
            <form onSubmit={handleCreateAlert} className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Condition
                </label>
                <select
                  value={alertCondition}
                  onChange={(e) =>
                    setAlertCondition(e.target.value as "above" | "below")
                  }
                  className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  <option value="above">Price rises above</option>
                  <option value="below">Price drops below</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Target Price ({currency})
                </label>
                <input
                  type="number"
                  step="any"
                  value={alertTargetPrice}
                  onChange={(e) => setAlertTargetPrice(e.target.value)}
                  placeholder={`e.g. ${meta.currentPriceUsd}`}
                  className="mt-1 w-full rounded-md border border-slate-300 dark:border-slate-700 px-3 py-2 text-sm bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  required
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAlertModalOpen(false)}
                  className="rounded-md border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  Save Alert
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
