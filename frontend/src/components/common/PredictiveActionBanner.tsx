'use client';

import React from 'react';
import { usePredictiveUI } from '../../hooks/usePredictiveUI';
import { ActionPrediction } from '../../lib/predictive/predictiveEngine';

export interface PredictiveActionBannerProps {
  context: string;
  onSelectAction?: (actionId: string) => void;
  className?: string;
}

export const PredictiveActionBanner: React.FC<PredictiveActionBannerProps> = ({
  context,
  onSelectAction,
  className = '',
}) => {
  const { predictions, acceptPrediction, dismissPrediction } = usePredictiveUI(context);

  if (!predictions || predictions.length === 0) {
    return null;
  }

  const handleActionClick = (prediction: ActionPrediction) => {
    acceptPrediction(prediction);
    if (onSelectAction) {
      onSelectAction(prediction.targetActionId);
    }
  };

  return (
    <div
      role="region"
      aria-label="Suggested next actions"
      className={`flex items-center gap-2 p-3 bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 rounded-xl text-sm ${className}`}
    >
      <span className="font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
        <span>Suggested:</span>
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {predictions.map((p) => (
          <div key={p.targetActionId} className="inline-flex items-center gap-1">
            <button
              onClick={() => handleActionClick(p)}
              className="px-2.5 py-1 bg-white dark:bg-emerald-900 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100 rounded-lg text-emerald-800 dark:text-emerald-100 font-medium transition-colors shadow-sm"
            >
              {p.label}
              <span className="ml-1 text-xs text-emerald-600 dark:text-emerald-400 opacity-75">
                ({Math.round(p.confidence * 100)}%)
              </span>
            </button>
            <button
              onClick={() => dismissPrediction(p)}
              aria-label={`Dismiss ${p.label}`}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs px-1"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
