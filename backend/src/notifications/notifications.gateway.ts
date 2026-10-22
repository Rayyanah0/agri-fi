import { Logger, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OptionalWsJwtGuard } from './ws-jwt.guard';

/** Rooms that unauthenticated sockets are allowed to join. */
export const PUBLIC_ROOMS = ['deal_funding_progress'] as const;

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  namespace: '/notifications',
})
@UseGuards(OptionalWsJwtGuard)
export class NotificationsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(NotificationsGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly wsJwtGuard: OptionalWsJwtGuard,
    private readonly notificationsService: NotificationsService,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      const client = socket as Socket;
      const token = this.wsJwtGuard.extractToken(client);

      if (!token) {
        // Anonymous visitor: allow the connection but mark it unauthenticated.
        this.wsJwtGuard.markAnonymous(client);
        return next();
      }

      try {
        this.wsJwtGuard.verifyAndStore(client, token);
        next();
      } catch {
        // Invalid/expired token: fall back to anonymous instead of disconnecting.
        this.wsJwtGuard.markAnonymous(client);
        next();
      }
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const user = (client as any).user;
    if (user?.id) {
      this.logger.debug(`Authenticated client connected: ${client.id}`);
      const unreadCount = await this.notificationsService.getUnreadCount(
        user.id,
      );
      client.emit('handshake_response', { unreadCount });
      client.emit('unread_count', { count: unreadCount });
    } else {
      this.logger.debug(`Anonymous client connected: ${client.id}`);
      // Anonymous sockets only get public rooms.
      for (const room of PUBLIC_ROOMS) {
        client.join(room);
      }
      client.emit('handshake_response', { unreadCount: 0, anonymous: true });
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /**
   * Subscribe a socket to a room. Sensitive rooms require authentication;
   * anonymous sockets are rejected server-side.
   */
  handleSubscribe(client: Socket, room: string): void {
    const isPublic = (PUBLIC_ROOMS as readonly string[]).includes(room);
    const user = (client as any).user;

    if (!isPublic && !user?.id) {
      client.emit('auth_error', { message: 'Authentication required' });
      return;
    }

    client.join(room);
  }
}
