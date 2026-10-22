import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailMessage, EmailPreference } from './entities/email.entities';
import { User } from '../auth/entities/user.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { EmailIntegrationService } from './email-integration.service';
import { EmailTemplatesService } from './email-templates.service';
import { EmailAdminController, EmailIntegrationController } from './email-integration.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([EmailMessage, EmailPreference, User, Document]),
    NotificationsModule,
    AuditModule,
  ],
  controllers: [EmailIntegrationController, EmailAdminController],
  providers: [EmailIntegrationService, EmailTemplatesService],
  exports: [EmailIntegrationService, EmailTemplatesService],
})
export class EmailIntegrationModule {}
