import { useEffect, useCallback, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

export interface MilestoneUpdate {
  milestone: string;
  recordedAt: string;
  recordedBy: string;
}

export interface CommentUpdate {
  id: string;
  content: string;
  userDisplayName: string;
  createdAt: string;
}

export interface VerificationUpdate {
  id: string;
  status: 'verified' | 'rejected';
  verifierRole: string;
  verifiedAt: string;
}

interface UseMilestoneRealtimeOptions {
  dealId: string;
  userId: string;
  onMilestoneUpdate?: (data: MilestoneUpdate) => void;
  onCommentAdded?: (data: CommentUpdate) => void;
  onVerificationAdded?: (data: VerificationUpdate) => void;
}

export const useMilestoneRealtime = ({
  dealId,
  userId,
  onMilestoneUpdate,
  onCommentAdded,
  onVerificationAdded,
}: UseMilestoneRealtimeOptions) => {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!dealId || !userId) return;

    // Connect to WebSocket gateway
    const socket = io(
      process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
      {
        namespace: '/milestones',
        auth: {
          token: localStorage.getItem('token'),
        },
        transports: ['websocket'],
      }
    );

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_deal', { dealId, userId });
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('milestone_updated', (data: MilestoneUpdate) => {
      onMilestoneUpdate?.(data);
    });

    socket.on('comment_added', (data: CommentUpdate) => {
      onCommentAdded?.(data);
    });

    socket.on('verification_added', (data: VerificationUpdate) => {
      onVerificationAdded?.(data);
    });

    socketRef.current = socket;

    return () => {
      socket.emit('leave_deal', { dealId, userId });
      socket.disconnect();
    };
  }, [dealId, userId, onMilestoneUpdate, onCommentAdded, onVerificationAdded]);

  return { connected };
};
