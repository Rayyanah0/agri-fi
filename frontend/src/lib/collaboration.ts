export type CollaborationResourceType = 'deal' | 'document';

export type PresenceStatus = 'active' | 'idle' | 'typing';

export interface Collaborator {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  color: string;
  status: PresenceStatus;
  hidden: boolean;
  cursor: { x: number; y: number } | null;
}

export interface RemoteCursor {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  color: string;
  x: number;
  y: number;
  updatedAt: number;
}

export interface CollaboratorEvent {
  resourceType: CollaborationResourceType;
  resourceId: string;
  user?: Collaborator;
  userId?: string;
  displayName?: string;
}

/** How long a remote cursor remains on screen without an update. */
export const CURSOR_TTL_MS = 6000;

/** Client-side cursor broadcast throttle (server also throttles). */
export const CURSOR_SEND_MS = 50;

export const PRESENCE_COLORS = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#65a30d',
];

/** Mirrors the backend `colorForUser` so cursors keep a stable colour. */
export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return PRESENCE_COLORS[Math.abs(hash) % PRESENCE_COLORS.length];
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function statusLabel(status: PresenceStatus): string {
  switch (status) {
    case 'typing':
      return 'typing…';
    case 'idle':
      return 'idle';
    default:
      return 'active';
  }
}
