'use client';

import React, { useState, useEffect } from 'react';
import { MilestoneTimeline } from './MilestoneTimeline';
import { MilestoneComments } from './MilestoneComments';
import { MilestoneVerification } from './MilestoneVerification';
import { useMilestoneRealtime } from '@/hooks/useMilestoneRealtime';

interface CollaborativeMilestoneDetailProps {
  dealId: string;
  userId: string;
  userRole: string;
}

export const CollaborativeMilestoneDetail: React.FC<CollaborativeMilestoneDetailProps> = ({
  dealId,
  userId,
  userRole,
}) => {
  const [milestones, setMilestones] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);

  // Fetch milestone history
  useEffect(() => {
    const fetchMilestones = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/v1/shipments/deals/${dealId}/history`, {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
        });

        if (!res.ok) throw new Error('Failed to load milestones');

        const data = await res.json();
        setMilestones(Array.isArray(data) ? data : []);
        setError(null);

        // Set first milestone as selected
        if (data.length > 0 && data[0].milestone) {
          setSelectedMilestoneId(data[0].milestone.id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load milestones');
      } finally {
        setLoading(false);
      }
    };

    fetchMilestones();
  }, [dealId]);

  // Real-time updates
  const { connected } = useMilestoneRealtime({
    dealId,
    userId,
    onMilestoneUpdate: (data) => {
      console.log('Milestone updated:', data);
      // Refetch to get latest data
      window.location.reload();
    },
    onCommentAdded: (data) => {
      console.log('Comment added:', data);
    },
    onVerificationAdded: (data) => {
      console.log('Verification added:', data);
    },
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading milestone data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <p className="text-red-800 font-medium">{error}</p>
      </div>
    );
  }

  const timelineEvents = milestones.map((m) => ({
    id: m.milestone?.id || '',
    milestone: m.milestone?.milestone || '',
    recordedAt: m.milestone?.recordedAt || '',
    recordedBy: m.milestone?.recordedBy || '',
    status: m.milestone ? 'completed' : 'pending',
    verifications: m.verifications?.length || 0,
    comments: m.comments?.length || 0,
  }));

  const selectedMilestone = milestones.find((m) => m.milestone?.id === selectedMilestoneId);

  return (
    <div className="space-y-6">
      {/* Connection indicator */}
      <div className="flex items-center gap-2 text-sm">
        <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-300'}`} />
        <span className="text-gray-600">
          {connected ? 'Real-time updates active' : 'Offline mode'}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-6">Shipment Progress</h2>
            <MilestoneTimeline
              events={timelineEvents}
              loading={loading}
            />
          </div>
        </div>

        {/* Milestone analytics summary */}
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <h3 className="font-semibold text-gray-900 text-sm mb-4">Summary</h3>

            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-500">Completion Rate</p>
                <p className="text-2xl font-bold text-gray-900">
                  {Math.round((timelineEvents.filter(e => e.status === 'completed').length / 4) * 100)}%
                </p>
              </div>

              <div className="pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-500">Verifications</p>
                <p className="text-lg font-semibold text-gray-900">
                  {timelineEvents.reduce((sum, e) => sum + e.verifications, 0)} total
                </p>
              </div>

              <div className="pt-3 border-t border-gray-200">
                <p className="text-xs text-gray-500">Collaboration</p>
                <p className="text-lg font-semibold text-gray-900">
                  {timelineEvents.reduce((sum, e) => sum + e.comments, 0)} comments
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Collaboration details */}
      {selectedMilestone && selectedMilestoneId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <MilestoneComments milestoneId={selectedMilestoneId} />
          <MilestoneVerification
            milestoneId={selectedMilestoneId}
            canVerify={userRole !== 'trader'}
          />
        </div>
      )}
    </div>
  );
};
