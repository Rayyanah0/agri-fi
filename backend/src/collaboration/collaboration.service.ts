import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { TradeDeal } from '../trade-deals/entities/trade-deal.entity';
import { Document } from '../trade-deals/entities/document.entity';
import {
  CollaborationResourceType,
  CollaborationSession,
} from './entities/collaboration-session.entity';
import {
  CollaborationPermission,
  CollaborationVisibility,
} from './entities/collaboration-permission.entity';
import { PresenceService, PublicPresence } from './presence.service';

export interface CollaborationActor {
  id: string;
  role?: string;
  email?: string;
}

export interface CollaborationAnalytics {
  resourceType: CollaborationResourceType;
  resourceId: string;
  totalSessions: number;
  uniqueCollaborators: number;
  averageDurationSeconds: number;
  totalDurationSeconds: number;
  totalCursorUpdates: number;
  totalTypingEvents: number;
  peakConcurrent: number;
  activeNow: number;
  sessions: number;
  byDay: Array<{ date: string; sessions: number; uniqueUsers: number }>;
}

const RESOURCE_TYPES: CollaborationResourceType[] = ['deal', 'document'];

@Injectable()
export class CollaborationService {
  private readonly logger = new Logger(CollaborationService.name);

  constructor(
    @InjectRepository(CollaborationSession)
    private readonly sessionRepo: Repository<CollaborationSession>,
    @InjectRepository(CollaborationPermission)
    private readonly permissionRepo: Repository<CollaborationPermission>,
    @InjectRepository(TradeDeal)
    private readonly tradeDealRepo: Repository<TradeDeal>,
    @InjectRepository(Document)
    private readonly documentRepo: Repository<Document>,
    private readonly presence: PresenceService,
  ) {}

  static normalizeResourceType(value: string): CollaborationResourceType {
    if (!RESOURCE_TYPES.includes(value as CollaborationResourceType)) {
      throw new BadRequestException(
        `Unsupported collaboration resource type: ${value}`,
      );
    }
    return value as CollaborationResourceType;
  }

  async resolveOwner(
    resourceType: CollaborationResourceType,
    resourceId: string,
  ): Promise<string | null> {
    if (resourceType === 'deal') {
      const deal = await this.tradeDealRepo.findOne({
        where: { id: resourceId },
        select: ['id', 'farmerId', 'traderId'],
      });
      if (!deal) return null;
      return deal.farmerId ?? deal.traderId ?? null;
    }

    const document = await this.documentRepo.findOne({
      where: { id: resourceId },
      select: ['id', 'uploaderId'],
    });
    return document?.uploaderId ?? null;
  }

  /** True when the actor owns the resource or is an admin. */
  async canManage(
    actor: CollaborationActor,
    resourceType: CollaborationResourceType,
    resourceId: string,
  ): Promise<boolean> {
    if (actor.role === 'admin') return true;
    const owner = await this.resolveOwner(resourceType, resourceId);
    return owner !== null && owner === actor.id;
  }

  private async permissionFor(
    resourceType: CollaborationResourceType,
    resourceId: string,
    userId: string | null,
  ): Promise<CollaborationPermission | null> {
    return this.permissionRepo.findOne({
      where: {
        resourceType,
        resourceId,
        userId: userId === null ? IsNull() : userId,
      },
    });
  }

  /**
   * Collaboration permissions: decides whether `viewerId` may observe presence
   * for the resource. Owners and admins always can.
   */
  async canViewPresence(
    viewer: CollaborationActor,
    resourceType: CollaborationResourceType,
    resourceId: string,
  ): Promise<boolean> {
    if (await this.canManage(viewer, resourceType, resourceId)) return true;

    const [override, policy] = await Promise.all([
      this.permissionFor(resourceType, resourceId, viewer.id),
      this.permissionFor(resourceType, resourceId, null),
    ]);

    if (override) return override.canViewPresence;

    const visibility: CollaborationVisibility = policy?.visibility ?? 'everyone';
    // 'invited' means presence is only visible to explicitly-allowed users.
    return visibility === 'everyone';
  }

  /** Presence visible to a viewer, with hidden users and privacy respected. */
  async presenceFor(
    viewer: CollaborationActor,
    resourceType: CollaborationResourceType,
    resourceId: string,
  ): Promise<PublicPresence[]> {
    if (!(await this.canViewPresence(viewer, resourceType, resourceId))) {
      return [];
    }
    const roomKey = PresenceService.roomKey(resourceType, resourceId);
    return this.presence.list(roomKey);
  }

