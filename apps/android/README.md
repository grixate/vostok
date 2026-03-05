# Vostok Android (Stage 9)

This directory contains the Stage 9 Android native client scaffold for Vostok.

## Current scope

- Kotlin + Jetpack Compose app shell (`chat.vostok.android`)
- Material3 design-system baseline with Telegram-inspired light theme tokens
- Core package layout aligned with `vostok-native-mobile-plan.md`
- REST bootstrap and auth contracts
- Phoenix websocket manager with topic join + heartbeat + reconnect
- SQLCipher + Room baseline with chat/message/contact + pending outbox + session tables
- `libsignal-client` dependency wiring and session runtime scaffolding
- backend-compatible Ed25519 identity/signature flow (register/challenge path)
- Repository + app container wiring for auth/chat/message/contact/group/call/device flows
- Chat list + conversation with send/edit/delete/pin/reaction lifecycle and realtime refresh
- Contacts direct-chat flow, group create/info flow, devices/privacy settings flow, call control screens
- Media upload lifecycle flow (`/media/uploads` create/part/complete/status/show) + link metadata fetch UI
- Media reference send path from media flow into conversation messages
- Profile + safety-number utility screens wired from settings
- Quick voice/round-video message kind sends wired in conversation

## Project notes

- `minSdk`: 26
- `targetSdk`: 35
- Build system: Gradle Kotlin DSL
- Gradle wrapper included (`./gradlew`)
- Main app entry point: `app/src/main/java/chat/vostok/android/app/MainActivity.kt`
- Local SDK config: `apps/android/local.properties` with `sdk.dir=/Users/grigorymikhailov/Library/Android/sdk`

## Remaining milestones

1. Replace placeholder key/signature runtime with production Ed25519/X25519 flow compatible with backend challenge verification
2. Harden realtime reconciliation and reconnect behavior under lifecycle/background transitions
3. Replace envelope/session-hint messaging path with real per-device encrypted envelopes
4. Complete media/voice/round-video and push parity passes
