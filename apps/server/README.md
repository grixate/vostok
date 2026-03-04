# Vostok Server

This is the Phoenix backend for the Vostok foundation, identity, and early messaging stages.

## Current Scope

- API health endpoints
- bootstrap metadata endpoint
- device websocket scaffold
- registration endpoint
- device challenge/verify authentication endpoints
- authenticated linked-device enrollment endpoint
- device prekey publication and discovery endpoints with signed-prekey verification
- authenticated direct-chat endpoints
- authenticated group admin rename endpoint
- authenticated group member management endpoints
- authenticated group Sender Key distribution/list endpoints
- persisted direct-chat session bootstrap endpoints
- persisted direct-chat session establishment tracking (`pending_first_message` vs `established`)
- linked-device bootstrap now consumes one-time prekeys and retains the claimed prekey snapshot in each session transcript
- established direct-chat sessions now keep a stable bootstrap transcript during routine syncs instead of accepting fresh initiator ephemeral keys
- explicit direct-chat session rekey replaces a device-pair session with a fresh session record instead of mutating the established one in place
- superseded direct-chat sessions are retained for historical decrypt metadata instead of being deleted during rekey
- opaque message envelope persistence
- persisted message reactions
- persisted message replies via `reply_to_message_id`
- persisted message edits, deletes, and single-message pinning
- recipient device discovery for chat participants with encryption keys
- recipient-wrapped envelope metadata on message create/read
- recipient-envelope writes now require full active-device coverage for each chat message
- chunk-indexed multipart encrypted media uploads with resumable part tracking
- privacy-safe server-side link metadata fetch endpoint
- membership-gated `chat:{chat_id}` realtime fanout
- operator federation-peer status and heartbeat controls
- durable federation delivery queue entries with automatic Oban enqueue, mTLS worker dispatch, inbound relay ingestion, and manual enqueue/attempt APIs
- lightweight persisted call sessions with `call:{chat_id}` realtime state fanout
- persisted call participants plus a supervised `membrane_rtc_engine` room bootstrap per active call
- per-device Membrane WebRTC endpoint APIs backed by live `Membrane.RTC.Engine.Endpoint.WebRTC` instances
- persisted signaling events for offer/answer/ICE negotiation on top of the call topic
- joining a call provisions the current device endpoint automatically
- leaving a call removes the current device endpoint from room state
- endpoint queues now carry protocol-native Membrane media events (no `call_signal_bridge` fallback events)
- call start/end now persist chat-visible `system` messages, with a missed-call variant when no peer ever joined
- browser-originated SDP/ICE payloads can now flow through the signaling API for the Membrane integration seam
- browser-originated media-capable renegotiation payloads can now be produced by the web client
- identity schema foundation (`users`, `devices`, `one_time_prekeys`, `device_sessions`, `invites`)
- messaging schema foundation (`chats`, `chat_members`, `chat_device_sessions`, `messages`, `message_recipients`)
- Oban and Postgres wiring

## Local Development

1. Install `pkg-config` plus OpenSSL headers (`brew install pkg-config openssl@3` on macOS if needed)
2. Run `mix deps.get`
3. Start Postgres with `docker compose up -d postgres` from the repo root
4. Run `mix ecto.create && mix ecto.migrate`
5. Start the server with `mix phx.server`

If the native Membrane dependencies fail to find OpenSSL during compile, export:

- `PKG_CONFIG_PATH=/opt/homebrew/opt/openssl@3/lib/pkgconfig:$PKG_CONFIG_PATH`
- `CPPFLAGS=-I/opt/homebrew/opt/openssl@3/include`
- `CFLAGS=-I/opt/homebrew/opt/openssl@3/include`
- `LDFLAGS=-L/opt/homebrew/opt/openssl@3/lib`

## Current HTTP Endpoints

- `GET /health`
- `GET /api/v1/health`
- `GET /api/v1/bootstrap`
- `POST /api/v1/federation/deliveries`
- `POST /api/v1/register`
- `POST /api/v1/auth/challenge`
- `POST /api/v1/auth/verify`
- `POST /api/v1/devices/link`
- `POST /api/v1/devices/prekeys`
- `GET /api/v1/users/:username/devices/prekeys`
- `GET /api/v1/me`
- `GET /api/v1/chats`
- `POST /api/v1/chats/direct`
- `POST /api/v1/chats/group`
- `PATCH /api/v1/chats/:chat_id/group`
- `GET /api/v1/chats/:chat_id/members`
- `PATCH /api/v1/chats/:chat_id/members/:user_id`
- `POST /api/v1/chats/:chat_id/members/:user_id/remove`
- `GET /api/v1/chats/:chat_id/sender-keys`
- `POST /api/v1/chats/:chat_id/sender-keys`
- `POST /api/v1/chats/:chat_id/session-bootstrap`
- `POST /api/v1/chats/:chat_id/session-rekey`
- `GET /api/v1/chats/:chat_id/recipient-devices`
- `GET /api/v1/chats/:chat_id/messages`
- `POST /api/v1/chats/:chat_id/messages`
- `PATCH /api/v1/chats/:chat_id/messages/:message_id`
- `POST /api/v1/chats/:chat_id/messages/:message_id/delete`
- `POST /api/v1/chats/:chat_id/messages/:message_id/pin`
- `POST /api/v1/chats/:chat_id/messages/:message_id/reactions`
- `POST /api/v1/media/uploads`
- `PATCH /api/v1/media/uploads/:id/part`
- `POST /api/v1/media/uploads/:id/complete`
- `GET /api/v1/media/:id`
- `POST /api/v1/media/link-metadata`
- `GET /api/v1/admin/overview`
- `GET /api/v1/admin/federation/peers`
- `POST /api/v1/admin/federation/peers`
- `GET /api/v1/admin/federation/deliveries`
- `POST /api/v1/admin/federation/peers/:peer_id/deliveries`
- `POST /api/v1/admin/federation/deliveries/:job_id/attempt`
- `POST /api/v1/admin/federation/peers/:peer_id/status`
- `POST /api/v1/admin/federation/peers/:peer_id/heartbeat`
- `GET /api/v1/chats/:chat_id/calls/active`
- `POST /api/v1/chats/:chat_id/calls`
- `POST /api/v1/calls/turn-credentials`
- `GET /api/v1/calls/:call_id`
- `POST /api/v1/calls/:call_id/join`
- `POST /api/v1/calls/:call_id/webrtc-endpoint`
- `GET /api/v1/calls/:call_id/webrtc-endpoint`
- `POST /api/v1/calls/:call_id/webrtc-endpoint/media-events`
- `POST /api/v1/calls/:call_id/webrtc-endpoint/poll`
- `GET /api/v1/calls/:call_id/signals`
- `POST /api/v1/calls/:call_id/signals`
- `POST /api/v1/calls/:call_id/leave`
- `POST /api/v1/calls/:call_id/end`

## Current WebSocket Transport

- Path: `/socket/device`
- Topics:
  - `user:{user_id}`
  - `chat:{chat_id}`
  - `presence:{scope}`
  - `call:{chat_id}`

## Next Expected Work

- audited Signal-library migration on top of the current Stage 3 API/session contracts
- full sender-key and group interaction rules
- safety-number verification UX
