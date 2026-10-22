// Dashboard widget types and interfaces

export type WidgetType = 
  | 'portfolio-value'
  | 'deal-performance'
  | 'market-trends'
  | 'notifications'
  | 'transaction-history'
  | 'investment-breakdown'
  | 'credit-score'
  | 'yield-tracker'
  | 'shipment-map'
  | 'portfolio-chart'
  | 'metrics-card'
  | 'orders';

export type UserRole = 'farmer' | 'investor' | 'trader';

export interface WidgetConfig {
  id: string;
  type: WidgetType;
  position: { x: number; y: number };
  size: { w: number; h: number };
  settings?: {
    timeRange?: '1D' | '7D' | '30D' | '90D' | '1Y' | 'ALL';
    dataSource?: string;
    filters?: Record<string, any>;
    refreshInterval?: number;
  };
}

export interface DashboardPreset {
  id: string;
  name: string;
  description?: string;
  widgets: WidgetConfig[];
  role?: UserRole;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardState {
  id: string;
  userId: string;
  name: string;
  widgets: WidgetConfig[];
  layout?: 'grid' | 'flex';
  isShared?: boolean;
  sharedWith?: string[];
  presetId?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
}

export interface SharedDashboard {
  dashboardId: string;
  ownerId: string;
  ownerName: string;
  name: string;
  sharedAt: string;
  permissions: 'view' | 'edit';
}

export interface WidgetAnalytics {
  widgetId: string;
  widgetType: WidgetType;
  views: number;
  interactions: number;
  timeSpent: number; // in seconds
  lastViewed: string;
}

export interface DashboardAnalytics {
  dashboardId: string;
  totalViews: number;
  widgetAnalytics: WidgetAnalytics[];
  mostUsedWidget: WidgetType | null;
  averageSessionTime: number;
}
