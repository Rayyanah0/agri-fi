import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Interval } from '@nestjs/schedule';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard } from '../notifications/ws-jwt.guard';
import { NotificationsService } from '../notifications/notifications.service';
import { CollaborationService } from './collaboration.service';
import {
  PresenceService,
  colorForUser,
  PresenceEntry,
} from './presence.service';
import { CollaborationResourceType } from './entities/collaboration-session.entity';
import {
  CursorMoveDto,
  JoinRoomDto,
  LeaveRoomDto,
  PresenceVisibilityDto,
  RoomTargetDto,
  TypingDto,
} from './dto/collaboration.dto';

interface AuthedSocket extends Socket {
  data: { user?: { sub: string; email?: string; role?: string } };
}

const CURSOR_THROTTLE_MS = 40;
const ACTIVITY_FLUSH_MS = 30_000;

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: '/collaboration',
})
@UseGuards(WsJwtGuard)
export class CollaborationGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(CollaborationGateway.name);

  @WebSocketServer()
  server: Server;

  /** socketId -> last cursor broadcast timestamp (server-side throttle). */
  private readonly lastCursorAt = new Map<string, number>();

  constructor(
    private readonly collaboration: CollaborationService,
    private readonly presence: PresenceService,
    private readonly notifications: NotificationsService,
    private readonly wsJwtGuard: WsJwtGuard,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      const token = this.wsJwtGuard.extractToken(socket as Socket);
      if (!token) {
        (socket as Socket).disconnect();
        return next(new Error('Unauthorized'));
      }
      try {
        this.wsJwtGuard.verifyAndStore(socket as Socket, token);
        next();
      } catch {
        (socket as Socket).disconnect();
        next(new Error('Unauthorized'));
      }
    });
  }

  handleConnection(client: AuthedSocket): void {
    this.logger.debug(`Collaboration client connected: ${client.id}`);
  }

  async handleDisconnect(client: AuthedSocket): Promise<void> {
    this.lastCursorAt.delete(client.id);
    const removed = this.presence.removeEverywhere(client.id);
    for (const { roomKey, entry } of removed) {
      await this.closeAndBroadcast(roomKey, entry);
    }
    this.logger.debug(`Collaboration client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join_room')
  async onJoin(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() dto: JoinRoomDto,
  ): Promise<{ ok: boolean; presence?: any[]; roomKey?: string; error?: string }> {
    const actor = this.actorFrom(client);
    if (!actor) return { ok: false, error: 'Unauthorized' };

    const resourceType = CollaborationService.normalizeResourceType(
      dto.resourceType,
    );
    const roomKey = PresenceService.roomKey(resourceType, dto.resourceId);

    await client.join(roomKey);

    const displayName =
      dto.displayName?.trim() ||
      actor.email?.split('@')[0] ||
      `User ${actor.id.slice(0, 6)}`;

    const session = await this.collaboration.openSession({
      resourceType,
      resourceId: dto.resourceId,
      userId: actor.id,
      displayName,
      avatarUrl: dto.avatarUrl ?? null,
      presenceVisible: true,
      socketId: client.id,
      role: actor.role,
      color: colorForUser(actor.id),
    });

    const entry: PresenceEntry = {
      socketId: client.id,
      sessionId: session.id,
      userId: actor.id,
      displayName,
      avatarUrl: dto.avatarUrl ?? null,
      role: actor.role ?? 'user',
      color: colorForUser(actor.id),
      status: 'active',
      lastSeen: Date.now(),
      hidden: false,
      cursor: null,
      cursorUpdates: 0,
      typingEvents: 0,
    };
    this.presence.join(roomKey, entry);

    this.server.to(roomKey).emit('presence_update', {
      resourceType,
      resourceId: dto.resourceId,
      users: this.presence.list(roomKey),
    });

    // Real-time + persisted notification for the other collaborators (#1234).
    client.to(roomKey).emit('collaborator_joined', {
      resourceType,
      resourceId: dto.resourceId,
      user: {
        userId: actor.id,
        displayName,
        avatarUrl: dto.avatarUrl ?? null,
        color: colorForUser(actor.id),
      },
    });
    await this.notifyOthers(roomKey, actor.id, {
      title: 'Collaborator joined',
      message: `${displayName} started viewing this ${resourceType}`,
      linkUrl: this.linkFor(resourceType, dto.resourceId),
      metadata: { resourceType, resourceId: dto.resourceId, event: 'join' },
    });

    return {
      ok: true,
      roomKey,
      presence: await this.collaboration.presenceFor(
        actor,
        resourceType,
        dto.resourceId,
      ),
    };
  }

  @SubscribeMessage('leave_room')
  async onLeave(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() dto: LeaveRoomDto,
  ): Promise<{ ok: boolean }> {
    const resourceType = CollaborationService.normalizeResourceType(
      dto.resourceType,
    );
    const roomKey = PresenceService.roomKey(resourceType, dto.resourceId);
    const entry = this.presence.remove(roomKey, client.id);
    await client.leave(roomKey);

    if (entry) {
      await this.closeAndBroadcast(roomKey, entry, client);
    }
    return { ok: true };
  }

  @SubscribeMessage('cursor_move')
  onCursor(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() dto: CursorMoveDto,
  ): void {
    const resourceType = CollaborationService.normalizeResourceType(
      dto.resourceType,
    );
    const roomKey = PresenceService.roomKey(resourceType, dto.resourceId);

    const now = Date.now();
    const last = this.lastCursorAt.get(client.id) ?? 0;
    if (now - last < CURSOR_THROTTLE_MS) return;
    this.lastCursorAt.set(client.id, now);

    const entry = this.presence.setCursor(roomKey, client.id, dto.x, dto.y);
    if (!entry) return;

    client.to(roomKey).emit('cursor_update', {
      resourceType,
      resourceId: dto.resourceId,
      userId: entry.userId,
      displayName: entry.displayName,
      avatarUrl: entry.avatarUrl,
      color: entry.color,
      x: dto.x,
      y: dto.y,
    });
  }

  @SubscribeMessage('typing')
  onTyping(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() dto: TypingDto,
  ): void {
    const resourceType = CollaborationService.normalizeResourceType(
      dto.resourceType,
    );
    const roomKey = PresenceService.roomKey(resourceType, dto.resourceId);
    const entry = this.presence.setTyping(
      roomKey,
      client.id,
      dto.isTyping,
    );
    if (!entry) return;

    client.to(roomKey).emit('user_typing', {
      resourceType,
      resourceId: dto.resourceId,
      userId: entry.userId,
      displayName: entry.displayName,
      isTyping: dto.isTyping,
    });
    this.server.to(roomKey).emit('activity_status', {
      resourceType,
      resourceId: dto.resourceId,
      userId: entry.userId,
      status: entry.status,
    });
  }

  @SubscribeMessage('activity_ping')
  onActivityPing(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() dto: RoomTargetDto,
  ): void {
    const resourceType = CollaborationService.normalizeResourceType(
      dto.resourceType,
    );
    const roomKey = PresenceService.roomKey(resourceType, dto.resourceId);
    const before = this.presence.get(roomKey, client.id);
    const wasIdle = before?.status === 'idle';
    const entry = this.presence.touch(roomKey, client.id, 'active');
    if (entry && wasIdle) {
      this.server.to(roomKey).emit('activity_status', {
        resourceType,
        resourceId: dto.resourceId,
        userId: entry.userId,
        status: entry.status,
      });
    }
  }

  @SubscribeMessage('screen_share_signal')
  onScreenShareSignal(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { resourceType: CollaborationResourceType; resourceId: string; type: 'offer' | 'answer' | 'ice'; data: unknown },
  ): void {
    const roomKey = PresenceService.roomKey(
      CollaborationService.normalizeResourceType(payload.resourceType),
      payload.resourceId,
    );
    client.to(roomKey).emit('screen_share_signal', {
      type: payload.type,
      data: payload.data,
      from: client.data.user?.sub,
    });
  }

  @SubscribeMessage('screen_share_annotation')
  onScreenShareAnnotation(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { resourceType: CollaborationResourceType; resourceId: string; points: Array<{ x: number; y: number }>; color?: string },
  ): void {
    const roomKey = PresenceService.roomKey(
      CollaborationService.normalizeResourceType(payload.resourceType),
      payload.resourceId,
    );
    if (payload.points.length > 500) return;
    client.to(roomKey).emit('screen_share_annotation', {
      points: payload.points,
      color: payload.color ?? '#f59e0b',
      from: client.data.user?.sub,
    });
  }

  @SubscribeMessage('set_presence_visibility')
  async onSetVisibility(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() dto: PresenceVisibilityDto,
  ): Promise<{ ok: boolean; visible: boolean }> {
    const actor = this.actorFrom(client);
    const resourceType = CollaborationService.normalizeResourceType(
      dto.resourceType,
    );
    const roomKey = PresenceService.roomKey(resourceType, dto.resourceId);
    const entry = this.presence.setHidden(roomKey, client.id, !dto.visible);

    if (actor) {
      await this.collaboration.setPresenceVisibility(
        actor.id,
        resourceType,
        dto.resourceId,
        dto.visible,
      );
    }

    this.server.to(roomKey).emit('presence_update', {
      resourceType,
      resourceId: dto.resourceId,
      users: this.presence.list(roomKey),
    });
    return { ok: true, visible: dto.visible };
  }

  /** Marks long-inactive participants idle so the UI can grey them out. */
  @Interval(ACTIVITY_FLUSH_MS)
  handleIdleSweep(): void {
    const changed = this.presence.sweepIdle();
    const rooms = new Set(changed.map((c) => c.roomKey));
    for (const roomKey of rooms) {
      const [resourceType, resourceId] = roomKey.split(':') as [
        CollaborationResourceType,
        string,
      ];
      this.server.to(roomKey).emit('presence_update', {
        resourceType,
        resourceId,
        users: this.presence.list(roomKey),
      });
    }
  }

  private async closeAndBroadcast(
    roomKey: string,
    entry: PresenceEntry,
    source?: AuthedSocket,
  ): Promise<void> {
    const [resourceType, resourceId] = roomKey.split(':') as [
      CollaborationResourceType,
      string,
    ];

    await this.collaboration.closeSession(entry.sessionId, {
      cursorUpdates: entry.cursorUpdates,
      typingEvents: entry.typingEvents,
    });

    (source ? source.to(roomKey) : this.server.to(roomKey)).emit(
      'presence_update',
      { resourceType, resourceId, users: this.presence.list(roomKey) },
    );
    this.server.to(roomKey).emit('collaborator_left', {
      resourceType,
      resourceId,
      userId: entry.userId,
      displayName: entry.displayName,
    });
    await this.notifyOthers(roomKey, entry.userId, {
      title: 'Collaborator left',
      message: `${entry.displayName} stopped viewing this ${resourceType}`,
      linkUrl: this.linkFor(resourceType, resourceId),
      metadata: { resourceType, resourceId, event: 'leave' },
    });
  }

  private async notifyOthers(
    roomKey: string,
    excludeUserId: string,
    payload: {
      title: string;
      message: string;
      linkUrl?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const recipients = this.presence
      .userIdsIn(roomKey)
      .filter((id) => id !== excludeUserId);
    if (recipients.length === 0) return;

    const notificationType = 'collaboration' as const;
    await Promise.all(
      recipients.map((userId) =>
        this.notifications
          .createNotification({
            userId,
            type: notificationType,
            title: payload.title,
            message: payload.message,
            linkUrl: payload.linkUrl,
            metadataJson: payload.metadata,
          })
          .catch((err) =>
            this.logger.warn(
              `Failed to persist collaboration notification for ${userId}: ${err?.message}`,
            ),
          ),
      ),
    );
  }

  private linkFor(
    resourceType: CollaborationResourceType,
    resourceId: string,
  ): string {
    return resourceType === 'deal'
      ? `/marketplace/${resourceId}`
      : `/dashboard/documents?documentId=${resourceId}`;
  }

  private actorFrom(client: AuthedSocket): {
    id: string;
    role?: string;
    email?: string;
  } | null {
    const user = client.data?.user;
    if (!user?.sub) return null;
    return { id: user.sub, role: user.role, email: user.email };
  }
}
