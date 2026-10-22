'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { getStoredToken } from '@/lib/api';
import {
  CollaborationResourceType,
  Collaborator,
  CURSOR_SEND_MS,
  CURSOR_TTL_MS,
  RemoteCursor,
} from '@/lib/collaboration';

interface UseCollaborationOptions {
  displayName?: string;
  avatarUrl?: string;
  enabled?: boolean;
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

interface CollaborationState {
  connected: boolean;
  participants: Collaborator[];
  cursors: RemoteCursor[];
  typingUsers: string[];
  selfUserId: string | null;
  hidden: boolean;
  sendCursor: (x: number, y: number) => void;
  setTyping: (isTyping: boolean) => void;
  setPresenceVisible: (visible: boolean) => void;
}

/** Decodes the `sub` claim from the stored access token (no verification). */
function readSelfUserId(): string | null {
  if (typeof window === 'undefined') return null;
  const token = getStoredToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(
      atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    return (payload?.sub as string) ?? null;
  } catch {
    return null;
  }
}

export function useCollaboration(
  resourceType: CollaborationResourceType,
  resourceId: string,
  options: UseCollaborationOptions = {},
): CollaborationState {
  const {
    displayName,
    avatarUrl,
    enabled = true,
    onCollaboratorJoined,
    onCollaboratorLeft,
  } = options;

  const socketRef = useRef<Socket | null>(null);
  const lastCursorSent = useRef(0);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const callbacks = useRef({ onCollaboratorJoined, onCollaboratorLeft });
  callbacks.current = { onCollaboratorJoined, onCollaboratorLeft };

  const selfUserId = useMemo(readSelfUserId, []);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<Collaborator[]>([]);
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({});
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!enabled || !resourceId || typeof window === 'undefined') return;

    const token = getStoredToken();
    if (!token) return;

    const socket = io('/collaboration', {
      auth: { token },
      transports: ['websocket'],
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_room', {
        resourceType,
        resourceId,
        displayName,
        avatarUrl,
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on(
      'presence_update',
      (payload: { users?: Collaborator[] }) =>
        setParticipants(payload?.users ?? []),
    );

    socket.on('cursor_update', (payload: RemoteCursor) => {
      if (!payload || payload.userId === selfUserId) return;
      setCursors((prev) => ({
        ...prev,
        [payload.userId]: { ...payload, updatedAt: Date.now() },
      }));
    });

    socket.on(
      'user_typing',
      (payload: { userId: string; displayName: string; isTyping: boolean }) => {
        if (!payload || payload.userId === selfUserId) return;
        setTypingUsers((prev) => {
          const without = prev.filter((id) => id !== payload.userId);
          return payload.isTyping ? [...without, payload.userId] : without;
        });
        if (typingTimers.current[payload.userId]) {
          clearTimeout(typingTimers.current[payload.userId]);
          delete typingTimers.current[payload.userId];
        }
        if (payload.isTyping) {
          typingTimers.current[payload.userId] = setTimeout(() => {
            setTypingUsers((prev) =>
              prev.filter((id) => id !== payload.userId),
            );
          }, 4000);
        }
      },
    );

    socket.on('collaborator_joined', (payload: any) => {
      if (payload?.user?.userId && payload.user.userId !== selfUserId) {
        callbacks.current.onCollaboratorJoined?.(payload.user);
      }
    });
    socket.on('collaborator_left', (payload: any) => {
      if (payload?.userId && payload.userId !== selfUserId) {
        setCursors((prev) => {
          const next = { ...prev };
          delete next[payload.userId];
          return next;
        });
        callbacks.current.onCollaboratorLeft?.({
          userId: payload.userId,
          displayName: payload.displayName,
        });
      }
    });

    // Heartbeat so the server can distinguish active from idle.
    const ping = setInterval(() => {
      socket.emit('activity_ping', { resourceType, resourceId });
    }, 30000);

    // Evict cursors that stop updating.
    const evict = setInterval(() => {
      setCursors((prev) => {
        const now = Date.now();
        const next: Record<string, RemoteCursor> = {};
        let changed = false;
        for (const [userId, cursor] of Object.entries(prev)) {
          if (now - cursor.updatedAt < CURSOR_TTL_MS) {
            next[userId] = cursor;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 2000);

    return () => {
      clearInterval(ping);
      clearInterval(evict);
      Object.values(typingTimers.current).forEach(clearTimeout);
      typingTimers.current = {};
      socket.emit('leave_room', { resourceType, resourceId });
      socket.disconnect();
      socketRef.current = null;
    };
    // Reconnect when the target resource changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceType, resourceId, enabled, selfUserId]);

  const sendCursor = useCallback(
    (x: number, y: number) => {
      const socket = socketRef.current;
      if (!socket || !connected) return;
      const now = Date.now();
      if (now - lastCursorSent.current < CURSOR_SEND_MS) return;
      lastCursorSent.current = now;
      socket.emit('cursor_move', { resourceType, resourceId, x, y });
    },
    [connected, resourceType, resourceId],
  );

  const setTyping = useCallback(
    (isTyping: boolean) => {
      socketRef.current?.emit('typing', { resourceType, resourceId, isTyping });
    },
    [resourceType, resourceId],
  );

  const setPresenceVisible = useCallback(
    (visible: boolean) => {
      setHidden(!visible);
      socketRef.current?.emit('set_presence_visibility', {
        resourceType,
        resourceId,
        visible,
      });
    },
    [resourceType, resourceId],
  );

  return {
    connected,
    participants,
    cursors: Object.values(cursors),
    typingUsers,
    selfUserId,
    hidden,
    sendCursor,
    setTyping,
    setPresenceVisible,
  };
}