  async openSession(params: {
    resourceType: CollaborationResourceType;
    resourceId: string;
    userId: string;
    displayName: string;
    avatarUrl?: string | null;
    presenceVisible: boolean;
    socketId: string;
    role?: string;
    color?: string;
  }): Promise<CollaborationSession> {
    const session = this.sessionRepo.create({
      resourceType: params.resourceType,
      resourceId: params.resourceId,
      userId: params.userId,
      displayName: params.displayName,
      avatarUrl: params.avatarUrl ?? null,
      presenceVisible: params.presenceVisible,
      joinedAt: new Date(),
      leftAt: null,
      durationSeconds: null,
      cursorUpdates: 0,
      typingEvents: 0,
    });
    const saved = await this.sessionRepo.save(session);
    this.logger.debug(
      `Collaboration session ${saved.id} opened for ${params.resourceType}:${params.resourceId} by ${params.userId}`,
    );
    return saved;
  }

  async closeSession(
    sessionId: string,
    activity: { cursorUpdates: number; typingEvents: number },
  ): Promise<void> {
    const session = await this.sessionRepo.findOne({ where: { id: sessionId } });
    if (!session || session.leftAt) return;

    const leftAt = new Date();
    const durationSeconds = Math.max(
      0,
      Math.round((leftAt.getTime() - session.joinedAt.getTime()) / 1000),
    );

    await this.sessionRepo.update(
      { id: sessionId },
      {
        leftAt,
        durationSeconds,
        cursorUpdates: session.cursorUpdates + activity.cursorUpdates,
        typingEvents: session.typingEvents + activity.typingEvents,
      },
    );
  }

  /**
   * Persist the counters accumulated in the in-memory presence entry. Called
   * periodically so a long-lived session's activity is not lost on a crash.
   */
  async flushActivity(
    sessionId: string,
    counters: { cursorUpdates: number; typingEvents: number },
  ): Promise<void> {
    if (counters.cursorUpdates === 0 && counters.typingEvents === 0) return;
    await this.sessionRepo.increment(
      { id: sessionId },
      'cursorUpdates',
      counters.cursorUpdates,
    );
    await this.sessionRepo.increment(
      { id: sessionId },
      'typingEvents',
      counters.typingEvents,
    );
  }

  async setPresenceVisibility(
    userId: string,
    resourceType: CollaborationResourceType,
    resourceId: string,
    visible: boolean,
  ): Promise<void> {
    await this.sessionRepo.update(
      { userId, resourceType, resourceId, leftAt: IsNull() },
      { presenceVisible: visible },
    );
  }

  async getHistory(
    actor: CollaborationActor,
    resourceType: CollaborationResourceType,
    resourceId: string,
    limit = 50,
  ): Promise<CollaborationSession[]> {
    if (!(await this.canManage(actor, resourceType, resourceId))) {
      throw new ForbiddenException(
        'Only the resource owner may view collaboration history',
      );
    }
    return this.sessionRepo.find({
      where: { resourceType, resourceId },
      order: { joinedAt: 'DESC' },
      take: Math.min(Math.max(limit, 1), 200),
    });
  }

  async getAnalytics(
    actor: CollaborationActor,
    resourceType: CollaborationResourceType,
    resourceId: string,
    from?: Date,
    to?: Date,
  ): Promise<CollaborationAnalytics> {
    if (!(await this.canManage(actor, resourceType, resourceId))) {
      throw new ForbiddenException(
        'Only the resource owner may view collaboration analytics',
      );
    }
    const range = this.range(from, to);
    const sessions = await this.sessionRepo.find({
      where: { resourceType, resourceId, joinedAt: Between(range.from, range.to) },
      order: { joinedAt: 'ASC' },
    });
    const roomKey = PresenceService.roomKey(resourceType, resourceId);
    return this.summarize(resourceType, resourceId, sessions, this.presence.currentCount(roomKey));
  }

  async getGlobalAnalytics(
    from?: Date,
    to?: Date,
  ): Promise<Array<CollaborationAnalytics>> {
    const range = this.range(from, to);
    const sessions = await this.sessionRepo.find({
      where: { joinedAt: Between(range.from, range.to) },
      order: { joinedAt: 'ASC' },
    });

    const grouped = new Map<string, CollaborationSession[]>();
    for (const session of sessions) {
      const key = `${session.resourceType}:${session.resourceId}`;
      const list = grouped.get(key) ?? [];
      list.push(session);
      grouped.set(key, list);
    }

    return Array.from(grouped.entries()).map(([key, list]) => {
      const [resourceType, resourceId] = key.split(':') as [
        CollaborationResourceType,
        string,
      ];
      const roomKey = PresenceService.roomKey(resourceType, resourceId);
      return this.summarize(
        resourceType,
        resourceId,
        list,
        this.presence.currentCount(roomKey),
      );
    });
  }

