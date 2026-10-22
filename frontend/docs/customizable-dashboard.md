# Customizable Dashboard Documentation

## Overview

The customizable dashboard system allows users to create personalized dashboards with drag-and-drop widgets tailored to their role and preferences. This feature significantly improves user productivity by enabling users to prioritize information relevant to their specific needs.

## Features

### 1. Widget Library

The dashboard includes **12+ widget types** organized into categories:

#### Analytics Widgets
- **Portfolio Value**: Display total portfolio value with trend indicators
- **Market Trends**: Real-time commodity price trends
- **Portfolio Chart**: Visual portfolio performance over time
- **Credit Score**: Financial health and credit metrics
- **Investment Breakdown**: Portfolio allocation visualization
- **Metrics Card**: Custom metrics display

#### Performance Widgets
- **Deal Performance**: Track deal success rates and metrics
- **Yield Tracker**: Expected yield and harvest metrics

#### Data Widgets
- **Transactions**: Recent transaction history
- **Shipment Map**: Track shipment locations
- **Orders**: Active orders and status

#### Notification Widgets
- **Notifications**: Real-time alerts and updates

### 2. Drag-and-Drop Interface

The dashboard grid uses a 12-column layout system:

- **Moving**: Click and drag any widget to reposition it
- **Resizing**: Use the resize handle (⤡) in the bottom-right corner to adjust widget size
- **Minimum size**: All widgets must be at least 2×2 grid cells
- **Responsive**: Automatically adapts to different screen sizes

#### Usage
```
1. Click on a widget to drag it to a new position
2. Use the resize handle to change widget dimensions
3. Click the × button to remove a widget
4. Click "Save" to persist layout changes
```

### 3. Dashboard Templates

Pre-built templates for different user roles:

#### Farmer Dashboard
- Credit Score widget for financial health monitoring
- Portfolio Value and Market Trends for decision-making
- Shipment Map for real-time location tracking
- Transaction History for record keeping
- Notifications for important updates

#### Investor Dashboard
- Portfolio Value for asset tracking
- Yield Tracker for return monitoring
- Deal Performance for investment metrics
- Portfolio Chart for visual analysis
- Investment Breakdown for allocation insights
- Transaction History and Notifications

#### Trader Dashboard
- Market Trends for price monitoring
- Orders widget for active order tracking
- Deal Performance for trade metrics
- Portfolio Chart for visual trends
- Transaction History for trade records
- Notifications for market updates

### 4. Widget Configuration

Each widget can be customized with specific settings:

```typescript
interface WidgetSettings {
  timeRange?: '1D' | '7D' | '30D' | '90D' | '1Y' | 'ALL';
  dataSource?: string;
  filters?: Record<string, any>;
  refreshInterval?: number; // in seconds
}
```

Configuration options vary by widget type and can be modified through the widget settings menu.

### 5. Dashboard Sharing

Share your dashboard configuration with other users:

1. Click the **Share** button in the dashboard menu (⋮)
2. Enter the recipient's email address
3. Select permission level:
   - **View Only**: Recipients can view but not modify
   - **Can Edit**: Recipients can modify the dashboard
4. Click **Share** to send

Shared dashboards appear in the recipient's "Shared with Me" section.

### 6. Dashboard Presets

Save and restore dashboard configurations:

**Save Current Layout as Preset**:
1. Customize your dashboard layout
2. Click "Save as Preset" in the dashboard menu
3. Enter a preset name and optional description

**Apply a Preset**:
1. Click the **Templates** button while in edit mode
2. Select a preset to apply its configuration
3. Your widgets and layout will be updated instantly

Presets are stored per user and can be applied to any dashboard.

### 7. Responsive Design

The dashboard adapts to all screen sizes:

- **Desktop (>1024px)**: Full 12-column grid with all features
- **Tablet (640-1024px)**: Adaptive grid with automatic column reduction
- **Mobile (<640px)**: Single column layout with optimized touch targets

Each widget automatically scales its content for better readability on smaller screens.

### 8. Real-Time Updates

Widgets that support real-time data automatically refresh:

- **Socket.io Integration**: Live data pushes for price-sensitive widgets
- **Auto-Subscribe**: Widgets subscribe to real-time updates when added
- **Smart Throttling**: Updates are throttled to prevent excessive re-renders
- **Connection Status**: Visual indicator shows real-time connection status

Configured refresh intervals:
- **Critical widgets** (prices, notifications): 5-10 seconds
- **Performance widgets**: 30-60 seconds
- **Historical data**: 5-10 minutes

### 9. Dashboard Analytics

