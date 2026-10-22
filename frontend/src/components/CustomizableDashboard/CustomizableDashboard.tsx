'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useDashboardState } from '@/hooks/useDashboardState';
import { DashboardService } from '@/lib/dashboardService';
import { WidgetConfig, DashboardPreset, UserRole } from '@/types/dashboard';
import { DashboardGrid } from './DashboardGrid';
import { WidgetRenderer } from './WidgetRenderer';
import { WidgetLibrary } from './WidgetLibrary';
import { DashboardMenu } from './DashboardMenu';

interface CustomizableDashboardProps {
  initialDashboardId?: string;
  userRole?: UserRole;
  onSave?: () => void;
}

export function CustomizableDashboard({
  initialDashboardId,
  userRole,
  onSave,
}: CustomizableDashboardProps) {
  const t = useTranslations();
  const {
    dashboard,
    loading,
    error,
    addWidget,
    removeWidget,
    updateLayout,
    saveDashboard,
    loadDashboard,
    createNewDashboard,
    applyPreset,
  } = useDashboardState(initialDashboardId);

  const [isEditing, setIsEditing] = useState(!initialDashboardId);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [presets, setPresets] = useState<DashboardPreset[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  // Load presets on mount
  useEffect(() => {
    (async () => {
      const loaded = await DashboardService.getPresets();
      setPresets(loaded);
    })();
  }, []);

  // Handle widget addition
  const handleAddWidget = useCallback((widgetType: string) => {
    if (!dashboard) return;

    const newWidget: WidgetConfig = {
      id: `widget_${Date.now()}`,
      type: widgetType as any,
      position: { x: 0, y: 0 },
      size: { w: 4, h: 3 },
    };

    addWidget(newWidget);
    setShowLibrary(false);

    // Track widget addition
    DashboardService.trackWidgetInteraction(dashboard.id, newWidget.id, widgetType);
  }, [dashboard, addWidget]);

  // Handle layout change
  const handleLayoutChange = useCallback((widgets: WidgetConfig[]) => {
    updateLayout(widgets);
  }, [updateLayout]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!dashboard) return;

    try {
      setSaving(true);
      setSaveStatus('idle');
      await saveDashboard();
      setSaveStatus('success');
      setIsEditing(false);
      onSave?.();
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      setSaveStatus('error');
      console.error('Failed to save dashboard:', err);
    } finally {
      setSaving(false);
    }
  }, [dashboard, saveDashboard, onSave]);

  // Handle preset application
  const handleApplyPreset = useCallback(async (presetId: string) => {
    try {
      await applyPreset(presetId);
      setShowTemplates(false);
    } catch (err) {
      console.error('Failed to apply preset:', err);
    }
  }, [applyPreset]);

  // Apply default preset if new dashboard
  useEffect(() => {
    if (!initialDashboardId && dashboard && dashboard.widgets.length === 0 && presets.length > 0 && userRole) {
      const rolePreset = presets.find(p => p.role === userRole && p.isDefault);
      if (rolePreset) {
        handleApplyPreset(rolePreset.id);
      }
    }
  }, [initialDashboardId, dashboard, presets, userRole, handleApplyPreset]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600" />
      </div>
    );
  }

  if (error && !dashboard) {
    return (
      <div className="rounded-lg bg-red-50 p-4 border border-red-200">
        <p className="text-sm text-red-800 font-medium">Error loading dashboard</p>
        <p className="text-sm text-red-700 mt-1">{error}</p>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="rounded-lg bg-slate-50 p-8 text-center border border-slate-200">
        <p className="text-slate-600">No dashboard found</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header with Controls */}
      <div className="flex items-center justify-between p-4 bg-white rounded-lg border border-slate-200">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{dashboard.name}</h1>
          {isEditing && (
            <p className="text-sm text-slate-500 mt-1">Edit mode - Drag to move, resize handle to adjust size</p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {isEditing ? (
            <>
              <button
                onClick={() => setShowLibrary(!showLibrary)}
                className="px-4 py-2 bg-slate-100 text-slate-900 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium"
              >
                + Add Widget
              </button>
              <button
                onClick={() => setShowTemplates(!showTemplates)}
                className="px-4 py-2 bg-slate-100 text-slate-900 rounded-lg hover:bg-slate-200 transition-colors text-sm font-medium"
              >
                Templates
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors text-sm font-medium disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="px-4 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors text-sm font-medium"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <DashboardMenu dashboard={dashboard} onEditClick={() => setIsEditing(true)} />
              <button
                onClick={() => setIsEditing(true)}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors text-sm font-medium"
              >
                Edit
              </button>
            </>
          )}
        </div>
      </div>

      {/* Status Messages */}
      {saveStatus === 'success' && (
        <div className="rounded-lg bg-green-50 p-3 border border-green-200 text-sm text-green-800">
          Dashboard saved successfully
        </div>
      )}
      {saveStatus === 'error' && (
        <div className="rounded-lg bg-red-50 p-3 border border-red-200 text-sm text-red-800">
          Failed to save dashboard
        </div>
      )}

      {/* Widget Library */}
      {isEditing && showLibrary && (
        <WidgetLibrary onSelectWidget={handleAddWidget} />
      )}

      {/* Template Selection */}
      {isEditing && showTemplates && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <h3 className="font-semibold text-slate-900 mb-3">Dashboard Templates</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {presets.map(preset => (
              <button
                key={preset.id}
                onClick={() => handleApplyPreset(preset.id)}
                className="p-3 border border-slate-200 rounded-lg hover:border-brand-400 hover:bg-brand-50 transition-all text-left"
              >
                <p className="font-medium text-slate-900 text-sm">{preset.name}</p>
                {preset.description && (
                  <p className="text-xs text-slate-600 mt-1">{preset.description}</p>
                )}
                <p className="text-xs text-slate-500 mt-2">{preset.widgets.length} widgets</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Dashboard Grid */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {dashboard.widgets.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-slate-500 mb-4">No widgets added yet</p>
            {isEditing && (
              <button
                onClick={() => setShowLibrary(true)}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors"
              >
                Add Your First Widget
              </button>
            )}
          </div>
        ) : (
          <DashboardGrid
            widgets={dashboard.widgets}
            onLayoutChange={handleLayoutChange}
            renderWidget={(widget) => <WidgetRenderer widget={widget} />}
            onRemoveWidget={isEditing ? removeWidget : undefined}
            editable={isEditing}
          />
        )}
      </div>
    </div>
  );
}
