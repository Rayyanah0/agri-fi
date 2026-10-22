import { Injectable } from '@nestjs/common';
import { CollaborationResourceType } from './entities/collaboration-session.entity';

/** Idle after this many ms without a cursor move / activity ping. */
export const PRESENCE_IDLE_MS = parseInt(
  process.env.PRESENCE_IDLE_MS ?? '90000',
  10,
);

export type PresenceStatus = 'active' | 'idle' | 'typing';

export interface PresenceEntry {
  socketId: string;
  sessionId: string;
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  color: string;
  status: PresenceStatus;
  lastSeen: number;
  hidden: boolean;
  cursor: { x: number; y: number } | null;
  cursorUpdates: number;
  typingEvents: number;
}

export interface PublicPresence {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  role: string;
  color: string;
  status: PresenceStatus;
  hidden: boolean;
  cursor: { x: number; y: number } | null;
}

const PALETTE = [
  '#2563eb',
  '#dc2626',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#db2777',
  '#0891b2',
  '#65a30d',
];

/** Deterministic colour so a user keeps the same cursor colour everywhere. */
export function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

/**
 * In-memory registry of who is currently viewing which resource.
 *
 * Presence is deliberately ephemeral — it is rebuilt as sockets connect. Durable
 * history lives in `collaboration_sessions`. For multi-replica deployments the
 * gateway uses the socket.io Redis adapter so broadcasts fan out across pods;
 * this registry remains per-instance and is reconciled through the adapter's
 * presence broadcasts.
 */
@Injectable()
export class PresenceService {
  /** roomKey -> socketId -> entry */
  private readonly rooms = new Map<string, Map<string, PresenceEntry>>();

  static roomKey(
    resourceType: CollaborationResourceType,
    resourceId: string,
  ): string {
    return `${resourceType}:${resourceId}`;
  }

  join(roomKey: string, entry: PresenceEntry): void {
    let room = this.rooms.get(roomKey);
    if (!room) {
      room = new Map();
      this.rooms.set(roomKey, room);
    }
    room.set(entry.socketId, entry);
  }

  get(roomKey: string, socketId: string): PresenceEntry | undefined {
    return this.rooms.get(roomKey)?.get(socketId);
  }

  remove(roomKey: string, socketId: string): PresenceEntry | undefined {
    const room = this.rooms.get(roomKey);
    if (!room) return undefined;
    const entry = room.get(socketId);
    room.delete(socketId);
    if (room.size === 0) this.rooms.delete(roomKey);
    return entry;
  }

  /** Removes a socket from every room; returns the rooms it was in. */
  removeEverywhere(socketId: string): Array<{ roomKey: string; entry: PresenceEntry }> {
    const removed: Array<{ roomKey: string; entry: PresenceEntry }> = [];
    for (const [roomKey, room] of this.rooms.entries()) {
      const entry = room.get(socketId);
      if (entry) {
        room.delete(socketId);
        removed.push({ roomKey, entry });
        if (room.size === 0) this.rooms.delete(roomKey);
      }
    }
    return removed;
  }

  touch(roomKey: string, socketId: string, status: PresenceStatus = 'active'): PresenceEntry | undefined {
    const entry = this.rooms.get(roomKey)?.get(socketId);
    if (!entry) return undefined;
    entry.lastSeen = Date.now();
    entry.status = status;
    return entry;
  }

  setCursor(roomKey: string, socketId: string, x: number, y: number): PresenceEntry | undefined {
    const entry = this.rooms.get(roomKey)?.get(socketId);
    if (!entry) return undefined;
    entry.cursor = { x, y };
    entry.cursorUpdates += 1;
    entry.lastSeen = Date.now();
    entry.status = 'active';
    return entry;
  }

  setTyping(roomKey: string, socketId: string, isTyping: boolean): PresenceEntry | undefined {
    const entry = this.rooms.get(roomKey)?.get(socketId);
    if (!entry) return undefined;
    entry.typingEvents += 1;
    entry.lastSeen = Date.now();
    entry.status = isTyping ? 'typing' : 'active';
    return entry;
  }

  setHidden(roomKey: string, socketId: string, hidden: boolean): PresenceEntry | undefined {
    const entry = this.rooms.get(roomKey)?.get(socketId);
    if (!entry) return undefined;
    entry.hidden = hidden;
    return entry;
  }

  /** Marks stale entries idle. Returns the entries whose status changed. */
  sweepIdle(now = Date.now()): Array<{ roomKey: string; entry: PresenceEntry }> {
    const changed: Array<{ roomKey: string; entry: PresenceEntry }> = [];
    for (const [roomKey, room] of this.rooms.entries()) {
      for (const entry of room.values()) {
        if (entry.status !== 'idle' && now - entry.lastSeen > PRESENCE_IDLE_MS) {
          entry.status = 'idle';
          changed.push({ roomKey, entry });
        }
      }
    }
    return changed;
  }

  /**
   * Presence visible to `viewerId`, de-duplicated by user (a user with several
   * tabs appears once) and filtered by privacy (`hidden`) and permissions.
   */
  list(roomKey: string, options: { includeHidden?: boolean } = {}): PublicPresence[] {
    const room = this.rooms.get(roomKey);
    if (!room) return [];

    const byUser = new Map<string, PresenceEntry>();
    for (const entry of room.values()) {
      if (entry.hidden && !options.includeHidden) continue;
      const existing = byUser.get(entry.userId);
      // Prefer an active/typing socket over an idle one.
      if (!existing || rank(entry.status) < rank(existing.status)) {
        byUser.set(entry.userId, entry);
      }
    }

    return Array.from(byUser.values()).map((entry) => ({
      userId: entry.userId,
      displayName: entry.displayName,
      avatarUrl: entry.avatarUrl,
      role: entry.role,
      color: entry.color,
      status: entry.status,
      hidden: entry.hidden,
      cursor: entry.cursor,
    }));
  }

  userIdsIn(roomKey: string): string[] {
    const room = this.rooms.get(roomKey);
    if (!room) return [];
    return Array.from(new Set(Array.from(room.values()).map((e) => e.userId)));
  }

  socketIdsIn(roomKey: string, excludeSocketId?: string): string[] {
    const room = this.rooms.get(roomKey);
    if (!room) return [];
    return Array.from(room.keys()).filter((id) => id !== excludeSocketId);
  }

  currentCount(roomKey: string): number {
    return this.rooms.get(roomKey)?.size ?? 0;
  }

  clear(): void {
    this.rooms.clear();
  }
}

function rank(status: PresenceStatus): number {
  switch (status) {
    case 'typing':
      return 0;
    case 'active':
      return 1;
    default:
      return 2;
  }
}
