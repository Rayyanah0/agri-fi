import { Module } from '@nestjs/common';
import { DidService } from './did.service';
import { DidController } from './did.controller';

@Module({
  controllers: [DidController],
  providers: [DidService],
  exports: [DidService],
})
export class DidModule {}
