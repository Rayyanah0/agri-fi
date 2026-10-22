import {
  ConnectedSocket,
  MessageBody,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import {
  Inject,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  UseGuards,
} from '@nestjs/common';
import { EventEmitter } from 'events';
import { Server, Socket } from 'socket.io';
import { WsJwtGuard } from '../notifications/ws-jwt.guard';
import {
  CHAT_EVENT_BUS,
  CHAT_MESSAGE_CREATED,
  CHAT_MESSAGE_UPDATED,
  CHAT_READ_UPDATED,
  ChatService,
} from './chat.service';

interface ChatSocket extends Socket {
  data: Socket['data'] & {
    user?: { id?: string; sub?: string };
  };
}

@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: true, credentials: true },
})
@UseGuards(WsJwtGuard)
export class ChatGateway
  implements OnGatewayInit, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ChatGateway.name);
  private readonly onMessageCreated = (event: {
    conversationId: string;
    message: unknown;
  }) => {
    this.server
      ?.to(event.conversationId)
      .emit('message_created', event.message);
  };
  private readonly onMessageUpdated = (event: {
    conversationId: string;
    message: unknown;
  }) => {
    this.server
      ?.to(event.conversationId)
      .emit('message_updated', event.message);
  };
  private readonly onReadUpdated = (event: {
    conversationId: string;
    userId: string;
    lastReadAt: Date;
  }) => {
    this.server?.to(event.conversationId).emit('read_updated', event);
  };

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly wsJwtGuard: WsJwtGuard,
    private readonly chatService: ChatService,
    @Inject(CHAT_EVENT_BUS) private readonly eventBus: EventEmitter,
  ) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      const client = socket as ChatSocket;
      const token = this.wsJwtGuard.extractToken(client);
      if (!token) return next(new Error('Unauthorized'));
      try {
        this.wsJwtGuard.verifyAndStore(client, token);
        next();
      } catch {
        next(new Error('Unauthorized'));
      }
    });
  }

  onModuleInit(): void {
    this.eventBus.on(CHAT_MESSAGE_CREATED, this.onMessageCreated);
    this.eventBus.on(CHAT_MESSAGE_UPDATED, this.onMessageUpdated);
    this.eventBus.on(CHAT_READ_UPDATED, this.onReadUpdated);
  }

  onModuleDestroy(): void {
    this.eventBus.off(CHAT_MESSAGE_CREATED, this.onMessageCreated);
    this.eventBus.off(CHAT_MESSAGE_UPDATED, this.onMessageUpdated);
    this.eventBus.off(CHAT_READ_UPDATED, this.onReadUpdated);
  }

  @SubscribeMessage('join_conversation')
  async joinConversation(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody()
    conversationId: string,
  ) {
    const userId = client.data.user?.id ?? client.data.user?.sub;
    if (!userId || typeof conversationId !== 'string') {
      throw new WsException('Unauthorized');
    }
    await this.chatService.getConversation(conversationId, userId);
    await client.join(conversationId);
    return { conversationId, joined: true };
  }
}
