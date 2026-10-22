"use client";

import React from "react";
import { CommodityPriceVisualization } from "@/components/market/CommodityPriceVisualization";

export default function MarketPricingPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
          Agricultural Commodity Market Intelligence
        </h1>
        <p className="mt-2 text-sm text-slate-500 max-w-3xl">
          Real-time exchange price feeds, multi-year historical trends, regional
          spot comparisons, and predictive machine-learning forecasts to empower
          optimal deal timing and pricing.
        </p>
      </div>

      <CommodityPriceVisualization />
    </div>
  );
}
