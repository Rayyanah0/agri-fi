import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { DealCoFarmer } from '../trade-deals/entities/deal-co-farmer.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Investment } from '../investments/entities/investment.entity';
import { DocumentsModule } from '../documents/documents.module';
import { User } from '../auth/entities/user.entity';
import { ChatAttachment } from './entities/chat-attachment.entity';
import { ChatConversation } from './entities/chat-conversation.entity';
import { ChatMessage } from './entities/chat-message.entity';
import { ChatParticipant } from './entities/chat-participant.entity';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { CHAT_EVENT_BUS, ChatService } from './chat.service';
import { EventEmitter } from 'events';
import { WsJwtGuard } from '../notifications/ws-jwt.guard';

@Module({
  imports: [
    AuthModule,
    DocumentsModule,
    TypeOrmModule.forFeature([
      ChatAttachment,
      ChatConversation,
      ChatMessage,
      ChatParticipant,
      DealCoFarmer,
      Investment,
      TradeDeal,
      User,
    ]),
  ],
  controllers: [ChatController],
  providers: [
    ChatGateway,
    ChatService,
    WsJwtGuard,
    { provide: CHAT_EVENT_BUS, useFactory: () => new EventEmitter() },
  ],
})
export class ChatModule {}
