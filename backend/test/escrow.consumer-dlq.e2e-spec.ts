import { Test, TestingModule } from '@nestjs/testing';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import * as amqp from 'amqplib';
import { EscrowConsumer } from '../src/escrow/escrow.consumer';
import { EscrowService } from '../src/escrow/escrow.service';
import { QueueProcessor } from '../src/queue/queue.processor';
import { QueueTopologyService } from '../src/queue/queue-topology.service';
import {
  ROUTING_KEY_OWNERS,
  routingKeysForConsumer,
} from '../src/queue/queue.routing-key-ownership';
import * as queueConstants from '../src/queue/queue.constants';
import * as queueDlqConstants from '../src/queue/queue.dlq.constants';
import {
  ESCROW_QUEUE_DLX,
  ESCROW_QUEUE_DLQ,
  ESCROW_QUEUE_NAME,
  dlxQueueOptions,
} from '../src/queue/queue.dlq.constants';

describe('RabbitMQ routing key ownership (architecture)', () => {
  const declaredRoutingKeys = (): string[] => {
    const keys = new Set<string>();

    for (const value of Object.values(queueConstants)) {
      if (typeof value === 'string') {
        keys.add(value);
      }
    }

    for (const value of Object.values(queueDlqConstants)) {
      if (typeof value === 'string') {
        keys.add(value);
      }
    }

    return Array.from(keys);
  };

  it('registers every routing key with exactly one consumer class', () => {
    const keys = declaredRoutingKeys();
    expect(keys.length).toBeGreaterThan(0);

    for (const key of keys) {
      const owners = ROUTING_KEY_OWNERS[key] ?? [];
      expect(owners).toHaveLength(1);
    }
  });

  it('does not register the same routing key with more than one consumer', () => {
    const seen = new Map<string, string>();

    for (const consumer of [QueueProcessor, EscrowConsumer]) {
      for (const key of routingKeysForConsumer(consumer)) {
        const existing = seen.get(key);
        expect(existing).toBeUndefined();
        seen.set(key, consumer.name);
      }
    }
  });

  it('assigns escrow event handling to EscrowConsumer only', () => {
    const escrowKeys = routingKeysForConsumer(EscrowConsumer);
    expect(escrowKeys.length).toBeGreaterThan(0);

    const queueKeys = new Set(routingKeysForConsumer(QueueProcessor));
    for (const key of escrowKeys) {
      expect(queueKeys.has(key)).toBe(false);
    }
  });
});

describe('EscrowConsumer DLQ handling (E2E)', () => {
  const rabbitUrl = process.env.RABBITMQ_URL || process.env.CI_RABBITMQ;

  if (!rabbitUrl) {
    it.skip('skipped because RabbitMQ is not available in this environment', () => {});
    return;
  }

  let app: any;
  let connection: any;
  let channel: amqp.Channel;

  async function waitForDlqMessage(
    queue: string,
    timeoutMs = 10000,
  ): Promise<any> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const message = await channel.get(queue, { noAck: true });
      if (message) {
        return message;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Timed out waiting for a message on ${queue}`);
  }

  beforeAll(async () => {
    const topology = new QueueTopologyService(
      {
        get: (key: string, defaultValue?: string) =>
          key === 'RABBITMQ_URL' ? rabbitUrl : defaultValue,
      } as any,
      {
        setContext: jest.fn(),
        info: jest.fn(),
        error: jest.fn(),
      } as any,
    );

    await topology.onModuleInit();

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [EscrowConsumer],
      providers: [
        {
          provide: EscrowService,
          useValue: {
            processDealDelivered: jest.fn(),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestMicroservice<MicroserviceOptions>({
      transport: Transport.RMQ,
      options: {
        urls: [rabbitUrl],
        queue: ESCROW_QUEUE_NAME,
        queueOptions: dlxQueueOptions(ESCROW_QUEUE_DLX),
      },
    });

    await app.listen();

    connection = await amqp.connect(rabbitUrl);
    channel = await connection.createChannel();
  }, 60000);

  afterAll(async () => {
    await channel?.close().catch(() => undefined);
    await connection?.close().catch(() => undefined);
    await app?.close().catch(() => undefined);
  });

  it('routes malformed escrow messages to the DLQ', async () => {
    const correlationId = `corr-${Date.now()}`;
    const payload = Buffer.from('not-json', 'utf8');

    channel.sendToQueue(ESCROW_QUEUE_NAME, payload, {
      contentType: 'text/plain',
      correlationId,
      persistent: true,
    });

    const dlqMessage = await waitForDlqMessage(ESCROW_QUEUE_DLQ);

    expect(dlqMessage.content.toString('utf8')).toBe('not-json');
    expect(dlqMessage.properties.correlationId).toBe(correlationId);
    expect(dlqMessage.properties.headers?.['x-death']).toBeDefined();
  }, 20000);
});
