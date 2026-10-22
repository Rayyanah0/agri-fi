'use client';

import React from 'react';
import { WidgetType } from '@/types/dashboard';

interface WidgetLibraryProps {
  onSelectWidget: (widgetType: string) => void;
}

interface WidgetInfo {
  type: WidgetType;
  name: string;
  description: string;
  icon: string;
  category: 'analytics' | 'performance' | 'data' | 'notifications';
}

const AVAILABLE_WIDGETS: WidgetInfo[] = [
  {
    type: 'portfolio-value',
    name: 'Portfolio Value',
    description: 'Display total portfolio value with trends',
    icon: '💰',
    category: 'analytics',
  },
  {
    type: 'deal-performance',
    name: 'Deal Performance',
    description: 'Track deal success rates and metrics',
    icon: '📈',
    category: 'performance',
  },
  {
    type: 'market-trends',
    name: 'Market Trends',
    description: 'View commodity price trends',
    icon: '📊',
    category: 'analytics',
  },
  {
    type: 'notifications',
    name: 'Notifications',
    description: 'Real-time alerts and updates',
    icon: '🔔',
    category: 'notifications',
  },
  {
    type: 'transaction-history',
    name: 'Transactions',
    description: 'Recent transaction history',
    icon: '💳',
    category: 'data',
  },
  {
    type: 'portfolio-chart',
    name: 'Portfolio Chart',
    description: 'Visual portfolio performance over time',
    icon: '📉',
    category: 'analytics',
  },
  {
    type: 'shipment-map',
    name: 'Shipment Map',
    description: 'Track shipment locations',
    icon: '🗺️',
    category: 'data',
  },
  {
    type: 'credit-score',
    name: 'Credit Score',
    description: 'Credit score and financial health',
    icon: '⭐',
    category: 'analytics',
  },
  {
    type: 'yield-tracker',
    name: 'Yield Tracker',
    description: 'Expected yield and harvest metrics',
    icon: '🌾',
    category: 'performance',
  },
  {
    type: 'investment-breakdown',
    name: 'Investment Breakdown',
    description: 'Portfolio allocation by category',
    icon: '🥧',
    category: 'analytics',
  },
  {
    type: 'metrics-card',
    name: 'Metrics Card',
    description: 'Custom metrics display',
    icon: '📐',
    category: 'analytics',
  },
  {
    type: 'orders',
    name: 'Orders',
    description: 'Active orders and status',
    icon: '📦',
    category: 'data',
  },
];

export function WidgetLibrary({ onSelectWidget }: WidgetLibraryProps) {
  const [selectedCategory, setSelectedCategory] = React.useState<'all' | 'analytics' | 'performance' | 'data' | 'notifications'>('all');

  const categories = ['all', 'analytics', 'performance', 'data', 'notifications'] as const;
  
  const filteredWidgets = selectedCategory === 'all'
    ? AVAILABLE_WIDGETS
    : AVAILABLE_WIDGETS.filter(w => w.category === selectedCategory);

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-slate-900 mb-3">Widget Library</h3>
        <div className="flex gap-2 flex-wrap">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                selectedCategory === cat
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              {cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredWidgets.map(widget => (
          <button
            key={widget.type}
            onClick={() => onSelectWidget(widget.type)}
            className="p-4 border border-slate-200 rounded-lg hover:border-brand-400 hover:bg-brand-50 transition-all text-left group"
          >
            <div className="flex items-start justify-between mb-2">
              <span className="text-2xl">{widget.icon}</span>
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded group-hover:bg-brand-200 group-hover:text-brand-700 transition-colors">
                Add
              </span>
            </div>
            <h4 className="font-semibold text-slate-900 text-sm">{widget.name}</h4>
            <p className="text-xs text-slate-600 mt-1">{widget.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
