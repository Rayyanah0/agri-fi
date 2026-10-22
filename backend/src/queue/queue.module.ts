import { Module } from '@nestjs/common';
import { QueueAlertService } from './queue-alert.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { QueueService } from './queue.service';
import { QueueTopologyService } from './queue-topology.service';
import { IdempotencyService } from './idempotency.service';
import { QueueAnalyticsService } from './queue-analytics.service';
import { QUEUE_SERVICE } from './queue.constants';
import {
  MAIN_QUEUE_NAME,
  MAIN_QUEUE_DLX,
  dlxQueueOptions,
} from './queue.dlq.constants';
import { HttpModule } from '@nestjs/axios';
import { OutboxModule } from '../outbox/outbox.module';
export { QUEUE_SERVICE } from './queue.constants';

@Module({
  imports: [
    HttpModule,
    OutboxModule,
    ClientsModule.registerAsync([
      {
        name: QUEUE_SERVICE,
        imports: [ConfigModule],
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [
              config.get<string>(
                'RABBITMQ_URL',
                'amqp://guest:guest@localhost:5672',
              ),
            ],
            queue: MAIN_QUEUE_NAME,
            queueOptions: dlxQueueOptions(MAIN_QUEUE_DLX),
            // Persist messages to disk so they survive broker restarts (#1240).
            persistent: true,
            // Consumers ack/nack explicitly (see queue.processor.ts).
            noAck: false,
            prefetchCount: config.get<number>('RABBITMQ_PREFETCH_COUNT', 10),
          },
        }),
        inject: [ConfigService],
      },
    ]),
  ],
  providers: [
    QueueService,
    QueueAlertService,
    QueueTopologyService,
    IdempotencyService,
    QueueAnalyticsService,
  ],
  exports: [
    QueueService,
    ClientsModule,
    QueueAlertService,
    OutboxModule,
    IdempotencyService,
    QueueAnalyticsService,
  ],
})
export class QueueModule {}
