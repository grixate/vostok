# Stage 3 Messaging Status

This repository now includes the complete Stage 3 slice for the current architecture.

## Implemented

- Authenticated chat APIs:
  - `GET /api/v1/me`
  - `POST /api/v1/devices/link`
  - `GET /api/v1/chats`
  - `POST /api/v1/chats/direct`
  - `GET /api/v1/users/:username/devices/prekeys`
  - `POST /api/v1/chats/:chat_id/session-bootstrap`
  - `POST /api/v1/chats/:chat_id/session-rekey`
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
- Idempotent direct-chat session bootstrap on `POST /api/v1/chats/:chat_id/session-bootstrap`
- Bootstrap requests can now carry `initiator_ephemeral_keys` so each device-pair session records an explicit initiator ephemeral public key
- Bootstrapped sessions now expose a deterministic `handshake_hash` derived from the public session transcript
- Bootstrapped sessions now expose `establishment_state` and `established_at`, so the server can distinguish fresh session bootstrap from first-message establishment
- Once a session is established, routine bootstrap syncs no longer mutate its initiator ephemeral bootstrap key; the bootstrap transcript is frozen until a future explicit rekey flow
- Explicit session rekey is now available on `POST /api/v1/chats/:chat_id/session-rekey`, which replaces a device-pair session with a fresh pending-first-message session instead of mutating the old session in place
- Explicit rekey now preserves the old session record as `superseded`, so historical ciphertext can still resolve its original session metadata after a rotate
- New or re-handshaken sessions now derive their local root key through an HKDF-based X3DH-style transcript instead of a single digest compression step
- Session-encrypted message send path backed by persisted direct-chat session records
- Session-encrypted message headers now assert the expected session handshake per recipient device
- Session-encrypted messages now derive a fresh per-message key from the cached session root and a device-local send counter
- The client now tracks a local per-session ratchet state and caches skipped message keys for limited out-of-order delivery
- New or re-handshaken sessions now seed distinct initiator/recipient send and receive chains instead of sharing a single initial chain key
- Session-encrypted message headers now carry an explicit per-device ratchet version, and local ratchet state persists that version for backward-compatible decrypt paths
- Re-handshaken sessions now mix the previous cached root into the new transcript root, increment a local ratchet epoch, and stamp that epoch into session-encrypted headers
- Session-encrypted headers now also carry a per-device local ratchet public key, and inbound peer ratchet key changes can advance a local DH-ratchet epoch without a full session re-bootstrap
- Session-encrypted sends now report the `established_session_ids` they actually used, and the server records first-message establishment time for those session records
- The web client now only generates fresh initiator ephemeral bootstrap keys for recipients that do not already have an established direct-chat session
- Recipient-envelope writes now require full active-device coverage, so multi-device chats cannot silently drop decryptability for secondary devices
- Linked-device bootstrap consumes one-time prekeys server-side, and the client now prunes consumed local one-time prekeys during session synchronization
- New outbound user messages now require session transport and cannot fall back to legacy recipient wrapping
- Legacy recipient-wrapped and local-only envelopes remain readable for backward compatibility
- IndexedDB-backed local message cache for the active chat, with localStorage fallback/migration
- IndexedDB-backed secure key/value replication for session and sender-key material with localStorage compatibility during migration
- Phoenix Channel realtime fanout on `chat:{chat_id}` for live message delivery in the active chat
- Client-side safety-number display derived from local and remote identity keys for the active chat

## Current Meaning of Stage 3

This stage now delivers the repository’s full direct-message security lifecycle: signed-prekey-verified device identity, linked-device enrollment, per-device prekey discovery, one-time-prekey-aware session bootstrap, explicit session establishment tracking, explicit rekey with superseded-session retention, HKDF-based X3DH-style root derivation, and a local double-ratchet evolution path with role-aware chains, skipped-message handling, epoch transitions, and DH-ratchet key updates. The server continues to store opaque envelopes only. Multi-device decryptability is now enforced at write time by requiring recipient-envelope coverage for all active recipient devices, and linked-device bootstrap now consumes one-time prekeys in the expected direction. This is complete for the current custom protocol implementation; future hardening can still swap to an audited Signal library without changing the API contracts introduced here.
