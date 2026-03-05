# Stage 9 Android Status

Last updated: 2026-03-05

## Completed
- `AND-0` baseline scaffold created under `apps/android`.
- Compose app shell + bottom-tab navigation (`Chats`, `Contacts`, `Settings`).
- Build config/environment constants for Vostok instance URLs.
- Core folder architecture aligned to native plan (`core`, `features`, `designsystem`, `navigation`).
- Typed network baseline for `/health` and `/api/v1/bootstrap`.
- Extended auth/identity contracts for `/register`, `/auth/challenge`, `/auth/verify`, `/me`, `/devices/prekeys`.
- App-level DI container and session persistence (`AppContainer`, `SessionStore`, `AppState`).
- SQLCipher + Room baseline (`VostokDatabase`, entities, DAOs), including `pending_outbox` and `signal_session`.
- Repository layer for auth/chat/message sync with offline fallback and pending outbox flush.
- Realtime socket bootstrap on authenticated sessions via Phoenix websocket manager.
- Expanded API contracts and client methods for:
  - chat direct/group creation and group member/safety flows
  - message update/delete/pin/reaction lifecycle
  - device listing/revocation
  - call lifecycle (`active/create/state/join/signals/leave/end` and endpoint polling)
- Conversation route + ViewModel now supports send/edit/delete/pin/reaction and realtime timeline refresh.
- Recipient envelope payload generation now maps per-recipient session hints by device (from `signal_session` cache/bootstrap mapping).
- Contact flow upgraded: contact list from chat participants + direct chat creation path.
- Settings flow upgraded: devices list/revoke screen and privacy settings screen.
- Group flow upgraded: create group + group info (members, role updates/removal, safety verification).
- Call flow upgraded: start/attach/join/leave/end + signal heartbeat UI.
- Media flow upgraded: `/media/uploads` multipart lifecycle wired in repository + Compose media screens (`MediaGallery`, `ImageViewer`, link metadata fetch).
- Media-to-message integration: uploaded media references can now be sent directly to conversation as `message_kind=file`.
- Conversation composer extended with quick `voice` and `video_round` message kind send paths.
- Voice/round recorder utility classes added (`VoiceRecorder`, `RoundVideoRecorder`) for upcoming capture UI integration.
- Realtime call ingestion hardened: `CallViewModel` now reacts to `call:state`, `call:participant_state`, `call:signal` events and refreshes call state.
- Settings/profile coverage extended: profile screen and standalone safety-number screen are now wired in app navigation.
- Recipient envelope generation hardened: per-device envelope payloads now include device/session-bound AES-GCM encrypted blobs (contract-compatible map payloads).
- Android toolchain unblocked locally: Java runtime installed + Gradle wrapper pipeline works in this environment.
- Build validation now passing: `:app:assembleDebug` and `:app:testDebugUnitTest`.
- Identity signing path upgraded to backend-compatible Ed25519 material/signatures (persistent local key storage) instead of keystore placeholder ECDSA.

## Pending
- `AND-1` hardening: replace temporary Ed25519 local key store with production secure hardware-backed or encrypted-at-rest key management policy.
- `AND-2` hardening: robust reconnect/backoff and event reconciliation testing across app background/foreground transitions.
- `AND-3` encryption hardening: replace current device/session-derived AES envelope scheme with full libsignal session-cipher per-recipient encryption.
- `AND-4+` parity pass: media pipeline, voice/round video capture/playback, push action handling, and visual parity refinement.
- `AND-4+` parity pass: full capture/playback UX for voice/round-video, push action handling, and visual parity refinement.

## Verification
- Structural sanity checks completed (source wiring + route/repository linkage).
- Gradle wrapper available (`apps/android/gradlew`).
- Full Android build/tests now runnable in this shell.
