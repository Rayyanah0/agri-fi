import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CollaborationService } from './collaboration.service';
import { PresenceService } from './presence.service';
import { CollaborationSession } from './entities/collaboration-session.entity';

type MockRepo = Record<string, jest.Mock>;

function sessionFactory(
  overrides: Partial<CollaborationSession> = {},
): CollaborationSession {
  const joinedAt = overrides.joinedAt ?? new Date('2024-01-01T10:00:00Z');
  return {
    id: 's1',
    resourceType: 'deal',
    resourceId: 'deal-1',
    userId: 'u1',
    displayName: 'User One',
    avatarUrl: null,
    presenceVisible: true,
    joinedAt,
    leftAt: null,
    durationSeconds: null,
    cursorUpdates: 0,
    typingEvents: 0,
    createdAt: joinedAt,
    updatedAt: joinedAt,
    ...overrides,
  } as CollaborationSession;
}

describe('CollaborationService (#1234)', () => {
  let service: CollaborationService;
  let sessionRepo: MockRepo;
  let permissionRepo: MockRepo;
  let dealRepo: MockRepo;
  let documentRepo: MockRepo;
  let presence: PresenceService;

  beforeEach(() => {
    sessionRepo = {
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => ({ ...v, id: v.id ?? 's1' })),
      findOne: jest.fn(),
      find: jest.fn(async () => []),
      update: jest.fn(async () => undefined),
      increment: jest.fn(async () => undefined),
    };
    permissionRepo = {
      create: jest.fn((v) => v),
      save: jest.fn(async (v) => v),
      findOne: jest.fn(async () => null),
      find: jest.fn(async () => []),
    };
    dealRepo = { findOne: jest.fn(async () => ({ id: 'deal-1', farmerId: 'owner', traderId: 'trader' })) };
    documentRepo = { findOne: jest.fn(async () => ({ id: 'doc-1', uploaderId: 'uploader' })) };
    presence = new PresenceService();

    service = new CollaborationService(
      sessionRepo as never,
      permissionRepo as never,
      dealRepo as never,
      documentRepo as never,
      presence,
    );
  });

  describe('normalizeResourceType', () => {
    it('accepts deal/document and rejects others', () => {
      expect(CollaborationService.normalizeResourceType('deal')).toBe('deal');
      expect(CollaborationService.normalizeResourceType('document')).toBe('document');
      expect(() => CollaborationService.normalizeResourceType('board')).toThrow(
        BadRequestException,
      );
    });
  });

  describe('canManage', () => {
    it('allows admins', async () => {
      await expect(
        service.canManage({ id: 'random', role: 'admin' }, 'deal', 'deal-1'),
      ).resolves.toBe(true);
    });

    it('allows the resource owner', async () => {
      await expect(
        service.canManage({ id: 'owner', role: 'farmer' }, 'deal', 'deal-1'),
      ).resolves.toBe(true);
    });

    it('rejects non-owners', async () => {
      await expect(
        service.canManage({ id: 'other', role: 'investor' }, 'deal', 'deal-1'),
      ).resolves.toBe(false);
    });
  });

  describe('canViewPresence', () => {
    it('defaults to everyone when no policy exists', async () => {
      await expect(
        service.canViewPresence({ id: 'viewer' }, 'deal', 'deal-1'),
      ).resolves.toBe(true);
    });

    it('blocks presence under an "invited" policy without an allow-list entry', async () => {
      // First lookup is the per-user override (none), second is the default policy.
      permissionRepo.findOne = jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ visibility: 'invited', canViewPresence: true });

      await expect(
        service.canViewPresence({ id: 'viewer' }, 'deal', 'deal-1'),
      ).resolves.toBe(false);
    });

    it('honours an explicit per-user override', async () => {
      permissionRepo.findOne = jest
        .fn()
        .mockResolvedValueOnce({ visibility: 'invited', canViewPresence: false })
        .mockResolvedValueOnce({ visibility: 'everyone', canViewPresence: true });

      await expect(
        service.canViewPresence({ id: 'viewer' }, 'deal', 'deal-1'),
      ).resolves.toBe(false);
    });
  });

  describe('session lifecycle', () => {
    it('opens a session with the provided metadata', async () => {
      const session = await service.openSession({
        resourceType: 'document',
        resourceId: 'doc-1',
        userId: 'u1',
        displayName: 'Amina',
        avatarUrl: 'https://example.com/a.png',
        presenceVisible: true,
        socketId: 'sock-1',
      });
      expect(session.userId).toBe('u1');
      expect(session.displayName).toBe('Amina');
      expect(session.joinedAt).toBeInstanceOf(Date);
    });

    it('computes duration and activity when closing', async () => {
      sessionRepo.findOne = jest.fn(async () =>
        sessionFactory({
          id: 's1',
          joinedAt: new Date(Date.now() - 5000),
        }),
      );
      await service.closeSession('s1', { cursorUpdates: 3, typingEvents: 2 });

      expect(sessionRepo.update).toHaveBeenCalledWith(
        { id: 's1' },
        expect.objectContaining({
          cursorUpdates: 3,
          typingEvents: 2,
        }),
      );
      const [, patch] = sessionRepo.update.mock.calls[0];
      expect(patch.durationSeconds).toBeGreaterThanOrEqual(4);
      expect(patch.leftAt).toBeInstanceOf(Date);
    });
  });

  describe('analytics', () => {
    it('summarizes sessions with peak concurrency and daily breakdown', async () => {
      const sessions = [
        sessionFactory({
          id: 'a',
          userId: 'u1',
          joinedAt: new Date('2024-01-01T10:00:00Z'),
          leftAt: new Date('2024-01-01T10:10:00Z'),
          durationSeconds: 600,
          cursorUpdates: 5,
          typingEvents: 1,
        }),
        sessionFactory({
          id: 'b',
          userId: 'u2',
          joinedAt: new Date('2024-01-01T10:05:00Z'),
          leftAt: new Date('2024-01-01T10:20:00Z'),
          durationSeconds: 900,
          cursorUpdates: 8,
          typingEvents: 4,
        }),
        sessionFactory({
          id: 'c',
          userId: 'u1',
          joinedAt: new Date('2024-01-02T09:00:00Z'),
          leftAt: new Date('2024-01-02T09:30:00Z'),
          durationSeconds: 1800,
          cursorUpdates: 2,
          typingEvents: 0,
        }),
      ];
      sessionRepo.find = jest.fn(async () => sessions);

      const analytics = await service.getAnalytics(
        { id: 'owner', role: 'farmer' },
        'deal',
        'deal-1',
      );

      expect(analytics.totalSessions).toBe(3);
      expect(analytics.uniqueCollaborators).toBe(2);
      expect(analytics.totalCursorUpdates).toBe(15);
      expect(analytics.totalTypingEvents).toBe(5);
      expect(analytics.peakConcurrent).toBe(2);
      expect(analytics.byDay).toEqual([
        { date: '2024-01-01', sessions: 2, uniqueUsers: 2 },
        { date: '2024-01-02', sessions: 1, uniqueUsers: 1 },
      ]);
    });

    it('refuses analytics to non-owners', async () => {
      await expect(
        service.getAnalytics({ id: 'other' }, 'deal', 'deal-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('permissions', () => {
    it('rejects permission changes from non-owners', async () => {
      await expect(
        service.upsertPermissions({ id: 'other' }, 'deal', 'deal-1', {
          visibility: 'invited',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('creates a resource default policy', async () => {
      const created = await service.upsertPermissions(
        { id: 'owner', role: 'farmer' },
        'deal',
        'deal-1',
        { visibility: 'invited' },
      );
      expect(permissionRepo.save).toHaveBeenCalled();
      expect((created as any).visibility).toBe('invited');
    });

    it('rejects invalid visibility values', async () => {
      await expect(
        service.upsertPermissions({ id: 'owner', role: 'farmer' }, 'deal', 'deal-1', {
          visibility: 'secret' as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('presence integration', () => {
    it('filters hidden users out of the presence list', async () => {
      const roomKey = PresenceService.roomKey('deal', 'deal-1');
      const base = {
        sessionId: 's1',
        displayName: 'A',
        avatarUrl: null,
        role: 'farmer',
        color: '#000',
        status: 'active' as const,
        lastSeen: Date.now(),
        cursor: null,
        cursorUpdates: 0,
        typingEvents: 0,
      };
      presence.join(roomKey, { ...base, socketId: 'k1', userId: 'u1', hidden: false });
      presence.join(roomKey, { ...base, socketId: 'k2', userId: 'u2', hidden: true });

      const users = await service.presenceFor(
        { id: 'owner', role: 'farmer' },
        'deal',
        'deal-1',
      );
      expect(users.map((u) => u.userId)).toEqual(['u1']);
    });
  });
});
