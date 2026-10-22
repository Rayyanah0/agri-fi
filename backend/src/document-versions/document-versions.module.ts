import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentVersion } from './entities/document-version.entity';
import { Document } from '../trade-deals/entities/document.entity';
import { DocumentsModule } from '../documents/documents.module';
import { AuditModule } from '../audit/audit.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DocumentVersionsService } from './document-versions.service';
import {
  DocumentVersionsAdminController,
  DocumentVersionsController,
} from './document-versions.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([DocumentVersion, Document]),
    DocumentsModule,
    AuditModule,
    NotificationsModule,
  ],
  controllers: [DocumentVersionsController, DocumentVersionsAdminController],
  providers: [DocumentVersionsService],
  exports: [DocumentVersionsService],
})
export class DocumentVersionsModule {}
