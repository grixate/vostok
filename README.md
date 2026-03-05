# Vostok

Vostok is a greenfield secure messaging monorepo. This repository now includes an end-to-end Stage 1-8 implementation baseline:

- a Phoenix backend in [`apps/server`](./apps/server)
- a React web client in [`apps/web`](./apps/web)
- shared frontend packages for design tokens, primitives, and chat UI contracts in [`packages`](./packages)
- Figma mapping and architecture notes in [`docs`](./docs)
- local deployment orchestration in [`docker-compose.yml`](./docker-compose.yml)

Implemented scope:

- design-system-first web/desktop shell from the shared Figma mapping
- secure identity + linked devices + safety number verification
- encrypted direct/group messaging, sender-key group transport, media uploads
- federation queue + transport pipeline with protobuf envelope support
- Membrane-based calls with server-enforced group-call E2EE key epochs
- desktop packaging, signing, promotion, and rollback scripts

Native mobile clients remain out of scope for this repository phase.

## Quick Start

Web client:

- `npm install`
- `npm run dev:web`

Backend:

- `cd apps/server && mix deps.get`
- `docker compose up -d postgres`
- `cd apps/server && mix ecto.create && mix ecto.migrate`
- `npm run dev:server`

Desktop wrapper:

- `npm run setup:desktop`
- `npm run dev:desktop`
- `npm run build:desktop` (unsigned build + manifest)
- `npm run manifest:desktop`
- `npm run sign:desktop`
- `npm run package:desktop`
- `npm run release:desktop`
- `npm run promote:desktop:stable`
- `npm run rollback:desktop:stable`

Helpful endpoints:

- `GET /health`
- `GET /api/v1/health`
- `GET /api/v1/bootstrap`
- `POST /api/v1/federation/deliveries`
- `POST /api/v1/federation/peers/accept`
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
- `GET /api/v1/media/uploads/:id`
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
- `POST /api/v1/admin/federation/peers/:peer_id/invite`
- `GET /api/v1/chats/:chat_id/calls/active`
- `POST /api/v1/chats/:chat_id/calls`
- `POST /api/v1/calls/turn-credentials`
- `GET /api/v1/calls/:call_id`
- `POST /api/v1/calls/:call_id/join`
- `GET /api/v1/calls/:call_id/keys`
- `POST /api/v1/calls/:call_id/keys`
- `POST /api/v1/calls/:call_id/webrtc-endpoint`
- `GET /api/v1/calls/:call_id/webrtc-endpoint`
- `POST /api/v1/calls/:call_id/webrtc-endpoint/media-events`
- `POST /api/v1/calls/:call_id/webrtc-endpoint/poll`
- `GET /api/v1/calls/:call_id/signals`
- `POST /api/v1/calls/:call_id/signals`
- `POST /api/v1/calls/:call_id/leave`
- `POST /api/v1/calls/:call_id/end`

Stage 1 status is tracked in [docs/stage-1-foundation.md](./docs/stage-1-foundation.md).
Stage 2 identity/auth status is tracked in [docs/stage-2-identity.md](./docs/stage-2-identity.md).
Stage 3 messaging status is tracked in [docs/stage-3-messaging.md](./docs/stage-3-messaging.md).
Stage 4 media status is tracked in [docs/stage-4-media.md](./docs/stage-4-media.md).
Stage 5 groups status is tracked in [docs/stage-5-groups.md](./docs/stage-5-groups.md).
Stage 6-8 ops status is tracked in [docs/stage-6-8-ops.md](./docs/stage-6-8-ops.md).

Desktop release flow details are documented in [apps/desktop/README.md](./apps/desktop/README.md).
