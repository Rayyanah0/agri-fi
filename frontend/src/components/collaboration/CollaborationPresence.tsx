'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import { apiClient } from '@/lib/api';
import { CollaborationResourceType } from '@/lib/collaboration';
import { useCollaboration } from '@/hooks/useCollaboration';
import { useToast } from '@/components/ui/ToastProvider';
import { PresenceBar } from './PresenceBar';
import { LiveCursors } from './LiveCursors';
import { ActivityStatus } from './ActivityStatus';

interface CollaborationPresenceProps {
  resourceType: CollaborationResourceType;
  resourceId: string;
  /** Where to render content (the wrapper renders the presence bar above it). */
  children?: React.ReactNode;
  /** Track pointer movement to broadcast this user's cursor. */
  trackCursor?: boolean;
  className?: string;
  onCollaboratorJoined?: (user: {
    userId: string;
    displayName: string;
    color: string;
  }) => void;
  onCollaboratorLeft?: (user: {
    userId: string;
    displayName: string;
  }) => void;
}

/**
 * Drop-in real-time collaboration surface (#1234): presence avatars, live
 * cursors, typing/activity status and join/leave notifications. Wrap any
 * deal/document view with it.
 */
export function CollaborationPresence({
  resourceType,
  resourceId,
  children,
  trackCursor = true,
  className,
  onCollaboratorJoined,
  onCollaboratorLeft,
}: CollaborationPresenceProps) {
  const { toast } = useToast();
  const user = apiClient.getCurrentUser();
  const displayName = user?.name || user?.email?.split('@')[0];
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleJoined = useCallback(
    (collaborator: { userId: string; displayName: string; color: string }) => {
      toast(`${collaborator.displayName} joined`, 'info', 3000);
      onCollaboratorJoined?.(collaborator);
    },
    [onCollaboratorJoined, toast],
  );

  const handleLeft = useCallback(
    (collaborator: { userId: string; displayName: string }) => {
      toast(`${collaborator.displayName} left`, 'info', 3000);
      onCollaboratorLeft?.(collaborator);
    },
    [onCollaboratorLeft, toast],
  );

  const {
    connected,
    participants,
    cursors,
    typingUsers,
    selfUserId,
    hidden,
    sendCursor,
    setTyping,
    setPresenceVisible,
  } = useCollaboration(resourceType, resourceId, {
    displayName,
    onCollaboratorJoined: handleJoined,
    onCollaboratorLeft: handleLeft,
  });

  useEffect(() => {
    if (!trackCursor) return;
    const onMove = (event: PointerEvent) => {
      const x = event.clientX / Math.max(window.innerWidth, 1);
      const y = event.clientY / Math.max(window.innerHeight, 1);
      sendCursor(
        Math.min(Math.max(x, 0), 1),
        Math.min(Math.max(y, 0), 1),
      );
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [trackCursor, sendCursor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && !target?.isContentEditable) {
        return;
      }
      setTyping(true);
      if (typingTimer.current) clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTyping(false), 2000);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, [setTyping]);

  return (
    <div className={className}>
      <div className="space-y-2">
        <PresenceBar
          participants={participants}
          selfUserId={selfUserId}
          hidden={hidden}
          onToggleVisibility={setPresenceVisible}
          connected={connected}
        />
        <ActivityStatus
          participants={participants}
          typingUsers={typingUsers}
          selfUserId={selfUserId}
        />
      </div>
      {children}
      {trackCursor && <LiveCursors cursors={cursors} />}
    </div>
  );
}

export default CollaborationPresence;
