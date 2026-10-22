'use client';

import React, { useState } from 'react';
import { DashboardState } from '@/types/dashboard';
import { DashboardService } from '@/lib/dashboardService';

interface DashboardMenuProps {
  dashboard: DashboardState;
  onEditClick?: () => void;
}

export function DashboardMenu({ dashboard, onEditClick }: DashboardMenuProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shareEmail, setShareEmail] = useState('');
  const [sharePermission, setSharePermission] = useState<'view' | 'edit'>('view');
  const [sharing, setSharing] = useState(false);
  const [shareStatus, setShareStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleShare = async () => {
    if (!shareEmail.trim()) return;

    try {
      setSharing(true);
      setShareStatus('idle');
      // Note: In production, convert email to userId via API
      await DashboardService.shareDashboard(dashboard.id, [shareEmail], sharePermission);
      setShareStatus('success');
      setShareEmail('');
      setTimeout(() => {
        setShareStatus('idle');
        setShowShareModal(false);
      }, 2000);
    } catch (err) {
      setShareStatus('error');
      console.error('Failed to share dashboard:', err);
    } finally {
      setSharing(false);
    }
  };

  const handleDownload = () => {
    const dataStr = JSON.stringify(dashboard, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${dashboard.name}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setShowMenu(false);
  };

  return (
    <>
      {/* Menu Button */}
      <div className="relative">
        <button
          onClick={() => setShowMenu(!showMenu)}
          className="px-3 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
        >
          ⋮
        </button>

        {/* Dropdown Menu */}
        {showMenu && (
          <div className="absolute right-0 mt-1 w-48 bg-white rounded-lg border border-slate-200 shadow-lg z-50">
            <button
              onClick={() => {
                onEditClick?.();
                setShowMenu(false);
              }}
              className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-b border-slate-200"
            >
              ✏️ Edit
            </button>
            <button
              onClick={() => {
                setShowShareModal(true);
                setShowMenu(false);
              }}
              className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-b border-slate-200"
            >
              🔗 Share
            </button>
            <button
              onClick={handleDownload}
              className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-b border-slate-200"
            >
              ⬇️ Download Config
            </button>
            <button
              onClick={() => {
                setShowMenu(false);
              }}
              className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              🗑️ Delete
            </button>
          </div>
        )}
      </div>

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full space-y-4">
            <h3 className="text-lg font-semibold text-slate-900">Share Dashboard</h3>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  value={shareEmail}
                  onChange={(e) => setShareEmail(e.target.value)}
                  placeholder="user@example.com"
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Permission
                </label>
                <select
                  value={sharePermission}
                  onChange={(e) => setSharePermission(e.target.value as 'view' | 'edit')}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                >
                  <option value="view">View Only</option>
                  <option value="edit">Can Edit</option>
                </select>
              </div>

              {shareStatus === 'success' && (
                <div className="p-3 bg-green-50 border border-green-200 rounded text-sm text-green-800">
                  Dashboard shared successfully!
                </div>
              )}
              {shareStatus === 'error' && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                  Failed to share dashboard
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end pt-4 border-t border-slate-200">
              <button
                onClick={() => setShowShareModal(false)}
                className="px-4 py-2 text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleShare}
                disabled={sharing || !shareEmail.trim()}
                className="px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors disabled:opacity-50"
              >
                {sharing ? 'Sharing...' : 'Share'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
