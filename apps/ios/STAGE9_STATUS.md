# Stage 9 iOS Status

Last updated: 2026-03-05

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
- Native `libsignal` runtime/session integration baseline (`SignalSessionRuntime`) with session bootstrap/rekey wiring.
- Profile and settings persistence improvements.

## Verified
- `xcodebuild` tests green:
  - `VostokTests` (32 tests)

## Remaining external/advanced items
- Expand libsignal runtime from session bootstrap/rekey baseline to full sender-key and ratchet persistence APIs.
- Migrate remaining legacy cache paths off `SecureCodableStore` where still used outside repository-backed flows.
- Exact per-node Figma parity iteration is constrained by current Figma MCP seat call limit.
