# Stage 1 Foundation Status

This document tracks what is now implemented from Stage 1 of the plan.

## Completed

- Phoenix application scaffold with Postgres and Oban
- Health endpoints at `/health` and `/api/v1/health`
- Bootstrap metadata endpoint at `/api/v1/bootstrap`
- Device websocket scaffold at `/socket/device`
- Shared frontend design-system packages:
  - `@vostok/ui-tokens`
  - `@vostok/ui-primitives`
  - `@vostok/ui-chat`
- Responsive web shell with:
  - desktop two-pane-plus-detail layout
  - mobile stacked adaptation
- Docker Compose baseline with:
  - `postgres`
  - `server`
  - `caddy`
  - `coturn`

## Intentionally Deferred to Later Stages

- Real registration and challenge-response auth
- Message persistence and encrypted routing
- Federation transport
- RTC signaling and media

## Stage 1 Exit Direction

The repository is now ready for the next slice of work: implementing real Stage 2 identity APIs on top of the existing schemas and transport scaffolding.

