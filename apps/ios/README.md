# Vostok iOS (Stage 9)

Native Swift/SwiftUI client scaffold and implementation track for Stage 9 (`iOS-0..8`).

## Targets
- `Vostok` (app)
- `VostokTests`
- `VostokUITests`
- `VostokNotificationService`

## Environment
Environment values are loaded from `Vostok/Resources/Environment.plist` and configured by:
- `Config/Debug.xcconfig`
- `Config/Release.xcconfig`

## Generate Project
```bash
cd apps/ios
./scripts/generate_project.sh
```

`xcodegen` currently emits a newer project format by default. `generate_project.sh` patches the pbxproj to be Xcode 15.4 compatible.

## Build
```bash
cd apps/ios
xcodebuild -project Vostok.xcodeproj -scheme Vostok -destination 'platform=iOS Simulator,name=iPhone 15' build
```

## Test
```bash
cd apps/ios
xcodebuild -project Vostok.xcodeproj -scheme Vostok -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:VostokTests test
xcodebuild -project Vostok.xcodeproj -scheme Vostok -destination 'platform=iOS Simulator,name=iPhone 15' -only-testing:VostokUITests test
```

## Notes
- Realtime uses a custom Phoenix websocket client for `/socket/device` topics.
- Crypto/runtime persistence now stores session snapshots and sender-key records in SQLCipher via GRDB.
- `SecureCodableStore` has been removed; repository-backed SQLCipher storage is the single mobile persistence path.
- UI components in `DesignSystem/Components` are tuned against Telegram iOS UI kit nodes:
  - `6424:11394` (chat list shell)
  - `6425:11260` (idle composer)
  - `6414:9877` and `6414:10345` (message/voice bubbles)
- Startup now validates backend contracts by calling `/health` and `/api/v1/bootstrap` before session restore.
- Settings now include API-backed linked device management (`/devices`, `/devices/link`, `/devices/:id/revoke`) and safety number workflows (`/chats/:id/safety-numbers`, `.../verify`).
- Settings now also expose realtime diagnostics for soak validation: connection state, reconnect attempts, joined topics, last disconnect reason, and recent socket log lines.
- Realtime diagnostics now include network availability, and the client gates reconnects while offline.
- Chat list header now shows a lightweight live connectivity badge for connected/reconnecting/offline state.
- Conversation now supports API-backed reply/edit/delete/pin/reactions with inline reply previews and jump-to-referenced-message behavior.
- Group conversation send/load paths now prewarm persisted sender-key state through `/chats/:id/sender-keys` and `/chats/:id/distribute-sender-keys`.
- Group member admin flows account for backend response shape (`member` for role/remove mutations, `members` for list).
- Call screen is reachable from conversation and supports `/calls` lifecycle actions: start, refresh active, join, leave, end, and endpoint polling.
- App scene lifecycle now pauses realtime in background/inactive state and resumes it on foreground activation for cleaner soak behavior.
- Push notification `Mark as Read` now calls `/api/v1/chats/:chat_id/read` with the latest pushed `message_id` when available.
- Push-driven mark-read also clears the local unread badge state immediately through an app-local read event.
- Shared composer actions now use 44pt touch targets to align with the primary iOS accessibility baseline.
- Chat list rows now allow vertical growth beyond the base Telegram-like row height, which avoids clipping under larger accessibility text sizes.
- Settings diagnostics now include a one-tap socket-log copy action so reconnect/stale-link evidence can be captured during real-device soak runs.
