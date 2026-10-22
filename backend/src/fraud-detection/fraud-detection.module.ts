import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FraudDetectionService } from './fraud-detection.service';
import { Investment } from '../investments/entities/investment.entity';
import { User } from '../auth/entities/user.entity';
import { SystemAuditLog } from '../audit/entities/system-audit-log.entity';
import { FederatedLearningService } from './federated-learning.service';
import { FederatedLearningController } from './federated-learning.controller';
import { FederatedParticipant } from './entities/federated-participant.entity';
import { FederatedModel } from './entities/federated-model.entity';
import { FederatedTrainingRound } from './entities/federated-training-round.entity';
import { FederatedContribution } from './entities/federated-contribution.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Investment,
      User,
      SystemAuditLog,
      FederatedParticipant,
      FederatedModel,
      FederatedTrainingRound,
      FederatedContribution,
    ]),
  ],
  controllers: [FederatedLearningController],
  providers: [FraudDetectionService, FederatedLearningService],
  exports: [FraudDetectionService, FederatedLearningService],
})
export class FraudDetectionModule {}