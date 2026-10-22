import { apiClient } from './api';
import { 
  DashboardState, 
  DashboardPreset, 
  SharedDashboard, 
  DashboardAnalytics, 
  WidgetAnalytics,
  WidgetConfig,
  UserRole
} from '../types/dashboard';

const STORAGE_PREFIX = 'agri_dashboard_';

export class DashboardService {
  // ─────────────────────────────────────────────────────────────────────────
  // Dashboard CRUD
  // ─────────────────────────────────────────────────────────────────────────

  static async getDashboard(id: string): Promise<DashboardState> {
    try {
      const response = await apiClient.get(`/api/dashboards/${id}`);
      return response.data;
    } catch (error) {
      // Fallback to localStorage
      const cached = localStorage.getItem(`${STORAGE_PREFIX}${id}`);
      if (cached) return JSON.parse(cached);
      throw error;
    }
  }

  static async getUserDashboards(): Promise<DashboardState[]> {
    try {
      const response = await apiClient.get('/api/dashboards');
      return response.data;
    } catch (error) {
      console.error('Failed to fetch dashboards:', error);
      return [];
    }
  }

  static async createDashboard(dashboard: Omit<DashboardState, 'id' | 'createdAt' | 'updatedAt'>): Promise<DashboardState> {
    const payload = {
      ...dashboard,
      id: `dashboard_${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const response = await apiClient.post('/api/dashboards', payload);
      const result = response.data;
      localStorage.setItem(`${STORAGE_PREFIX}${result.id}`, JSON.stringify(result));
      return result;
    } catch (error) {
      // Fallback to localStorage
      localStorage.setItem(`${STORAGE_PREFIX}${payload.id}`, JSON.stringify(payload));
      return payload;
    }
  }

  static async updateDashboard(id: string, updates: Partial<DashboardState>): Promise<DashboardState> {
    const dashboard = await this.getDashboard(id);
    const updated = {
      ...dashboard,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    try {
      const response = await apiClient.put(`/api/dashboards/${id}`, updated);
      localStorage.setItem(`${STORAGE_PREFIX}${id}`, JSON.stringify(response.data));
      return response.data;
    } catch (error) {
      localStorage.setItem(`${STORAGE_PREFIX}${id}`, JSON.stringify(updated));
      return updated;
    }
  }

  static async deleteDashboard(id: string): Promise<void> {
    try {
      await apiClient.delete(`/api/dashboards/${id}`);
    } catch (error) {
      console.error('Failed to delete dashboard:', error);
    }
    localStorage.removeItem(`${STORAGE_PREFIX}${id}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Dashboard Sharing
  // ─────────────────────────────────────────────────────────────────────────

  static async shareDashboard(id: string, userIds: string[], permissions: 'view' | 'edit' = 'view'): Promise<void> {
    try {
      await apiClient.post(`/api/dashboards/${id}/share`, { userIds, permissions });
    } catch (error) {
      console.error('Failed to share dashboard:', error);
      throw error;
    }
  }

  static async getSharedDashboards(): Promise<SharedDashboard[]> {
    try {
      const response = await apiClient.get('/api/dashboards/shared');
      return response.data;
    } catch (error) {
      console.error('Failed to fetch shared dashboards:', error);
      return [];
    }
  }

  static async unshare(dashboardId: string, userId: string): Promise<void> {
    try {
      await apiClient.delete(`/api/dashboards/${dashboardId}/share/${userId}`);
    } catch (error) {
      console.error('Failed to unshare dashboard:', error);
      throw error;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Dashboard Presets
  // ─────────────────────────────────────────────────────────────────────────

  static async getPresets(): Promise<DashboardPreset[]> {
    try {
      const response = await apiClient.get('/api/dashboard-presets');
      return response.data;
    } catch (error) {
      console.error('Failed to fetch presets:', error);
      return this.getDefaultPresets();
    }
  }

  static async getPresetsByRole(role: UserRole): Promise<DashboardPreset[]> {
    try {
      const response = await apiClient.get(`/api/dashboard-presets?role=${role}`);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch presets for role:', error);
      return this.getDefaultPresets().filter(p => p.role === role);
    }
  }

  static async createPreset(preset: Omit<DashboardPreset, 'id' | 'createdAt' | 'updatedAt'>): Promise<DashboardPreset> {
    const payload = {
      ...preset,
      id: `preset_${Date.now()}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const response = await apiClient.post('/api/dashboard-presets', payload);
      return response.data;
    } catch (error) {
      console.error('Failed to create preset:', error);
      return payload;
    }
  }

  static getDefaultPresets(): DashboardPreset[] {
    return [
      {
        id: 'preset_farmer_default',
        name: 'Farmer Dashboard',
        role: 'farmer',
        isDefault: true,
        widgets: [
          { id: 'w1', type: 'credit-score', position: { x: 0, y: 0 }, size: { w: 4, h: 3 } },
          { id: 'w2', type: 'portfolio-value', position: { x: 4, y: 0 }, size: { w: 4, h: 3 } },
          { id: 'w3', type: 'market-trends', position: { x: 8, y: 0 }, size: { w: 4, h: 3 } },
          { id: 'w4', type: 'shipment-map', position: { x: 0, y: 3 }, size: { w: 6, h: 4 } },
          { id: 'w5', type: 'transaction-history', position: { x: 6, y: 3 }, size: { w: 6, h: 4 } },
          { id: 'w6', type: 'notifications', position: { x: 0, y: 7 }, size: { w: 12, h: 3 } },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'preset_investor_default',
        name: 'Investor Dashboard',
        role: 'investor',
        isDefault: true,
        widgets: [
          { id: 'w1', type: 'portfolio-value', position: { x: 0, y: 0 }, size: { w: 4, h: 2 } },
          { id: 'w2', type: 'yield-tracker', position: { x: 4, y: 0 }, size: { w: 4, h: 2 } },
          { id: 'w3', type: 'deal-performance', position: { x: 8, y: 0 }, size: { w: 4, h: 2 } },
          { id: 'w4', type: 'portfolio-chart', position: { x: 0, y: 2 }, size: { w: 6, h: 4 } },
          { id: 'w5', type: 'investment-breakdown', position: { x: 6, y: 2 }, size: { w: 6, h: 4 } },
          { id: 'w6', type: 'transaction-history', position: { x: 0, y: 6 }, size: { w: 12, h: 3 } },
          { id: 'w7', type: 'notifications', position: { x: 0, y: 9 }, size: { w: 12, h: 2 } },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'preset_trader_default',
        name: 'Trader Dashboard',
        role: 'trader',
        isDefault: true,
        widgets: [
          { id: 'w1', type: 'market-trends', position: { x: 0, y: 0 }, size: { w: 4, h: 3 } },
          { id: 'w2', type: 'orders', position: { x: 4, y: 0 }, size: { w: 4, h: 3 } },
          { id: 'w3', type: 'deal-performance', position: { x: 8, y: 0 }, size: { w: 4, h: 3 } },
          { id: 'w4', type: 'portfolio-chart', position: { x: 0, y: 3 }, size: { w: 6, h: 4 } },
          { id: 'w5', type: 'transaction-history', position: { x: 6, y: 3 }, size: { w: 6, h: 4 } },
          { id: 'w6', type: 'notifications', position: { x: 0, y: 7 }, size: { w: 12, h: 2 } },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Analytics
  // ─────────────────────────────────────────────────────────────────────────

  static async trackWidgetInteraction(dashboardId: string, widgetId: string, widgetType: string): Promise<void> {
    try {
      await apiClient.post('/api/dashboard-analytics/interaction', {
        dashboardId,
        widgetId,
        widgetType,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      // Analytics are non-critical
      console.debug('Failed to track widget interaction:', error);
    }
  }

  static async getDashboardAnalytics(dashboardId: string): Promise<DashboardAnalytics | null> {
    try {
      const response = await apiClient.get(`/api/dashboard-analytics/${dashboardId}`);
      return response.data;
    } catch (error) {
      console.error('Failed to fetch dashboard analytics:', error);
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Local storage helpers
  // ─────────────────────────────────────────────────────────────────────────

  static saveLocalDashboard(dashboard: DashboardState): void {
    localStorage.setItem(`${STORAGE_PREFIX}${dashboard.id}`, JSON.stringify(dashboard));
  }

  static getLocalDashboard(id: string): DashboardState | null {
    const data = localStorage.getItem(`${STORAGE_PREFIX}${id}`);
    return data ? JSON.parse(data) : null;
  }

  static removeLocalDashboard(id: string): void {
    localStorage.removeItem(`${STORAGE_PREFIX}${id}`);
  }
}
