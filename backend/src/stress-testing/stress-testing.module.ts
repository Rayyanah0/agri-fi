import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { StressTestingService } from './stress-testing.service';
import { StressTestingController } from './stress-testing.controller';
import { ScenarioLibraryService } from './scenario-library.service';
import { SimulationEngineService } from './simulation-engine.service';
import { ReverseStressService } from './reverse-stress.service';
import { StressTestSchedulerService } from './stress-test-scheduler.service';
import { InvestmentsModule } from '../investments/investments.module';
import { PricesModule } from '../prices/prices.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    InvestmentsModule,
    PricesModule,
    NotificationsModule,
  ],
  controllers: [StressTestingController],
  providers: [
    StressTestingService,
    ScenarioLibraryService,
    SimulationEngineService,
    ReverseStressService,
    StressTestSchedulerService,
  ],
  exports: [StressTestingService],
})
export class StressTestingModule {}