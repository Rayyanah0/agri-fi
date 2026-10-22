'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  predictiveEngine,
  ActionPrediction,
} from '../lib/predictive/predictiveEngine';

export function usePredictiveUI(currentContext: string) {
  const [predictions, setPredictions] = useState<ActionPrediction[]>([]);

  const refreshPredictions = useCallback(() => {
    const list = predictiveEngine.predictNextActions(currentContext);
    setPredictions(list);
  }, [currentContext]);

  useEffect(() => {
    refreshPredictions();
  }, [refreshPredictions]);

  const recordAction = useCallback(
    (actionId: string) => {
      predictiveEngine.recordAction(actionId, currentContext);
      refreshPredictions();
    },
    [currentContext, refreshPredictions]
  );

  const acceptPrediction = useCallback(
    (prediction: ActionPrediction) => {
      predictiveEngine.onPredictionAccepted(currentContext, prediction.targetActionId);
      refreshPredictions();
    },
    [currentContext, refreshPredictions]
  );

  const dismissPrediction = useCallback(
    (prediction: ActionPrediction) => {
      predictiveEngine.onPredictionDismissed(currentContext, prediction.targetActionId);
      refreshPredictions();
    },
    [currentContext, refreshPredictions]
  );

  return {
    predictions,
    recordAction,
    acceptPrediction,
    dismissPrediction,
    getAnalytics: () => predictiveEngine.getAnalytics(),
  };
}
