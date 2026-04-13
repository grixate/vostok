# Stage 3 Messaging Status

This repository now includes the complete Stage 3 slice for the current architecture.

## Implemented

- Authenticated chat APIs:
  - `GET /api/v1/me`
  - `POST /api/v1/devices/link`
  - `GET /api/v1/chats`
  - `POST /api/v1/chats/direct`
  - `GET /api/v1/users/:username/devices/prekeys`
  - `GET /api/v1/chats/:chat_id/messages`
  - `POST /api/v1/chats/:chat_id/messages`
- Messaging schema foundation:
  - `chats`
  - `chat_members`
  - `chat_device_sessions`
  - `messages`
  - `message_recipients`
- Direct self-chat bootstrap (`Saved Messages`) for the first usable chat experience
- Opaque message envelope persistence on the server
- Recipient device discovery on `GET /api/v1/chats/:chat_id/recipient-devices`
- Discoverable per-device prekey bundles on `GET /api/v1/users/:username/devices/prekeys`
  - signed prekeys are now backed by verified Ed25519 signatures
- Authenticated linked-device enrollment on `POST /api/v1/devices/link`
  - links additional devices to an existing account without re-registering the user
  - issues a bearer session for the linked device immediately
  - enforces signed-prekey verification and requires one-time prekeys
- Uniform `signal-v1` message transport for new outbound user messages in both direct and group chats
- Per-device recipient envelope coverage is enforced for Signal sends, so multi-device decryptability cannot silently fall back to shared ciphertext fanout
- Published prekey bundles now serve as the live bootstrap path for new pairwise Signal sessions on both messaging and calling flows
- Local decryptability remains backward-compatible with older sender-key and recipient-wrapped history
- Recipient-envelope writes now require full active-device coverage, so multi-device chats cannot silently drop decryptability for secondary devices
- Linked-device bootstrap consumes one-time prekeys server-side, and the client now prunes consumed local one-time prekeys during session synchronization
- New outbound user messages now require `crypto_scheme=signal-v1` and cannot fall back to legacy recipient wrapping
- Legacy recipient-wrapped and local-only envelopes remain readable for backward compatibility
- IndexedDB-backed local message cache for the active chat, with localStorage fallback/migration
- IndexedDB-backed secure key/value replication for session and sender-key material with localStorage compatibility during migration
- Phoenix Channel realtime fanout on `chat:{chat_id}` for live message delivery in the active chat
- Client-side safety-number display derived from local and remote identity keys for the active chat

## Current Meaning of Stage 3

This stage now delivers the repository’s current messaging security lifecycle: signed-prekey-verified device identity, linked-device enrollment, per-device prekey discovery, Signal session bootstrap from published prekeys, and opaque server-side envelope storage. The live transport contract for new user messages is `crypto_scheme=signal-v1` with full active-device recipient coverage in both direct and group chats. Older sender-key and recipient-wrapped records remain decryptable for backward compatibility, but they are no longer the active send path.
