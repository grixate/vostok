# Stage 3 Messaging Status

This repository now includes the current practical Stage 3 slice.

## Implemented

- Authenticated chat APIs:
  - `GET /api/v1/me`
  - `GET /api/v1/chats`
  - `POST /api/v1/chats/direct`
  - `GET /api/v1/users/:username/devices/prekeys`
  - `POST /api/v1/chats/:chat_id/session-bootstrap`
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
- Idempotent direct-chat session bootstrap on `POST /api/v1/chats/:chat_id/session-bootstrap`
- Bootstrap requests can now carry `initiator_ephemeral_keys` so each device-pair session records an explicit initiator ephemeral public key
- Bootstrapped sessions now expose a deterministic `handshake_hash` derived from the public session transcript
- Session-encrypted message send path backed by persisted direct-chat session records
- Session-encrypted message headers now assert the expected session handshake per recipient device
- Session-encrypted messages now derive a fresh per-message key from the cached session root and a device-local send counter
- The client now tracks a local per-session ratchet state and caches skipped message keys for limited out-of-order delivery
- Recipient-wrapped message envelopes for devices that have published an encryption public key
- Legacy browser-local AES-GCM fallback for older devices and previously stored local-only messages
- Local message cache in browser storage for the active chat
- Phoenix Channel realtime fanout on `chat:{chat_id}` for live message delivery in the active chat

## Not Yet Implemented

- Signal X3DH session establishment
- Double Ratchet
- Cross-device decryptability
- IndexedDB-backed offline store

## Current Meaning of Stage 3

This is the transport and data-model foundation for messaging. The server stores opaque ciphertext envelopes and never inspects message contents. Direct chats can now bootstrap stable device-pair session records, including an explicit initiator ephemeral public key and a verifiable handshake hash, and use those cached session roots to advance a simple local ratchet and derive fresh per-message keys. The full Signal-grade multi-device ratchet is still the next cryptographic slice.
