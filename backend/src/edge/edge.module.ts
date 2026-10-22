import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EdgeController } from './edge.controller';
import { EdgeService } from './edge.service';
import { EdgeAuthGuard } from './edge-auth.guard';
import { EdgeNode } from './entities/edge-node.entity';
import { EdgeSyncRecord } from './entities/edge-sync-record.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EdgeNode, EdgeSyncRecord])],
  controllers: [EdgeController],
  providers: [EdgeService, EdgeAuthGuard],
  exports: [EdgeService],
})
export class EdgeModule {}