# Real-Time Collaboration

Live cursors, presence indicators and activity status for people viewing the
same trade deal or document (#1234). Presence travels over a dedicated
socket.io namespace (`/collaboration`) and is ephemeral; durable session history
and analytics are stored in PostgreSQL.

---

## 1. Architecture

```
Browser A ─┐
           ├─ socket.io (/collaboration) ── CollaborationGateway
Browser B ─┘                                     │
                                                 ├─ PresenceService (in-memory, live state)
                                                 ├─ CollaborationService (sessions, permissions, analytics)
                                                 └─ NotificationsService (join/leave notifications)
```

* **Transport** — socket.io, same origin, namespace `/collaboration`, authenticated
  with the existing JWT (`auth: { token }`). The backend reuses
  `WsJwtGuard` from the notifications module.
* **Live state** — `PresenceService` keeps an in-memory map of
  `room → socket → participant`. It is rebuilt as clients connect, so it never
  becomes a source of truth.
* **Durable state** — `collaboration_sessions` (history + analytics) and
  `collaboration_permissions` (who may observe presence).
* **Rooms** are keyed by `"{resourceType}:{resourceId}"` where `resourceType` is
  `deal` or `document`.

---

## 2. Frontend API

### `useCollaboration(resourceType, resourceId, options)`

| Field | Type | Description |
| --- | --- | --- |
| `connected` | `boolean` | Socket connected |
| `participants` | `Collaborator[]` | Visible viewers (self included) |
| `cursors` | `RemoteCursor[]` | Other users' live cursors |
| `typingUsers` | `string[]` | User IDs currently typing |
| `selfUserId` | `string \| null` | Current user, decoded from the JWT |
| `hidden` | `boolean` | Whether the local user has hidden presence |
| `sendCursor(x, y)` | `(x, y) => void` | Broadcast normalized cursor position |
| `setTyping(bool)` | `(b) => void` | Broadcast typing state |
| `setPresenceVisible(bool)` | `(b) => void` | Toggle privacy |

Options: `displayName`, `avatarUrl`, `enabled`, `onCollaboratorJoined`,
`onCollaboratorLeft`.

```tsx
const { participants, cursors, setPresenceVisible } = useCollaboration(
  'deal',
  dealId,
  { displayName: user?.name },
);
```

### `CollaborationPresence`

A drop-in wrapper that renders the presence bar, activity status and live
cursors, wires join/leave toasts, and broadcasts the local cursor while the
pointer moves over the page.

```tsx
import { CollaborationPresence } from '@/components/collaboration/CollaborationPresence';

<CollaborationPresence resourceType="deal" resourceId={deal.id} />
```

It is integrated on the marketplace deal page and on the documents dashboard
when a PDF is opened.

### Components

| Component | File | Purpose |
| --- | --- | --- |
| `PresenceBar` | `src/components/collaboration/PresenceBar.tsx` | Avatars, status dots, viewer count, privacy toggle |
| `LiveCursors` | `src/components/collaboration/LiveCursors.tsx` | Colored cursors with name labels |
| `ActivityStatus` | `src/components/collaboration/ActivityStatus.tsx` | "X is typing…" and idle counts |
| `CollaborationPresence` | `src/components/collaboration/CollaborationPresence.tsx` | Composition + notifications |

---

## 3. Socket protocol

### Client → server

| Event | Payload | Notes |
| --- | --- | --- |
| `join_room` | `{ resourceType, resourceId, displayName?, avatarUrl? }` | Opens a session |
| `leave_room` | `{ resourceType, resourceId }` | Closes the session |
| `cursor_move` | `{ resourceType, resourceId, x, y }` | `x`/`y` normalized `0..1`, throttled at 40 ms |
| `typing` | `{ resourceType, resourceId, isTyping }` | |
| `activity_ping` | `{ resourceType, resourceId }` | Heartbeat (every 30 s) |
| `set_presence_visibility` | `{ resourceType, resourceId, visible }` | Privacy toggle |
| `screen_share_signal` | `{ resourceType, resourceId, type, data }` | WebRTC offer, answer, or ICE candidate |
| `screen_share_annotation` | `{ resourceType, resourceId, points, color? }` | Normalized drawing stroke, max 500 points |

### Server → client

| Event | Payload | Notes |
| --- | --- | --- |
| `presence_update` | `{ users: Collaborator[] }` | Full visible roster |
| `cursor_update` | `{ userId, displayName, color, avatarUrl, x, y }` | Sent to everyone except the sender |
| `user_typing` | `{ userId, displayName, isTyping }` | |
| `activity_status` | `{ userId, status }` | `active` \| `idle` \| `typing` |
| `collaborator_joined` | `{ user }` | Also persisted as a notification |
| `collaborator_left` | `{ userId, displayName }` | Also persisted as a notification |
| `screen_share_signal` | `{ type, data, from }` | Forwarded to other room members |
| `screen_share_annotation` | `{ points, color, from }` | Forwarded drawing stroke |

A participant is marked **idle** after 90 s without activity
(`PRESENCE_IDLE_MS`). A remote cursor disappears 6 s after its last update
(`CURSOR_TTL_MS`).

---

## 4. Permissions & privacy

`collaboration_permissions` stores one row per `(resourceType, resourceId, user)`.
A row with a null `userId` is the **resource default policy**:

| Field | Meaning |
| --- | --- |
| `visibility` | `everyone` (any authenticated viewer) or `invited` (allow-list only) |
| `canViewPresence` | Per-user override / allow-list entry |

The resource owner (deal farmer/trader, document uploader) or an admin manages
the policy. Separately, any user can hide themselves with the eye toggle in the
`PresenceBar` — hidden users are omitted from `presence_update` but still count
for their own session history.

REST endpoints (all require a JWT):

| Method | Path |
| --- | --- |
| `GET` | `/v1/collaboration/:resourceType/:resourceId/presence` |
| `GET` | `/v1/collaboration/:resourceType/:resourceId/history` |
| `GET` | `/v1/collaboration/:resourceType/:resourceId/analytics` |
| `GET` | `/v1/collaboration/:resourceType/:resourceId/permissions` |
| `PUT` | `/v1/collaboration/:resourceType/:resourceId/permissions` |
| `PUT` | `/v1/collaboration/:resourceType/:resourceId/presence-visibility` |
| `GET` | `/v1/collaboration/analytics` (admin) |

---

## 5. History, analytics & notifications

* Each join writes a `collaboration_sessions` row; leaving (or disconnecting)
  finalises `left_at`, `duration_seconds`, `cursor_updates` and `typing_events`.
* `GET .../analytics` returns total sessions, unique collaborators, average and
  total duration, cursor/typing totals, **peak concurrency** and a per-day
  breakdown. `GET /v1/collaboration/analytics` aggregates every resource
  (admin only).
* Join/leave events are emitted to the room and persisted through
  `NotificationsService` for the other collaborators, so they appear in the
  notification bell and as toasts.

---

## 6. Configuration

| Env var | Default | Purpose |
| --- | --- | --- |
| `PRESENCE_IDLE_MS` | `90000` | Inactivity before a user is marked idle |

Frontend constants live in `src/lib/collaboration.ts` (`CURSOR_TTL_MS`,
`CURSOR_SEND_MS`).

> Deploying multiple backend replicas? Attach the socket.io Redis adapter in
> `main.ts` so room broadcasts fan out between pods. The in-memory
> `PresenceService` is per-instance; presence is reconciled through the adapter.

---

## 7. Testing

* Backend unit tests: `backend/src/collaboration/collaboration.service.spec.ts`
  (permissions, session lifecycle, analytics, privacy filter).
* Frontend helper tests: `frontend/src/lib/__tests__/collaboration.test.ts`.
* Manual: open the same deal in two browser profiles, move the pointer and type
  in an input — cursors, typing dots and the presence avatars update live.

---

## Maintenance

Owners: frontend + backend platform teams. When changing the socket protocol,
update this document and `collaboration.gateway.ts` together; the event names
are part of the client contract.