  getPermissions(
    resourceType: CollaborationResourceType,
    resourceId: string,
  ): Promise<CollaborationPermission[]> {
    return this.permissionRepo.find({
      where: { resourceType, resourceId },
      order: { createdAt: 'ASC' },
    });
  }

  async upsertPermissions(
    actor: CollaborationActor,
    resourceType: CollaborationResourceType,
    resourceId: string,
    input: {
      visibility?: CollaborationVisibility;
      canViewPresence?: boolean;
      userId?: string | null;
    },
  ): Promise<CollaborationPermission> {
    if (!(await this.canManage(actor, resourceType, resourceId))) {
      throw new ForbiddenException(
        'Only the resource owner may configure collaboration permissions',
      );
    }
    if (input.visibility && !['everyone', 'invited'].includes(input.visibility)) {
      throw new BadRequestException('Invalid visibility value');
    }
    if (input.userId) {
      const owner = await this.resolveOwner(resourceType, resourceId);
      if (owner === null) {
        throw new NotFoundException('Collaboration resource not found');
      }
    }

    const userId = input.userId ?? null;
    const existing = await this.permissionRepo.findOne({
      where: { resourceType, resourceId, userId: userId === null ? IsNull() : userId },
    });

    if (existing) {
      existing.visibility = input.visibility ?? existing.visibility;
      existing.canViewPresence = input.canViewPresence ?? existing.canViewPresence;
      existing.updatedBy = actor.id;
      return this.permissionRepo.save(existing);
    }

    const created = this.permissionRepo.create({
      resourceType,
      resourceId,
      userId,
      visibility: input.visibility ?? 'everyone',
      canViewPresence: input.canViewPresence ?? true,
      updatedBy: actor.id,
    });
    return this.permissionRepo.save(created);
  }

  private summarize(
    resourceType: CollaborationResourceType,
    resourceId: string,
    sessions: CollaborationSession[],
    activeNow: number,
  ): CollaborationAnalytics {
    const users = new Set(sessions.map((s) => s.userId));
    const totalDurationSeconds = sessions.reduce(
      (sum, s) => sum + (s.durationSeconds ?? this.elapsedSeconds(s)),
      0,
    );
    const closed = sessions.filter((s) => s.durationSeconds !== null).length || sessions.length;

    return {
      resourceType,
      resourceId,
      totalSessions: sessions.length,
      uniqueCollaborators: users.size,
      averageDurationSeconds: closed ? Math.round(totalDurationSeconds / closed) : 0,
      totalDurationSeconds,
      totalCursorUpdates: sessions.reduce((sum, s) => sum + s.cursorUpdates, 0),
      totalTypingEvents: sessions.reduce((sum, s) => sum + s.typingEvents, 0),
      peakConcurrent: this.peakConcurrency(sessions),
      activeNow,
      sessions: sessions.length,
      byDay: this.byDay(sessions),
    };
  }

  private elapsedSeconds(session: CollaborationSession): number {
    const end = session.leftAt ?? new Date();
    return Math.max(0, Math.round((end.getTime() - session.joinedAt.getTime()) / 1000));
  }

  private peakConcurrency(sessions: CollaborationSession[]): number {
    const events: Array<[number, number]> = [];
    for (const session of sessions) {
      events.push([session.joinedAt.getTime(), 1]);
      events.push([(session.leftAt ?? new Date()).getTime(), -1]);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let current = 0;
    let peak = 0;
    for (const [, delta] of events) {
      current += delta;
      peak = Math.max(peak, current);
    }
    return peak;
  }

  private byDay(
    sessions: CollaborationSession[],
  ): Array<{ date: string; sessions: number; uniqueUsers: number }> {
    const map = new Map<string, { sessions: number; users: Set<string> }>();
    for (const session of sessions) {
      const date = session.joinedAt.toISOString().slice(0, 10);
      const bucket = map.get(date) ?? { sessions: 0, users: new Set<string>() };
      bucket.sessions += 1;
      bucket.users.add(session.userId);
      map.set(date, bucket);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, bucket]) => ({
        date,
        sessions: bucket.sessions,
        uniqueUsers: bucket.users.size,
      }));
  }

  private range(from?: Date, to?: Date): { from: Date; to: Date } {
    const end = to ?? new Date();
    const start = from ?? new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
    return { from: start, to: end };
  }
}
