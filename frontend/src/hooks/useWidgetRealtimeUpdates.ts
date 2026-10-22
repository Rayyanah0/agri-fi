import { useEffect, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { WidgetConfig } from '@/types/dashboard';

interface WidgetUpdate {
  widgetId: string;
  data: any;
  timestamp: string;
}

interface UseWidgetRealtimeUpdatesReturn {
  widgetUpdates: Record<string, any>;
  connected: boolean;
  subscribe: (widgetId: string, widgetType: string) => void;
  unsubscribe: (widgetId: string) => void;
}

let socket: Socket | null = null;

export function useWidgetRealtimeUpdates(
  dashboardId: string,
): UseWidgetRealtimeUpdatesReturn {
  const [widgetUpdates, setWidgetUpdates] = useState<Record<string, any>>({});
  const [connected, setConnected] = useState(false);
  const [subscribedWidgets, setSubscribedWidgets] = useState<Set<string>>(new Set());

  useEffect(() => {
    // Initialize socket connection
    if (!socket) {
      socket = io({
        path: '/socket.io',
        transports: ['websocket', 'polling'],
      });

      socket.on('connect', () => {
        setConnected(true);
        console.debug('Dashboard socket connected');
      });

      socket.on('disconnect', () => {
        setConnected(false);
        console.debug('Dashboard socket disconnected');
      });

      // Listen for widget updates
      socket.on('widget-update', (update: WidgetUpdate) => {
        setWidgetUpdates(prev => ({
          ...prev,
          [update.widgetId]: update.data,
        }));
      });

      // Listen for batch updates
      socket.on('dashboard-update', (updates: WidgetUpdate[]) => {
        const newUpdates = { ...widgetUpdates };
        updates.forEach(update => {
          newUpdates[update.widgetId] = update.data;
        });
        setWidgetUpdates(newUpdates);
      });

      socket.on('error', (error) => {
        console.error('Socket error:', error);
      });
    }

    return () => {
      // Note: We keep the socket alive across hook unmounts
      // This prevents reconnection overhead
    };
  }, []);

  const subscribe = useCallback((widgetId: string, widgetType: string) => {
    if (!socket || socket.disconnected) {
      console.warn('Socket not connected, cannot subscribe');
      return;
    }

    socket.emit('subscribe-widget', {
      dashboardId,
      widgetId,
      widgetType,
    });

    setSubscribedWidgets(prev => new Set([...prev, widgetId]));
  }, [dashboardId]);

  const unsubscribe = useCallback((widgetId: string) => {
    if (!socket) return;

    socket.emit('unsubscribe-widget', {
      dashboardId,
      widgetId,
    });

    setSubscribedWidgets(prev => {
      const next = new Set(prev);
      next.delete(widgetId);
      return next;
    });
  }, [dashboardId]);

  return {
    widgetUpdates,
    connected,
    subscribe,
    unsubscribe,
  };
}
