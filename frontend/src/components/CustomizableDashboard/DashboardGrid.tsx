'use client';

import React, { useCallback, useState, useRef } from 'react';
import { WidgetConfig } from '@/types/dashboard';
import styles from './DashboardGrid.module.css';

interface DashboardGridProps {
  widgets: WidgetConfig[];
  onLayoutChange: (widgets: WidgetConfig[]) => void;
  renderWidget: (widget: WidgetConfig) => React.ReactNode;
  onRemoveWidget?: (widgetId: string) => void;
  editable?: boolean;
  cols?: number;
  rowHeight?: number;
}

interface DragState {
  widgetId: string;
  startX: number;
  startY: number;
  startPos: { x: number; y: number };
  type: 'move' | 'resize';
}

export function DashboardGrid({
  widgets,
  onLayoutChange,
  renderWidget,
  onRemoveWidget,
  editable = true,
  cols = 12,
  rowHeight = 60,
}: DashboardGridProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const getGridItem = (widgetId: string) => {
    return widgets.find(w => w.id === widgetId);
  };

  const handleMouseDown = useCallback((e: React.MouseEvent, widgetId: string, type: 'move' | 'resize') => {
    if (!editable) return;
    
    e.preventDefault();
    const widget = getGridItem(widgetId);
    if (!widget) return;

    setDragState({
      widgetId,
      startX: e.clientX,
      startY: e.clientY,
      startPos: { x: widget.position.x, y: widget.position.y },
      type,
    });
  }, [widgets, editable]);

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!dragState || !gridRef.current) return;

    const widget = getGridItem(dragState.widgetId);
    if (!widget) return;

    const deltaX = e.clientX - dragState.startX;
    const deltaY = e.clientY - dragState.startY;

    // Calculate cell size (approximation)
    const gridWidth = gridRef.current.clientWidth;
    const cellWidth = gridWidth / cols;
    const cellHeight = rowHeight;

    const deltaGridX = Math.round(deltaX / cellWidth);
    const deltaGridY = Math.round(deltaY / cellHeight);

    let updated = { ...widget };

    if (dragState.type === 'move') {
      updated.position = {
        x: Math.max(0, dragState.startPos.x + deltaGridX),
        y: Math.max(0, dragState.startPos.y + deltaGridY),
      };
    } else if (dragState.type === 'resize') {
      const newW = Math.max(2, widget.size.w + deltaGridX);
      const newH = Math.max(2, widget.size.h + deltaGridY);
      updated.size = { w: newW, h: newH };
    }

    const newWidgets = widgets.map(w => (w.id === dragState.widgetId ? updated : w));
    onLayoutChange(newWidgets);
  }, [dragState, widgets, cols, rowHeight, onLayoutChange]);

  const handleMouseUp = useCallback(() => {
    setDragState(null);
  }, []);

  React.useEffect(() => {
    if (!dragState) return;

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, handleMouseMove, handleMouseUp]);

  // Calculate grid dimensions
  const maxY = widgets.length > 0 
    ? Math.max(...widgets.map(w => w.position.y + w.size.h))
    : 0;
  
  const gridHeight = (maxY + 1) * rowHeight;

  return (
    <div 
      ref={containerRef}
      className={`relative w-full ${styles.dashboardContainer}`}
      style={{ minHeight: `${gridHeight}px` }}
    >
      <div
        ref={gridRef}
        className={`relative w-full ${styles.grid}`}
        style={{
          minHeight: `${gridHeight}px`,
          display: 'grid',
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: '16px',
          padding: '16px',
          background: 'linear-gradient(90deg, rgba(0,0,0,0.02) 1px, transparent 1px)',
          backgroundSize: `${100 / cols}% 100%`,
        }}
      >
        {widgets.map(widget => (
          <div
            key={widget.id}
            className={`${styles.gridItem} ${dragState?.widgetId === widget.id ? styles.dragging : ''}`}
            style={{
              gridColumn: `${widget.position.x + 1} / span ${widget.size.w}`,
              gridRow: `${widget.position.y + 1} / span ${widget.size.h}`,
              cursor: editable ? 'grab' : 'default',
              transition: dragState?.widgetId === widget.id ? 'none' : 'all 0.2s ease',
            }}
            onMouseDown={(e) => handleMouseDown(e, widget.id, 'move')}
          >
            <div className={`${styles.widgetWrapper} relative h-full rounded-lg border border-slate-200 bg-white shadow-sm hover:shadow-md transition-shadow`}>
              {/* Widget Header */}
              {editable && (
                <div className="absolute top-2 right-2 z-10 flex gap-1">
                  {/* Resize handle */}
                  <div
                    className="w-6 h-6 bg-slate-100 hover:bg-slate-200 rounded cursor-se-resize flex items-center justify-center text-xs text-slate-600"
                    onMouseDown={(e) => handleMouseDown(e, widget.id, 'resize')}
                    title="Resize"
                  >
                    ⤡
                  </div>
                  {/* Remove button */}
                  <button
                    className="w-6 h-6 bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-600 rounded text-xs font-bold transition-colors"
                    onClick={() => onRemoveWidget?.(widget.id)}
                    title="Remove widget"
                  >
                    ×
                  </button>
                </div>
              )}

              {/* Widget Content */}
              <div className={`h-full overflow-hidden ${styles.widgetContent}`}>
                {renderWidget(widget)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
