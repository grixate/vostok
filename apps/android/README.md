# Vostok Android (Stage 9)

This directory contains the Stage 9 Android native client scaffold for Vostok.

## Current scope

- Kotlin + Jetpack Compose app shell (`chat.vostok.android`)
- Material3 design-system baseline with Telegram-inspired light theme tokens
- Core package layout aligned with `vostok-native-mobile-plan.md`
- REST bootstrap and auth contracts
- Phoenix websocket manager with topic join + heartbeat + reconnect
- SQLCipher + Room baseline with chat/message/contact + pending outbox + session tables
- native `libsignal-client` session runtime (SessionRecord + SessionCipher) with persisted ratchet state
- backend-compatible Ed25519 identity/signature flow (register/challenge path)
- encrypted preference-backed key/session storage with dedicated auth-signing provider selection (legacy identity preserved, Android Keystore Ed25519 preferred for new supported installs)
- signing-provider migration is now persisted explicitly so upgrade installs do not flap between legacy and keystore auth identities
- Repository + app container wiring for auth/chat/message/contact/group/call/device flows
- Chat list + conversation with send/edit/delete/pin/reaction lifecycle and realtime refresh
- Contacts direct-chat flow, group create/info flow, devices/privacy settings flow, call control screens
- Media upload lifecycle flow (`/media/uploads` create/part/complete/status/show) + link metadata fetch UI
- Media reference send path from media flow into conversation messages
- Profile + safety-number utility screens wired from settings
- Push action handling for chat notifications (`open`, `mark read`, inline `reply`)
- Voice recording/playback controls + short video capture/preview controls in conversation
- Push token + chat read-state backend roundtrips (`/devices/push-token`, `/chats/:chat_id/read`)
- In-app round-video capture using CameraX (front camera preview + record/stop + upload send)
- Connectivity-aware websocket lifecycle with stale-link recovery
- Chat list socket diagnostics (`state` + reconnect counter) for soak monitoring
- Upload viewer now renders inline image/video/audio/text previews
- Secure storage status is surfaced in Settings (encrypted-at-rest + strongbox request + hardware-backed detection when available)
- Accessibility baselines tightened on shared controls (minimum tap targets + semantic labels)
- Settings includes realtime soak diagnostics (socket state, reconnect counters, recent socket event log)
- Composer now supports IME send action and prevents empty-message submits
- Active conversation refresh now also best-effort marks the chat read against `/chats/:chat_id/read`
- Reconnect test coverage now includes lifecycle decision checks for paused/network-loss/authorized reconnect paths
- Use the Settings socket dashboard as the empirical validation surface for the soak matrix in `STAGE9_ANDROID_STATUS.md`
- Settings content now scrolls cleanly on smaller screens, and conversation bubble semantics expose message/timestamp context for assistive technologies.
- Conversation action rows now scroll horizontally on narrow devices instead of compressing or clipping controls.
- Chat list/contact navigation now forwards known chat titles into the conversation top bar for better Telegram-style parity.

## Project notes

- `minSdk`: 26
- `targetSdk`: 35
- Build system: Gradle Kotlin DSL
- Gradle wrapper included (`./gradlew`)
- Main app entry point: `app/src/main/java/chat/vostok/android/app/MainActivity.kt`
- Local SDK config: `apps/android/local.properties` with `sdk.dir=/Users/grigorymikhailov/Library/Android/sdk`

## Remaining milestones

1. Execute extended real-device websocket soak runs and capture reconnect telemetry from Settings diagnostics
2. Continue exact visual tuning against design references where device screenshots still diverge