Track widget usage and user preferences:

**Metrics Tracked**:
- Widget view counts
- User interaction patterns
- Time spent in dashboard
- Most-used widget types
- Popular configurations

Access analytics:
```typescript
const analytics = await DashboardService.getDashboardAnalytics(dashboardId);
```

Analytics help identify:
- Most valuable widgets for different roles
- User engagement patterns
- Performance optimization opportunities
- Features to prioritize in updates

## API Integration

### Backend Requirements

The dashboard system requires the following backend endpoints:

```
GET    /api/dashboards                    - List user dashboards
GET    /api/dashboards/:id                - Get specific dashboard
POST   /api/dashboards                    - Create dashboard
PUT    /api/dashboards/:id                - Update dashboard
DELETE /api/dashboards/:id                - Delete dashboard

POST   /api/dashboards/:id/share          - Share dashboard
GET    /api/dashboards/shared             - Get shared dashboards
DELETE /api/dashboards/:id/share/:userId  - Unshare from user

GET    /api/dashboard-presets             - List presets
POST   /api/dashboard-presets             - Create preset

POST   /api/dashboard-analytics/interaction - Track widget interaction
GET    /api/dashboard-analytics/:id       - Get dashboard analytics

WS     /socket.io                         - WebSocket for real-time updates
```

### Persistence

Dashboards are persisted with:
- **Primary**: API backend with database storage
- **Fallback**: Browser localStorage for offline support
- **Sync**: Automatic sync when connection restored

## Implementation Guide

### Basic Usage

```typescript
import { CustomizableDashboard } from '@/components/CustomizableDashboard/CustomizableDashboard';

export function DashboardPage() {
  return (
    <CustomizableDashboard
      initialDashboardId="dashboard_123"
      userRole="investor"
      onSave={() => console.log('Dashboard saved')}
    />
  );
}
```

### Creating New Dashboards

```typescript
import { useDashboardState } from '@/hooks/useDashboardState';

function CreateDashboard() {
  const { createNewDashboard, dashboard } = useDashboardState();

  const handleCreate = async () => {
    const newDash = await createNewDashboard('My Dashboard');
    // Dashboard is now ready for editing
  };

  return <button onClick={handleCreate}>Create Dashboard</button>;
}
```

### Adding Real-Time Updates

```typescript
import { useWidgetRealtimeUpdates } from '@/hooks/useWidgetRealtimeUpdates';

function RealtimeWidget({ widgetId }) {
  const { widgetUpdates, subscribe } = useWidgetRealtimeUpdates('dashboard_123');

  useEffect(() => {
    subscribe(widgetId, 'market-trends');
  }, [widgetId]);

  const data = widgetUpdates[widgetId];
  return <div>{data?.price}</div>;
}
```

## Performance Considerations

### Optimization Strategies

1. **Lazy Loading**: Widgets only render when visible
2. **Virtualization**: Large lists are virtualized for performance
3. **Caching**: Dashboard configs cached in localStorage
4. **Debouncing**: Layout changes debounced to reduce saves
5. **Throttling**: Real-time updates throttled by widget type

### Best Practices

- Limit widgets per dashboard to 8-10 for optimal performance
- Use time range filters to reduce data volume
- Disable real-time updates for historical data widgets
- Archive old dashboards to keep the list manageable

## Accessibility

The dashboard implements WCAG 2.1 AA compliance:

- **Keyboard Navigation**: Full support for keyboard-only users
- **Screen Reader Support**: Proper ARIA labels on all interactive elements
- **Color Contrast**: Meets WCAG AA standards
- **Focus Management**: Clear focus indicators and logical tab order
- **Resize Handles**: Large enough for reliable mouse/touch interaction

## Troubleshooting

### Dashboard Not Loading

1. Check browser console for errors
2. Verify API connectivity
3. Clear browser cache and reload
4. Check localStorage space availability

### Real-Time Updates Not Working

1. Verify WebSocket connection in DevTools
2. Check browser firewall/proxy settings
3. Ensure Socket.io server is running
4. Restart browser to reset connection

### Layout Changes Not Saving

1. Check network tab for failed requests
2. Verify user authentication
3. Check for localStorage quota exceeded
4. Try clearing cache and re-saving

## Future Enhancements

- Custom widget creation framework
- Advanced filtering and search
- Collaborative editing (multiple users)
- Widget data export (CSV, PDF)
- Scheduled reports
- Mobile app integration
- AI-powered widget recommendations

## Support

For issues or questions:
1. Check this documentation
2. Review browser console errors
3. Contact support with dashboard ID
4. Submit feature requests via feedback form
