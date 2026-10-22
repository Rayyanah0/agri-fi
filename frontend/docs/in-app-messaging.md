# In-app messaging

AgriFi messaging supports direct conversations, group conversations, deal-linked
teams, attachments, search, read receipts, reactions, replies, and personal
communication analytics. The dashboard entry is **Messages**.

## Security and data handling

- HTTP requests use the existing JWT authentication. Socket.IO clients connect
  to `/chat` with the same JWT; each requested conversation is checked against
  its participant list before the socket joins its room.
- In production, serve the frontend and API over HTTPS and configure the
  Socket.IO endpoint for WSS. The local development endpoint is plain HTTP.
- Message text is encrypted with AES-256-GCM before persistence. The API needs
  `ENCRYPTION_KEY` set to a randomly generated 64-character hex key (32 bytes).
  Keep the key in the deployment secret manager; do not use the example key
  from `.env.example` outside local development. Back up the key securely:
  stored messages cannot be decrypted without it.
- Attachments and filenames are encrypted with authenticated encryption;
  attachment bytes are encrypted before upload to the existing IPFS/S3 storage
  service. Files are malware-scanned and served back only through the
  authenticated conversation-member endpoint. Chat attachments are limited to
  10 MB and PDF, PNG, JPEG, or plain text.
- Search decrypts messages only after verifying conversation membership. To
  avoid placing plaintext indexes in the database, it scans up to the newest
  10,000 messages in that conversation and returns at most 50 matches.
- Analytics are aggregate message counts for conversations the requesting user
  belongs to. They do not include message text.

## Conversation behavior

- A one-recipient conversation without a name or deal is a direct message.
- Multiple recipients, a group name, or a deal ID creates a group conversation.
- Deal-linked conversations are limited to the deal's farmer, trader, investors,
  and accepted co-farmers. General groups can include users found through
  authenticated contact search.
- Messages support replies and six reactions: 👍, ❤️, 😂, 🎉, 🙏, and 👀.
- Read status is based on each participant's last-read timestamp. An outgoing
  message shows **Seen** after another participant reads the conversation.
- Messages are persisted through the REST API and delivered to joined
  participants in real time over Socket.IO. Reconnecting clients reload stored
  conversation history.

## Deployment

1. Set a unique `ENCRYPTION_KEY` secret for the backend before deploying.
2. Apply the `CreateChat1900000000000` migration with the normal backend
   TypeORM migration command.
3. Serve the API with HTTPS and the Socket.IO namespace with WSS in production.
   Set `NEXT_PUBLIC_API_URL` to the API origin for the frontend build when it
   differs from `http://localhost:3001`.
4. Confirm the existing malware scanner and IPFS/S3 storage configuration are
   available before enabling file sharing.

The collaboration improvement target is not claimed as measured. Evaluate it
with a before/after team study using message response time, conversation
completion rate, and time spent coordinating; do not infer a percentage from
message counts alone.
