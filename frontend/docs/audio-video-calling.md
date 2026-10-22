# Audio / Video Calling

Route: `/dashboard/calls` (sidebar **Calls**). Incoming calls ring on any dashboard page because `CallProvider` wraps `DashboardLayout` content.

## Architecture

```
Browser A ──socket.io /calls (JWT)──► Backend signaling ◄──socket.io /calls (JWT)── Browser B
    │                                                                                   │
    └──────────────────── WebRTC (DTLS-SRTP, peer-to-peer) ─────────────────────────────┘
```

| File | Purpose |
|---|---|
| `src/lib/calling/call-manager.ts` | `CallManager`: signaling, RTCPeerConnection, controls, recording, quality, history |
| `src/lib/calling/quality.ts` | `getStats()` sampling and quality rating |
| `src/lib/calling/store.ts` | Call history, scheduled calls, analytics |
| `src/lib/calling/types.ts` | Shared types and signaling payloads |
| `src/components/calling/CallProvider.tsx` | Context, incoming-call modal, active call window, reminders |
| `src/components/calling/CallWindow.tsx` | In-call UI |
| `src/components/calling/IncomingCallModal.tsx` | Accept / decline |
| `src/components/calling/CallCenter.tsx` | Start, schedule, history, analytics |

## Signaling contract (backend `/calls` namespace)

The socket authenticates with `auth: { token }`; the server must verify the JWT and relay each event only to the user in `to`, overwriting `from` with the authenticated user.

| Event | Payload |
|---|---|
| `call:invite` | `{ callId, from, to, media, dealId?, fingerprint }` |
| `call:offer` / `call:accept` | `{ callId, from, to, sdp }` |
| `call:ice` | `{ callId, from, to, candidate }` |
| `call:decline` / `call:hangup` / `call:busy` | `{ callId, from, to }` |
| `call:recording-consent` | `{ callId, from, to, requested? , granted? }` |
| `call:error` (server → client) | `{ message }` |

## Features

- **Call UI** – mute, camera on/off (audio calls can upgrade to video via renegotiation), screen share (`getDisplayMedia` + `replaceTrack`), hang-up, live timer.
- **Scheduling** – pick a time, duration and audio/video; a reminder with a *Join* button (and a browser notification) appears 5 minutes before.
- **Recording with consent** – the requester can only record after the other participant clicks *Allow*; a `● REC` badge is shown to both sides. Recordings are local `.webm` downloads (`MediaRecorder`).
- **Notifications** – full-screen incoming-call dialog; browser notification when the tab is hidden. Unanswered calls are marked *missed* after 45 s.
- **Quality monitoring** – RTT, jitter, packet loss and bitrate every 3 s, shown as excellent/good/fair/poor.
- **History & analytics** – each call is stored with participants, direction, deal, duration, outcome, recording flag and average quality. Analytics show totals, completion rate, average and total talk time, and quality/outcome breakdowns.
- **Security** – WebRTC media is always encrypted with DTLS-SRTP. The caller's DTLS fingerprint is sent in the authenticated invite and checked against the SDP; a mismatch aborts the call. The UI shows 🔒 when verified.

## Configuration

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_TURN_URL` | TURN server for restrictive NATs (STUN is used by default) |
| `NEXT_PUBLIC_TURN_USERNAME` / `NEXT_PUBLIC_TURN_CREDENTIAL` | TURN credentials |
