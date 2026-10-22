/**
 * Predictive User Interface Engine for Agri-Fi.
 *
 * Anticipates user actions based on navigation patterns, roles, and context.
 * Enables proactive content pre-loading and next-step recommendations while
 * strictly retaining all user behavior data in local client storage.
 */

export interface UserActionRecord {
  actionId: string;
  context: string;
  timestamp: number;
}

export interface ActionPrediction {
  targetActionId: string;
  label: string;
  confidence: number; // 0 to 1
  preLoadResource?: string;
  context: string;
}

export interface PredictiveAnalytics {
  totalSuggestions: number;
  acceptedSuggestions: number;
  dismissedSuggestions: number;
  accuracyRate: number;
  estimatedMinutesSaved: number;
}

export class PredictiveUIEngine {
  // Map of "currentContext:actionId" -> Map of "nextActionId" -> count
  private transitionMatrix: Map<string, Map<string, number>> = new Map();
  private recentActions: UserActionRecord[] = [];
  private totalSuggestions = 0;
  private acceptedSuggestions = 0;
  private dismissedSuggestions = 0;

  constructor() {
    this.loadFromLocalStorage();
  }

  /**
   * Records a user interaction or navigation event.
   */
  public recordAction(actionId: string, context: string): void {
    const now = Date.now();
    const last = this.recentActions[this.recentActions.length - 1];

    if (last) {
      const transitionKey = `${last.context}:${last.actionId}`;
      let nextMap = this.transitionMatrix.get(transitionKey);
      if (!nextMap) {
        nextMap = new Map<string, number>();
        this.transitionMatrix.set(transitionKey, nextMap);
      }
      nextMap.set(actionId, (nextMap.get(actionId) || 0) + 1);
    }

    this.recentActions.push({ actionId, context, timestamp: now });
    if (this.recentActions.length > 50) {
      this.recentActions.shift();
    }

    this.saveToLocalStorage();
  }

  /**
   * Generates anticipated next actions given the current context and last action.
   */
  public predictNextActions(currentContext: string, currentActionId?: string): ActionPrediction[] {
    const lastAction = currentActionId || this.recentActions[this.recentActions.length - 1]?.actionId;
    if (!lastAction) {
      return this.getDefaultPredictions(currentContext);
    }

    const transitionKey = `${currentContext}:${lastAction}`;
    const nextMap = this.transitionMatrix.get(transitionKey);

    if (!nextMap || nextMap.size === 0) {
      return this.getDefaultPredictions(currentContext);
    }

    let total = 0;
    for (const count of nextMap.values()) {
      total += count;
    }

    const predictions: ActionPrediction[] = [];
    for (const [targetActionId, count] of nextMap.entries()) {
      const confidence = total > 0 ? Number((count / total).toFixed(2)) : 0;
      predictions.push({
        targetActionId,
        label: this.formatActionLabel(targetActionId),
        confidence,
        preLoadResource: this.resolvePreLoadResource(targetActionId),
        context: currentContext,
      });
    }

    this.totalSuggestions++;
    return predictions.sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  }

  /**
   * Feedback loop: increases weight for accepted prediction.
   */
  public onPredictionAccepted(currentContext: string, actionId: string): void {
    this.acceptedSuggestions++;
    this.recordAction(actionId, currentContext);
  }

  /**
   * Feedback loop: decreases weight for dismissed prediction.
   */
  public onPredictionDismissed(currentContext: string, targetActionId: string): void {
    this.dismissedSuggestions++;
    const lastAction = this.recentActions[this.recentActions.length - 1]?.actionId;
    if (lastAction) {
      const transitionKey = `${currentContext}:${lastAction}`;
      const nextMap = this.transitionMatrix.get(transitionKey);
      if (nextMap && nextMap.has(targetActionId)) {
        const currentCount = nextMap.get(targetActionId) || 1;
        if (currentCount > 1) {
          nextMap.set(targetActionId, currentCount - 1);
        } else {
          nextMap.delete(targetActionId);
        }
      }
    }
    this.saveToLocalStorage();
  }

  public getAnalytics(): PredictiveAnalytics {
    const accuracyRate =
      this.totalSuggestions > 0 ? Number((this.acceptedSuggestions / this.totalSuggestions).toFixed(2)) : 0;
    const estimatedMinutesSaved = Number((this.acceptedSuggestions * 0.5).toFixed(1)); // ~30s per anticipation
    return {
      totalSuggestions: this.totalSuggestions,
      acceptedSuggestions: this.acceptedSuggestions,
      dismissedSuggestions: this.dismissedSuggestions,
      accuracyRate,
      estimatedMinutesSaved,
    };
  }

  public clearHistory(): void {
    this.transitionMatrix.clear();
    this.recentActions = [];
    this.totalSuggestions = 0;
    this.acceptedSuggestions = 0;
    this.dismissedSuggestions = 0;
    if (typeof window !== 'undefined' && window.localStorage) {
      localStorage.removeItem('agri_predictive_ui_state');
    }
  }

  private getDefaultPredictions(context: string): ActionPrediction[] {
    const defaultsByContext: Record<string, string[]> = {
      dashboard: ['view_deals', 'review_portfolio'],
      deals: ['filter_commodities', 'create_investment'],
      investments: ['download_statement', 'check_escrow'],
    };

    const actions = defaultsByContext[context] || ['view_dashboard'];
    return actions.map((targetActionId) => ({
      targetActionId,
      label: this.formatActionLabel(targetActionId),
      confidence: 0.5,
      preLoadResource: this.resolvePreLoadResource(targetActionId),
      context,
    }));
  }

  private formatActionLabel(actionId: string): string {
    return actionId
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  private resolvePreLoadResource(actionId: string): string | undefined {
    const routes: Record<string, string> = {
      view_deals: '/deals',
      review_portfolio: '/portfolio',
      create_investment: '/deals/invest',
      download_statement: '/reports',
    };
    return routes[actionId];
  }

  private saveToLocalStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const serializable: Record<string, Record<string, number>> = {};
      for (const [key, map] of this.transitionMatrix.entries()) {
        serializable[key] = Object.fromEntries(map.entries());
      }
      localStorage.setItem('agri_predictive_ui_state', JSON.stringify(serializable));
    } catch {
      // Ignore storage errors
    }
  }

  private loadFromLocalStorage(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const raw = localStorage.getItem('agri_predictive_ui_state');
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const [key, entries] of Object.entries(parsed)) {
          this.transitionMatrix.set(key, new Map(Object.entries(entries as Record<string, number>)));
        }
      }
    } catch {
      // Ignore storage errors
    }
  }
}

export const predictiveEngine = new PredictiveUIEngine();
