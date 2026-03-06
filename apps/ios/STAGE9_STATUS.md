# Stage 9 iOS Status

Last updated: 2026-03-06

## Completed
- `S9-iOS-0` scaffold in `apps/ios` with app/tests/UI tests/notification extension and environment config.
- `S9-iOS-1` typed contracts, API client surface, custom Phoenix realtime client, repositories, push manager.
- `S9-iOS-2` design system foundation and Telegram-style chat list / conversation primitives.
- `S9-iOS-3` auth/register/login challenge flow with Keychain-backed key material and session persistence.
- `S9-iOS-4` chat list sync, realtime hints, local chat state (mute/pin/archive/unread), topic joins.
- `S9-iOS-5` conversation lifecycle: send/edit/delete/pin/reactions/reply/jump, attachment previews.
- `S9-iOS-6` encrypted media upload/download/decrypt flow, voice capture/playback, round-video capture.
- `S9-iOS-7` group admin/member flows, safety numbers verify flow, linked devices management.
- `S9-iOS-8` call lifecycle UI + state handling, TURN fetch, endpoint polling, APNs registration + notification service extension.
- SQLCipher + GRDB persistent storage (`VostokDatabase`) for chats/messages/pending outbox/session records.
- Native `libsignal` runtime/session integration expanded with persistence-backed session snapshots and sender-key caching/distribution hooks.
- SQLCipher migration extended for serialized session payloads and sender-key records.
- Group conversation send/load paths now warm and reuse persisted sender-key state instead of relying on in-memory-only runtime state.
- Legacy `SecureCodableStore` path removed; GRDB/SQLCipher is now the only local persistence path for cached mobile state.
- Profile and settings persistence improvements.
- Realtime client now exposes diagnostics/state snapshots, stale-link detection, and app lifecycle pause/resume handling; Settings includes a socket diagnostics dashboard for soak validation.
- iOS notification `mark read` actions now round-trip to the backend read-state endpoint instead of only clearing the local badge.
- Chat list header now surfaces live realtime connectivity state, and local unread state clears immediately after push-driven mark-read actions.
- Shared composer controls now enforce 44pt touch targets for attach/send/voice/reply-cancel actions to close the minimum-target accessibility gap.
- Chat list rows and voice bubbles now relax fixed-height constraints/touch targets so larger text sizes do not clip as aggressively.
- Settings diagnostics now support direct socket-log export to the pasteboard for real-device soak capture.

## Verified
- `xcodebuild` tests green:
  - `VostokTests` (43 tests)
  - `VostokUITests` (1 UI launch test)

## Remaining external/advanced items
- Empirical realtime soak validation on real devices across background/foreground and network handoff scenarios.
- Final exact-per-node Figma parity iteration remains constrained by the current Figma MCP seat call limit.

## Realtime soak matrix
- Cold start connect: socket should reach `connected` and rejoin topics without duplicate timeline items.
- Background to foreground: app background should pause the socket; foreground should resume and rejoin topics within one reconnect window.
- Wi-Fi to LTE handoff: diagnostics should show reconnect attempts and final `connected` state without manual relaunch.
- Airplane mode loss/recovery: socket should remain disconnected while offline and recover after network returns.
- Long background idle: resumed app should not keep a stale socket; diagnostics should either show a clean resume or reconnect.
- Stale socket detection: idle links beyond 90 seconds should be dropped and reconnected instead of remaining silently stuck.
- Forced token/session refresh: reconnect should not duplicate joins or duplicate message rendering.
- Rejoin after reconnect: joined topic list in Settings diagnostics should remain stable and sorted.

## Completion thresholds
- No duplicate rendered messages after reconnect or push-driven wake.
- No stuck `connecting` or `reconnecting` state beyond 30 seconds in the diagnostics dashboard.
- Conversation and chat list recover without requiring app relaunch.
