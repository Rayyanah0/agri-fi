'use client';

import React from 'react';
import { format } from 'date-fns';

interface TimelineEvent {
  id: string;
  milestone: string;
  recordedAt: string;
  recordedBy: string;
  status: 'completed' | 'pending';
  verifications?: number;
  comments?: number;
}

interface MilestoneTimelineProps {
  events: TimelineEvent[];
  loading?: boolean;
}

export const MilestoneTimeline: React.FC<MilestoneTimelineProps> = ({
  events,
  loading = false,
}) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  const milestoneOrder = ['farm', 'warehouse', 'port', 'importer'];

  return (
    <div className="milestone-timeline">
      <div className="relative">
        {/* Vertical line */}
        <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gray-200" />

        {/* Timeline events */}
        <div className="space-y-6">
          {milestoneOrder.map((milestone, index) => {
            const event = events.find((e) => e.milestone === milestone);

            return (
              <div key={milestone} className="relative pl-24">
                {/* Timeline dot */}
                <div
                  className={`absolute left-0 w-16 h-16 rounded-full flex items-center justify-center -top-2 ${
                    event
                      ? 'bg-green-100 text-green-600 border-4 border-white'
                      : 'bg-gray-100 text-gray-400 border-4 border-white'
                  }`}
                >
                  <span className="text-lg font-bold">{index + 1}</span>
                </div>

                {/* Content card */}
                <div className="bg-white rounded-lg shadow-sm p-4 border border-gray-100">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900 capitalize">
                        {milestone}
                      </h3>
                      {event ? (
                        <>
                          <p className="text-xs text-gray-500 mt-1">
                            {format(new Date(event.recordedAt), 'PPpp')}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            Recorded by {event.recordedBy}
                          </p>
                        </>
                      ) : (
                        <p className="text-xs text-gray-400 mt-1">Pending</p>
                      )}
                    </div>

                    {event && (
                      <div className="flex gap-3">
                        {event.verifications !== undefined && (
                          <div className="text-right">
                            <p className="text-xs font-semibold text-gray-900">
                              {event.verifications}
                            </p>
                            <p className="text-xs text-gray-500">
                              {event.verifications === 1 ? 'Verification' : 'Verifications'}
                            </p>
                          </div>
                        )}
                        {event.comments !== undefined && (
                          <div className="text-right">
                            <p className="text-xs font-semibold text-gray-900">
                              {event.comments}
                            </p>
                            <p className="text-xs text-gray-500">
                              {event.comments === 1 ? 'Comment' : 'Comments'}
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
