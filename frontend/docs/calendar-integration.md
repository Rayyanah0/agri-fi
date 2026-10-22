# Calendar Integration

Calendar connections are managed through the authenticated backend API under `/v1/platform/calendar`.

## Providers and sync

The connection model supports Google Calendar, Microsoft Outlook/Graph, and Apple Calendar (CalDAV). Provider adapters should exchange OAuth or CalDAV credentials for a connection, then create one `calendar_event` per source milestone or payment deadline. The source ID makes retries idempotent.

`preferences` controls whether `milestones` and `deadlines` are synchronized. `timezone` is an IANA timezone and all stored event timestamps are `timestamptz`; adapters convert only at the provider boundary.

`PUT /v1/platform/calendar/event` upserts a local event. A provider webhook or delta poll should call the same service with the external event version. If both versions changed since the last sync, keep the local record, mark it `conflict`, and use the existing notification service to alert the owner rather than silently overwriting data.

## Reminders and analytics

`reminderMinutes` is persisted per event and should be translated to the provider's reminder format. Sync workers should record success, conflict, and failure counts from `calendar_events.status`; the conflict rate is `conflict / attempted` and can be exported through the existing metrics module.

## Security

Access and refresh tokens must be encrypted before persistence and never returned by controllers. Provider webhooks must validate their signature, and reconnecting a provider replaces the old token set. Calendar writes are scoped to the authenticated user.