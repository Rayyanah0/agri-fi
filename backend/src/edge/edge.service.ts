import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { EdgeNode, EdgeNodeState } from './entities/edge-node.entity';
import { EdgeSyncRecord } from './entities/edge-sync-record.entity';

interface HeartbeatInput {
  region: string;
  latencyMs: number;
  queuedItems: number;
  bytesSynced: number;
  lastError?: string | null;
}

@Injectable()
export class EdgeService {
  constructor(
    @InjectRepository(EdgeNode) private readonly nodeRepository: Repository<EdgeNode>,
    @InjectRepository(EdgeSyncRecord) private readonly syncRepository: Repository<EdgeSyncRecord>,
  ) {}

  async heartbeat(nodeId: string, input: HeartbeatInput) {
    if (!input || !input.region || input.region.length > 100 || !Number.isInteger(input.latencyMs) || input.latencyMs < 0 || !Number.isInteger(input.queuedItems) || input.queuedItems < 0 || !Number.isSafeInteger(input.bytesSynced) || input.bytesSynced < 0) {
      throw new BadRequestException('Invalid edge heartbeat metrics');
    }
    const state: EdgeNodeState = input.lastError ? 'degraded' : 'online';
    await this.nodeRepository.save(this.nodeRepository.create({
      nodeId,
      region: input.region,
      state,
      lastSeenAt: new Date(),
      latencyMs: input.latencyMs,
      queuedItems: input.queuedItems,
      bytesSynced: input.bytesSynced,
      lastError: input.lastError?.slice(0, 1000) ?? null,
    }));
    return { nodeId, state, receivedAt: new Date().toISOString() };
  }

  async ingestBatch(nodeId: string, events: Array<{ eventId: string; type: string; payload: Record<string, unknown> }>) {
    if (!Array.isArray(events) || events.length > 500) throw new BadRequestException('Sync batch must contain at most 500 events');
    let accepted = 0;
    let duplicates = 0;
    for (const event of events) {
      if (!event || !/^[a-zA-Z0-9._:-]{1,128}$/.test(event.eventId) || !/^[a-zA-Z0-9._-]{1,100}$/.test(event.type) || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
        throw new BadRequestException('Invalid edge sync event');
      }
      const serialized = JSON.stringify(event.payload);
      if (Buffer.byteLength(serialized) > 256 * 1024) throw new BadRequestException('Edge sync event exceeds 256 KiB');
      const payloadSha256 = createHash('sha256').update(serialized).digest('hex');
      const persistedEventId = createHash('sha256').update(`${nodeId}\n${event.eventId}`).digest('hex');
      try {
        await this.syncRepository.insert({
          eventId: persistedEventId,
          nodeId,
          eventType: event.type,
          payload: event.payload,
          payloadSha256,
        });
        accepted += 1;
      } catch (error) {
        if ((error as { code?: string })?.code !== '23505') throw error;
        const existing = await this.syncRepository.findOne({ where: { eventId: persistedEventId } });
        if (existing?.payloadSha256 !== payloadSha256) throw new BadRequestException('Idempotency key was reused with different content');
        duplicates += 1;
      }
    }
    return { accepted, duplicates, acknowledgedAt: new Date().toISOString() };
  }

  async getStatus() {
    const nodes = await this.nodeRepository.find({ order: { region: 'ASC', nodeId: 'ASC' } });
    const staleAt = Date.now() - 2 * 60 * 1000;
    const data = nodes.map((node) => ({
      ...node,
      state: !node.lastSeenAt || node.lastSeenAt.getTime() < staleAt ? 'offline' : node.state,
    }));
    const primary = data.filter((node) => node.state === 'online').sort((left, right) => (left.latencyMs ?? Infinity) - (right.latencyMs ?? Infinity))[0] ?? null;
    return { nodes: data, preferredNodeId: primary?.nodeId ?? null, observedAt: new Date().toISOString() };
  }

  async getAnalytics() {
    const totals = await this.syncRepository.createQueryBuilder('sync')
      .select('sync.nodeId', 'nodeId')
      .addSelect('COUNT(*)', 'events')
      .addSelect('MIN(sync.createdAt)', 'firstSync')
      .addSelect('MAX(sync.createdAt)', 'lastSync')
      .groupBy('sync.nodeId')
      .getRawMany<{ nodeId: string; events: string; firstSync: Date | null; lastSync: Date | null }>();
    return { nodes: totals.map((row) => ({ nodeId: row.nodeId, syncedEvents: Number(row.events), firstSync: row.firstSync, lastSync: row.lastSync })), generatedAt: new Date().toISOString() };
  }
}