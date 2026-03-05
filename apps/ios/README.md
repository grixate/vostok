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
- Crypto interfaces are structured for `libsignal-client` integration and currently provide Stage-9 bootstrap behavior.
- UI components in `DesignSystem/Components` are tuned against Telegram iOS UI kit nodes:
  - `6424:11394` (chat list shell)
  - `6425:11260` (idle composer)
  - `6414:9877` and `6414:10345` (message/voice bubbles)
- Startup now validates backend contracts by calling `/health` and `/api/v1/bootstrap` before session restore.
- Settings now include API-backed linked device management (`/devices`, `/devices/link`, `/devices/:id/revoke`) and safety number workflows (`/chats/:id/safety-numbers`, `.../verify`).
- Conversation now supports API-backed reply/edit/delete/pin/reactions with inline reply previews and jump-to-referenced-message behavior.
- Group member admin flows account for backend response shape (`member` for role/remove mutations, `members` for list).
- Call screen is reachable from conversation and supports `/calls` lifecycle actions: start, refresh active, join, leave, end, and endpoint polling.
