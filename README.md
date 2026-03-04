# Vostok

Vostok is a greenfield secure messaging monorepo. This repository now includes the first implementation slice from the product plan:

- a Phoenix backend scaffold in [`apps/server`](./apps/server)
- a React web client in [`apps/web`](./apps/web)
- shared frontend packages for design tokens, primitives, and chat UI contracts in [`packages`](./packages)
- Figma mapping and architecture notes in [`docs`](./docs)
- an initial local deployment skeleton in [`docker-compose.yml`](./docker-compose.yml)

Implemented scope in this pass:

- monorepo and workspace structure
- shared design-system packages
- Figma-derived chat shell and responsive desktop adaptation
- versioned backend API scaffolding and identity schema stubs

This is not the full product yet. It is the foundation the remaining roadmap builds on.

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
- `npm run build:desktop` (now also regenerates the desktop release manifest)
- `npm run manifest:desktop`

Helpful endpoints:

- `GET /health`
- `GET /api/v1/health`
- `GET /api/v1/bootstrap`
- `POST /api/v1/register`
- `POST /api/v1/auth/challenge`
- `POST /api/v1/auth/verify`
- `POST /api/v1/devices/prekeys`
- `GET /api/v1/users/:username/devices/prekeys`
- `GET /api/v1/me`
- `GET /api/v1/chats`
- `POST /api/v1/chats/direct`
- `POST /api/v1/chats/group`
- `POST /api/v1/chats/:chat_id/session-bootstrap`
- `GET /api/v1/chats/:chat_id/recipient-devices`
- `GET /api/v1/chats/:chat_id/messages`
- `POST /api/v1/chats/:chat_id/messages`
- `POST /api/v1/chats/:chat_id/messages/:message_id/reactions`
- `POST /api/v1/media/uploads`
- `PATCH /api/v1/media/uploads/:id/part`
- `POST /api/v1/media/uploads/:id/complete`
- `GET /api/v1/media/:id`
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

Stage 1 status is tracked in [docs/stage-1-foundation.md](./docs/stage-1-foundation.md).
Stage 2 identity/auth status is tracked in [docs/stage-2-identity.md](./docs/stage-2-identity.md).
Stage 3 messaging status is tracked in [docs/stage-3-messaging.md](./docs/stage-3-messaging.md).
Stage 4 media status is tracked in [docs/stage-4-media.md](./docs/stage-4-media.md).
Stage 5 groups status is tracked in [docs/stage-5-groups.md](./docs/stage-5-groups.md).
Stage 6-8 ops status is tracked in [docs/stage-6-8-ops.md](./docs/stage-6-8-ops.md).

Desktop packaging now has an initial scaffold in [apps/desktop/README.md](./apps/desktop/README.md).
