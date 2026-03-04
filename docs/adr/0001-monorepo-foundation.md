# ADR 0001: Monorepo Foundation

## Status

Accepted

## Decision

Vostok uses a single repository with:

- `apps/server` for the Phoenix backend
- `apps/web` for the React web client
- `packages/ui-tokens` for design tokens
- `packages/ui-primitives` for shared low-level UI building blocks
- `packages/ui-chat` for chat-domain UI contracts and components
- `docs` for architecture and design mappings

## Rationale

- Keeps backend and frontend contracts close together while the product is still greenfield.
- Supports the design-system-first approach required by the shared Figma kit.
- Keeps future iOS and Android implementations aligned on state contracts even before native apps are added.

## Consequences

- UI packages must avoid app-specific branding details.
- App code consumes semantic contracts rather than hardcoding layout rules directly.
- Backend APIs stay versioned from the start to avoid churn during early iteration.

