import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WsJwtGuard } from '../notifications/ws-jwt.guard';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { CollaborationController } from './collaboration.controller';
import { CollaborationGateway } from './collaboration.gateway';
import { CollaborationService } from './collaboration.service';
import { PresenceService } from './presence.service';
import { CollaborationSession } from './entities/collaboration-session.entity';
import { CollaborationPermission } from './entities/collaboration-permission.entity';

@Module({
  imports: [
    AuthModule,
    NotificationsModule,
    TypeOrmModule.forFeature([
      CollaborationSession,
      CollaborationPermission,
      TradeDeal,
      Document,
    ]),
  ],
  controllers: [CollaborationController],
  providers: [
    CollaborationService,
    PresenceService,
    CollaborationGateway,
    WsJwtGuard,
  ],
  exports: [CollaborationService, PresenceService],
})
export class CollaborationModule {}
