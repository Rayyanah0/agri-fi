import { useState, useCallback, useEffect } from 'react';
import { DashboardService } from '../lib/dashboardService';
import { DashboardState, WidgetConfig, UserRole } from '../types/dashboard';

interface UseDashboardStateReturn {
  dashboard: DashboardState | null;
  loading: boolean;
  error: string | null;
  
  // Widget operations
  addWidget: (widget: WidgetConfig) => void;
  removeWidget: (widgetId: string) => void;
  updateWidget: (widgetId: string, updates: Partial<WidgetConfig>) => void;
  updateLayout: (widgets: WidgetConfig[]) => void;
  
  // Dashboard operations
  saveDashboard: () => Promise<void>;
  loadDashboard: (id: string) => Promise<void>;
  createNewDashboard: (name: string) => Promise<DashboardState>;
  deleteDashboard: () => Promise<void>;
  
  // Sharing
  shareDashboard: (userIds: string[], permissions?: 'view' | 'edit') => Promise<void>;
  
  // Presets
  applyPreset: (presetId: string) => Promise<void>;
}

export function useDashboardState(initialDashboardId?: string): UseDashboardStateReturn {
  const [dashboard, setDashboard] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(!!initialDashboardId);
  const [error, setError] = useState<string | null>(null);

  // Load initial dashboard
  useEffect(() => {
    if (!initialDashboardId) return;

    (async () => {
      try {
        setLoading(true);
        const loaded = await DashboardService.getDashboard(initialDashboardId);
        setDashboard(loaded);
        setError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load dashboard';
        setError(msg);
        console.error(msg);
      } finally {
        setLoading(false);
      }
    })();
  }, [initialDashboardId]);

  // Add widget
  const addWidget = useCallback((widget: WidgetConfig) => {
    setDashboard(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        widgets: [...prev.widgets, widget],
      };
    });
  }, []);

  // Remove widget
  const removeWidget = useCallback((widgetId: string) => {
    setDashboard(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        widgets: prev.widgets.filter(w => w.id !== widgetId),
      };
    });
  }, []);

  // Update widget
  const updateWidget = useCallback((widgetId: string, updates: Partial<WidgetConfig>) => {
    setDashboard(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        widgets: prev.widgets.map(w =>
          w.id === widgetId ? { ...w, ...updates } : w
        ),
      };
    });
  }, []);

  // Update entire layout (used by drag-and-drop)
  const updateLayout = useCallback((widgets: WidgetConfig[]) => {
    setDashboard(prev => {
      if (!prev) return prev;
      return { ...prev, widgets };
    });
  }, []);

  // Save dashboard
  const saveDashboard = useCallback(async () => {
    if (!dashboard) return;

    try {
      setError(null);
      if (dashboard.id.startsWith('dashboard_')) {
        // New dashboard
        const saved = await DashboardService.createDashboard({
          userId: dashboard.userId,
          name: dashboard.name,
          widgets: dashboard.widgets,
        });
        setDashboard(saved);
      } else {
        // Existing dashboard
        const updated = await DashboardService.updateDashboard(dashboard.id, dashboard);
        setDashboard(updated);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save dashboard';
      setError(msg);
      console.error(msg);
      throw err;
    }
  }, [dashboard]);

  // Load dashboard
  const loadDashboard = useCallback(async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      const loaded = await DashboardService.getDashboard(id);
      setDashboard(loaded);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load dashboard';
      setError(msg);
      console.error(msg);
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // Create new dashboard
  const createNewDashboard = useCallback(async (name: string): Promise<DashboardState> => {
    try {
      setError(null);
      const user = (globalThis as any).__currentUser;
      const newDashboard = await DashboardService.createDashboard({
        userId: user?.id || 'unknown',
        name,
        widgets: [],
      });
      setDashboard(newDashboard);
      return newDashboard;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create dashboard';
      setError(msg);
      console.error(msg);
      throw err;
    }
  }, []);

  // Delete dashboard
  const deleteDashboard = useCallback(async () => {
    if (!dashboard) return;

    try {
      setError(null);
      await DashboardService.deleteDashboard(dashboard.id);
      setDashboard(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete dashboard';
      setError(msg);
      console.error(msg);
      throw err;
    }
  }, [dashboard]);

  // Share dashboard
  const shareDashboard = useCallback(async (userIds: string[], permissions: 'view' | 'edit' = 'view') => {
    if (!dashboard) return;

    try {
      setError(null);
      await DashboardService.shareDashboard(dashboard.id, userIds, permissions);
      setDashboard(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          isShared: true,
          sharedWith: [...(prev.sharedWith || []), ...userIds],
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to share dashboard';
      setError(msg);
      console.error(msg);
      throw err;
    }
  }, [dashboard]);

  // Apply preset
  const applyPreset = useCallback(async (presetId: string) => {
    try {
      setError(null);
      const presets = await DashboardService.getPresets();
      const preset = presets.find(p => p.id === presetId);
      
      if (!preset) {
        throw new Error('Preset not found');
      }

      setDashboard(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          widgets: preset.widgets,
          presetId: preset.id,
        };
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to apply preset';
      setError(msg);
      console.error(msg);
      throw err;
    }
  }, []);

  return {
    dashboard,
    loading,
    error,
    addWidget,
    removeWidget,
    updateWidget,
    updateLayout,
    saveDashboard,
    loadDashboard,
    createNewDashboard,
    deleteDashboard,
    shareDashboard,
    applyPreset,
  };
}
