'use client';

import React from 'react';
import { Collaborator, initialsFor, statusLabel } from '@/lib/collaboration';

interface PresenceBarProps {
  participants: Collaborator[];
  selfUserId?: string | null;
  hidden?: boolean;
  onToggleVisibility?: (visible: boolean) => void;
  connected?: boolean;
}

function StatusDot({ status }: { status: Collaborator['status'] }) {
  const color =
    status === 'typing'
      ? 'bg-amber-400'
      : status === 'idle'
        ? 'bg-slate-300'
        : 'bg-emerald-500';
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white ${color}`}
    />
  );
}

function Avatar({ user }: { user: Collaborator }) {
  return (
    <span
      className="relative inline-flex items-center justify-center w-7 h-7 rounded-full text-[10px] font-bold text-white ring-2 ring-white"
      style={{ backgroundColor: user.color }}
      title={`${user.displayName} · ${statusLabel(user.status)}`}
    >
      {user.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={user.avatarUrl}
          alt={user.displayName}
          className="w-full h-full rounded-full object-cover"
        />
      ) : (
        initialsFor(user.displayName)
      )}
      <StatusDot status={user.status} />
    </span>
  );
}

/**
 * Shows which users are currently viewing the resource, with avatars and a
 * privacy toggle that lets the current user hide their own presence (#1234).
 */
export function PresenceBar({
  participants,
  selfUserId,
  hidden = false,
  onToggleVisibility,
  connected = true,
}: PresenceBarProps) {
  const others = participants.filter((p) => p.userId !== selfUserId);
  const count = participants.length;

  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white/90 px-3 py-2 shadow-sm backdrop-blur">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-500' : 'bg-slate-300'}`}
          aria-hidden
        />
        <span className="text-xs font-semibold text-slate-600">
          {count === 0
            ? 'No one else here'
            : `${count} viewing${others.length ? ` · ${others.length} collaborator${others.length > 1 ? 's' : ''}` : ''}`}
        </span>
        <div className="flex -space-x-2 ml-1">
          {participants.slice(0, 6).map((user) => (
            <Avatar key={user.userId} user={user} />
          ))}
          {participants.length > 6 && (
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-100 text-[10px] font-bold text-slate-500 ring-2 ring-white">
              +{participants.length - 6}
            </span>
          )}
        </div>
      </div>

      {onToggleVisibility && (
        <button
          type="button"
          onClick={() => onToggleVisibility(hidden)}
          className="text-xs font-medium text-slate-500 hover:text-slate-900 transition-colors"
          aria-pressed={hidden}
          title={hidden ? 'Your presence is hidden' : 'Your presence is visible'}
        >
          {hidden ? '🙈 Hidden' : '👁 Visible'}
        </button>
      )}
    </div>
  );
}

export default PresenceBar;
