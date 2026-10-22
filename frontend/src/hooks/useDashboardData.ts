import { useEffect, useState } from "react";
import { apiClient, Investment, User } from "../lib/api";
import {
  behavioralBiometrics,
  BehavioralAnalytics,
  RiskLevel,
} from "../lib/behavioralBiometrics";

const CACHE_KEY_PREFIX = "dashboard_data_";

// Risk score (0-100) at or above which we proactively re-authenticate.
const REAUTH_RISK_THRESHOLD = 70;

export interface DashboardData {
  user: User | null;
  investments: Investment[];
}

export interface UseDashboardDataReturn {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  isOffline: boolean;
  /** Current behavioral risk score (0-100) for the active session. */
  riskScore: number;
  /** Current behavioral risk level derived from the score. */
  riskLevel: RiskLevel;
  /** True when the risk score crossed the re-authentication threshold. */
  requiresReauth: boolean;
  /** Behavioral analytics (accuracy, false positives) for the user. */
  behavioralAnalytics: BehavioralAnalytics | null;
  /** Manually acknowledge the re-auth prompt after the user re-authenticates. */
  acknowledgeReauth: () => void;
}

function cacheKey(userId: string): string {
  return `${CACHE_KEY_PREFIX}${userId}`;
}

function readCache(userId: string): DashboardData | null {
  try {
    const raw = localStorage.getItem(cacheKey(userId));
    return raw ? (JSON.parse(raw) as DashboardData) : null;
  } catch {
    return null;
  }
}

function writeCache(userId: string, data: DashboardData): void {
  try {
    localStorage.setItem(cacheKey(userId), JSON.stringify(data));
  } catch {
    // Storage may be full or unavailable (e.g. private browsing) — caching
    // is a best-effort enhancement, not required for the dashboard to work.
  }
}

export function useDashboardData(): UseDashboardDataReturn {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [riskScore, setRiskScore] = useState(0);
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("low");
  const [requiresReauth, setRequiresReauth] = useState(false);
  const [behavioralAnalytics, setBehavioralAnalytics] =
    useState<BehavioralAnalytics | null>(null);

  useEffect(() => {
    let active = true;
    const userId = apiClient.getCurrentUser()?.id;

    // 1. Serve cached data immediately so the dashboard is usable before
    //    the network request resolves (stale-while-revalidate).
    const cached = userId ? readCache(userId) : null;
    if (cached && active) {
      setData(cached);
      setLoading(false);
    }

    // 2. Revalidate against the API in the background.
    async function revalidate() {
      try {
        const [user, investments] = await Promise.all([
          apiClient.refreshCurrentUser(),
          apiClient.getInvestorInvestments(),
        ]);

        const result: DashboardData = { user, investments };
        const resolvedUserId = user?.id ?? userId;
        if (resolvedUserId) writeCache(resolvedUserId, result);

        if (active) {
          setData(result);
          setIsOffline(false);
          setError(null);
        }
      } catch (err) {
        if (active) {
          if (cached) {
            // Keep showing the cached data; just flag it as stale.
            setIsOffline(true);
          } else {
            setError(
              err instanceof Error
                ? err.message
                : "Failed to load dashboard data",
            );
          }
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void revalidate();
    return () => {
      active = false;
    };
  }, []);

  // 3. Subscribe to behavioral biometrics for continuous authentication.
  //    When the local risk score crosses the threshold we refresh the auth
  //    token via the existing API client and prompt for re-authentication.
  useEffect(() => {
    let active = true;

    const unsubscribe = behavioralBiometrics.subscribe((snapshot) => {
      if (!active) return;
      setRiskScore(snapshot.riskScore);
      setRiskLevel(snapshot.riskLevel);

      if (snapshot.riskScore >= REAUTH_RISK_THRESHOLD) {
        setRequiresReauth(true);
        // Attempt a silent token refresh; if it fails the prompt remains.
        void apiClient.refreshAuthToken?.().catch(() => {
          /* keep the re-auth prompt visible on failure */
        });
      }
    });

    // Surface behavioral analytics accuracy for the current user.
    void behavioralBiometrics
      .getAnalytics()
      .then((analytics) => {
        if (active) setBehavioralAnalytics(analytics);
      })
      .catch(() => {
        /* analytics are best-effort */
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const acknowledgeReauth = () => {
    setRequiresReauth(false);
    behavioralBiometrics.resetRisk();
  };

  return {
    data,
    loading,
    error,
    isOffline,
    riskScore,
    riskLevel,
    requiresReauth,
    behavioralAnalytics,
    acknowledgeReauth,
  };
}
