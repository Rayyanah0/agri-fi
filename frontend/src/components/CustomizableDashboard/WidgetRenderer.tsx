'use client';

import React from 'react';
import { WidgetConfig } from '@/types/dashboard';
import { WidgetWrapper } from './widgets/WidgetWrapper';

// Import existing widgets from dashboard components
import { MetricCard } from '@/components/dashboard/MetricCard';
import { PortfolioChart } from '@/components/dashboard/PortfolioChart';
import { TransactionTable } from '@/components/dashboard/TransactionTable';
import { ShipmentMap } from '@/components/dashboard/ShipmentMap';
import { FarmerCreditScoreWidget } from '@/components/dashboard/FarmerCreditScoreWidget';

interface WidgetRendererProps {
  widget: WidgetConfig;
}

export function WidgetRenderer({ widget }: WidgetRendererProps) {
  const renderWidgetContent = () => {
    switch (widget.type) {
      case 'portfolio-value':
        return (
          <WidgetWrapper widget={widget}>
            <MetricCard
              label="Portfolio Value"
              value="$125,430.50"
              change={12.5}
              icon="💰"
            />
          </WidgetWrapper>
        );

      case 'deal-performance':
        return (
          <WidgetWrapper widget={widget}>
            <div className="space-y-3">
              <MetricCard
                label="Deal Performance"
                value="98.2%"
                change={2.5}
                icon="📈"
              />
              <MetricCard
                label="Success Rate"
                value="24 of 25"
                icon="✅"
              />
            </div>
          </WidgetWrapper>
        );

      case 'market-trends':
        return (
          <WidgetWrapper widget={widget}>
            <div className="space-y-2">
              <div className="text-sm">
                <p className="text-slate-600">Coffee</p>
                <p className="text-lg font-bold text-green-600">↑ 3.2%</p>
              </div>
              <div className="text-sm">
                <p className="text-slate-600">Cocoa</p>
                <p className="text-lg font-bold text-red-600">↓ 1.8%</p>
              </div>
              <div className="text-sm">
                <p className="text-slate-600">Wheat</p>
                <p className="text-lg font-bold text-green-600">↑ 2.1%</p>
              </div>
            </div>
          </WidgetWrapper>
        );

      case 'notifications':
        return (
          <WidgetWrapper widget={widget}>
            <div className="space-y-2">
              <div className="p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                <p className="font-semibold text-blue-900">Deal matched</p>
                <p className="text-blue-700">Your profile matched with a new deal</p>
              </div>
              <div className="p-2 bg-green-50 border border-green-200 rounded text-xs">
                <p className="font-semibold text-green-900">Payout received</p>
                <p className="text-green-700">$500 payout received</p>
              </div>
            </div>
          </WidgetWrapper>
        );

      case 'transaction-history':
        return (
          <WidgetWrapper widget={widget}>
            <TransactionTable />
          </WidgetWrapper>
        );

      case 'portfolio-chart':
        return (
          <WidgetWrapper widget={widget}>
            <PortfolioChart />
          </WidgetWrapper>
        );

      case 'shipment-map':
        return (
          <WidgetWrapper widget={widget}>
            <ShipmentMap />
          </WidgetWrapper>
        );

      case 'credit-score':
        return (
          <WidgetWrapper widget={widget}>
            <FarmerCreditScoreWidget />
          </WidgetWrapper>
        );

      case 'yield-tracker':
        return (
          <WidgetWrapper widget={widget}>
            <MetricCard
              label="Expected Yield"
              value="450 bags"
              change={8}
              icon="🌾"
            />
          </WidgetWrapper>
        );

      case 'investment-breakdown':
        return (
          <WidgetWrapper widget={widget}>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Grains</span>
                <span className="font-bold">45%</span>
              </div>
              <div className="w-full bg-slate-200 rounded h-2">
                <div className="bg-green-500 h-2 rounded" style={{ width: '45%' }} />
              </div>
              <div className="flex justify-between text-sm">
                <span>Coffee</span>
                <span className="font-bold">35%</span>
              </div>
              <div className="w-full bg-slate-200 rounded h-2">
                <div className="bg-amber-600 h-2 rounded" style={{ width: '35%' }} />
              </div>
              <div className="flex justify-between text-sm">
                <span>Cocoa</span>
                <span className="font-bold">20%</span>
              </div>
              <div className="w-full bg-slate-200 rounded h-2">
                <div className="bg-amber-700 h-2 rounded" style={{ width: '20%' }} />
              </div>
            </div>
          </WidgetWrapper>
        );

      case 'metrics-card':
        return (
          <WidgetWrapper widget={widget}>
            <MetricCard
              label="Total Metrics"
              value="$1.2M"
              icon="📊"
            />
          </WidgetWrapper>
        );

      case 'orders':
        return (
          <WidgetWrapper widget={widget}>
            <div className="space-y-2">
              <div className="p-2 border border-slate-200 rounded">
                <p className="text-sm font-semibold">Order #1001</p>
                <p className="text-xs text-slate-600">500 bags Coffee - $2,500</p>
              </div>
              <div className="p-2 border border-slate-200 rounded">
                <p className="text-sm font-semibold">Order #1002</p>
                <p className="text-xs text-slate-600">200 bags Cocoa - $1,200</p>
              </div>
            </div>
          </WidgetWrapper>
        );

      default:
        return (
          <WidgetWrapper widget={widget}>
            <div className="flex items-center justify-center h-full">
              <p className="text-sm text-slate-500">Widget not found</p>
            </div>
          </WidgetWrapper>
        );
    }
  };

  return <>{renderWidgetContent()}</>;
}
