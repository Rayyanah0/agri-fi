import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { CalendarConnection } from './entities/calendar-connection.entity';
import { CalendarEvent } from './entities/calendar-event.entity';
import { FeatureFlag } from './entities/feature-flag.entity';
import { FeatureFlagAudit } from './entities/feature-flag-audit.entity';
import { Shard } from './entities/shard.entity';

@Injectable()
export class PlatformIntegrationsService {
  constructor(
    @InjectRepository(CalendarConnection) private readonly connections: Repository<CalendarConnection>,
    @InjectRepository(CalendarEvent) private readonly events: Repository<CalendarEvent>,
    @InjectRepository(FeatureFlag) private readonly flags: Repository<FeatureFlag>,
    @InjectRepository(FeatureFlagAudit) private readonly audits: Repository<FeatureFlagAudit>,
    @InjectRepository(Shard) private readonly shards: Repository<Shard>,
  ) {}

  async connectCalendar(userId: string, input: Partial<CalendarConnection>): Promise<CalendarConnection> {
    const existing = await this.connections.findOne({ where: { userId, provider: input.provider } });
    const connection = this.connections.create({ ...existing, ...input, userId });
    return this.connections.save(connection);
  }

  async listCalendars(userId: string): Promise<CalendarConnection[]> { return this.connections.find({ where: { userId } }); }

  async upsertEvent(userId: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> {
    const connection = await this.connections.findOne({ where: { id: event.connectionId, userId } });
    if (!connection) throw new NotFoundException('Calendar connection not found');
    const current = await this.events.findOne({ where: { connectionId: connection.id, sourceId: event.sourceId } });
    return this.events.save(this.events.create({ ...current, ...event, userId, status: event.status ?? 'pending' }));
  }

  async evaluateFlag(key: string, userId: string, segment?: string): Promise<boolean> {
    const flag = await this.flags.findOne({ where: { key } });
    if (!flag || !flag.enabled) return false;
    const now = Date.now();
    if ((flag.startsAt && now < flag.startsAt.getTime()) || (flag.endsAt && now >= flag.endsAt.getTime())) return false;
    if (flag.userIds.includes(userId) || (segment && flag.segments.includes(segment))) return true;
    const bucket = parseInt(createHash('sha256').update(`${key}:${userId}`).digest('hex').slice(0, 8), 16) % 100;
    return bucket < flag.rolloutPercentage;
  }

  async saveFlag(actorId: string, input: Partial<FeatureFlag>): Promise<FeatureFlag> {
    const current = input.id ? await this.flags.findOne({ where: { id: input.id } }) : null;
    const flag = await this.flags.save(this.flags.create({ ...current, ...input, updatedBy: actorId }));
    await this.audits.save(this.audits.create({ flagId: flag.id, actorId, action: current ? 'update' : 'create', changes: input }));
    return flag;
  }

  async routeShard(userId?: string, dealId?: string): Promise<Shard> {
    const key = userId ?? dealId;
    if (!key) throw new NotFoundException('A user_id or deal_id shard key is required');
    const shards = await this.shards.find({ where: { status: 'healthy' }, order: { shardKey: 'ASC' } });
    if (!shards.length) throw new NotFoundException('No healthy database shard is available');
    const hash = parseInt(createHash('sha256').update(key).digest('hex').slice(0, 8), 16);
    return shards[hash % shards.length];
  }
}