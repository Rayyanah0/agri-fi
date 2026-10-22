'use client';

import React from 'react';
import { Collaborator, statusLabel } from '@/lib/collaboration';

interface ActivityStatusProps {
  participants: Collaborator[];
  typingUsers: string[];
  selfUserId?: string | null;
}

/**
 * Compact activity summary: who is typing right now and how many collaborators
 * have gone idle (#1234 — activity status).
 */
export function ActivityStatus({
  participants,
  typingUsers,
  selfUserId,
}: ActivityStatusProps) {
  const nameFor = (userId: string) =>
    participants.find((p) => p.userId === userId)?.displayName ?? 'Someone';

  const others = typingUsers.filter((id) => id !== selfUserId);
  const idleCount = participants.filter(
    (p) => p.status === 'idle' && p.userId !== selfUserId,
  ).length;

  if (others.length === 0 && idleCount === 0) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500"
      aria-live="polite"
    >
      {others.length > 0 && (
        <span className="inline-flex items-center gap-1.5 text-amber-600 font-medium">
          <span className="flex gap-0.5">
            <span className="w-1 h-1 rounded-full bg-amber-500 animate-bounce [animation-delay:-0.2s]" />
            <span className="w-1 h-1 rounded-full bg-amber-500 animate-bounce [animation-delay:-0.1s]" />
            <span className="w-1 h-1 rounded-full bg-amber-500 animate-bounce" />
          </span>
          {others.map(nameFor).join(', ')}
          {others.length === 1 ? ' is typing…' : ' are typing…'}
        </span>
      )}
      {idleCount > 0 && (
        <span className="text-slate-400">
          {idleCount} idle ({statusLabel('idle')})
        </span>
      )}
    </div>
  );
}

export default ActivityStatus;
