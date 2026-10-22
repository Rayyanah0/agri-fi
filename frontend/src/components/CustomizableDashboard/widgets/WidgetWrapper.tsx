'use client';

import React from 'react';
import { WidgetConfig } from '@/types/dashboard';

interface WidgetWrapperProps {
  widget: WidgetConfig;
  loading?: boolean;
  error?: string;
  children: React.ReactNode;
  onConfigChange?: (settings: any) => void;
}

export function WidgetWrapper({
  widget,
  loading,
  error,
  children,
  onConfigChange,
}: WidgetWrapperProps) {
  return (
    <div className="w-full h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-slate-200 pb-2 mb-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900 text-sm capitalize">
            {widget.type.replace('-', ' ')}
          </h3>
          {widget.settings?.timeRange && (
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded">
              {widget.settings.timeRange}
            </span>
          )}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
        </div>
      ) : error ? (
        <div className="flex items-center justify-center flex-1">
          <div className="text-center">
            <p className="text-sm text-red-600 font-medium">Error</p>
            <p className="text-xs text-slate-500 mt-1">{error}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      )}
    </div>
  );
}
