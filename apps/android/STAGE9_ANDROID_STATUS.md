# Stage 9 Android Status

Last updated: 2026-03-06

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
- Android toolchain unblocked locally: Java runtime installed + Gradle wrapper pipeline works in this environment.
- Build validation now passing: `:app:assembleDebug` and `:app:testDebugUnitTest`.
- Identity signing path upgraded to backend-compatible Ed25519 material/signatures (persistent local key storage) instead of keystore placeholder ECDSA.
- Signal key material persistence added (identity + signed prekey + one-time prekeys) and registration/login now publish Signal-compatible prekeys while keeping backend Ed25519 verification intact.
- Session runtime upgraded to native `libsignal-client` ratchet sessions via `/session-rekey` handshake material (`SessionRecord.initializeAlice/Bob` + `SessionCipher`).
- Message recipient envelopes now use per-device libsignal ciphertext (`v3.libsignal`) with Room-persisted serialized session records.
- SQLCipher Room migration added (`v2 -> v3`) for persisted signal session address + ratchet record state.
- Recipient envelope delivery is now fail-closed for missing sessions (no plaintext fallback path).
- Session/key preference storage hardened via encrypted preferences (Android keystore-backed where available, fallback otherwise).
- Websocket lifecycle hardened with pause/resume hooks, exponential reconnect backoff, and explicit `socket:reconnected` reconciliation events consumed by chat/call/conversation view-models.
- Push action handling implemented (open chat, mark read, inline reply) for FCM/UnifiedPush paths.
- Conversation parity improvements: inline voice recording + playback controls and short video capture/preview/send controls.
- Push token registration is now round-tripped to backend (`POST /api/v1/devices/push-token`) for both FCM and UnifiedPush.
- Chat read-state roundtrip implemented (`POST /api/v1/chats/:chat_id/read`) and wired to notification mark-read action.
- Round-video capture upgraded from system intent fallback to in-app CameraX capture/preview flow with direct upload send.
- Realtime lifecycle hardened further with connectivity callbacks (`network_available`/`network_unavailable`) and stale-socket detection (`socket:stale`) to recover long-idle links.
- Chat list now surfaces socket state and reconnect-attempt diagnostics for long-run reconnect monitoring.
- Media viewer now supports inline preview/playback for image, video, audio, and text uploads from local cache.
- Reconnect backoff logic now has deterministic unit-test coverage (`WebSocketManagerBackoffTest`) for immediate reconnect, growth/cap, and jitter clamping.
- Secure storage policy strengthened with StrongBox-preferred master-key provisioning and runtime hardware-backed status introspection surfaced in Settings.
- Accessibility polish pass on shared UI primitives: minimum touch targets and explicit semantics/content labels for common action and row components.
- Settings now includes a socket soak dashboard (connection state, reconnect attempts, recent socket event log) for on-device long-run diagnostics.
- Composer accessibility improved: send IME action, semantic message-input label, disabled send on empty payload.
- Auth signing is now routed through a dedicated signing abstraction that preserves legacy identities and prefers Android Keystore Ed25519 for new supported installs.
- Signing-provider selection is now persisted across upgrades so existing legacy identities remain stable, while new supported installs stay on the non-exportable keystore path.
- Reconnect lifecycle coverage now includes pause/network/auth state decision tests in addition to backoff math.
- Conversation bubble styling received a final Telegram-style parity pass on shape, footer placement, and accessibility labeling.
- Active conversations now best-effort round-trip `/api/v1/chats/:chat_id/read` on load/reconnect/new message refresh so Android read-state behavior matches the iOS client more closely.
- Settings is now scrollable for smaller devices, conversation IME send obeys the same non-empty guard as the send button, and bubble semantics now include preview/timestamp context.
- Conversation toolbars and media action rows are now horizontally scrollable so narrow devices do not clip call/group/media/voice/round-video controls.
- Conversation navigation now carries known chat titles into the header instead of always falling back to a generic \"Conversation\" label.

## Pending
- `AND-2` soak follow-up: execute extended real-device background/network handoff runs and capture empirical reconnect telemetry from the new dashboard.
- `AND-4+` parity follow-up: continue visual iteration from device screenshots against final design references if exact row/timeline spacing still needs tuning.

## Realtime soak matrix
- Cold start connect: socket reaches `CONNECTED` and rejoins prior topics without duplicate timeline items.
- Background to foreground: `pause()` and `resume()` path recovers in one reconnect window with no manual relaunch.
- Wi-Fi to LTE handoff: diagnostics log shows disconnect and successful reconnect/rejoin.
- Airplane mode loss/recovery: socket stays disconnected while offline and reconnects when connectivity returns.
- Long background idle: stale-link detection should emit `socket:stale` and recover automatically.
- Forced token/session refresh: reconnect logic should not create duplicate topic joins or duplicate message renders.
- Rejoin after reconnect: diagnostics and chat list state remain coherent after `socket:reconnected`.

## Completion thresholds
- No duplicate message rows after reconnect or notification-driven resume.
- No stuck `RECONNECTING` state beyond 60 seconds in Settings diagnostics.
- Chat list and active conversation recover without app relaunch.

## Verification
- Structural sanity checks completed (source wiring + route/repository linkage).
- Gradle wrapper available (`apps/android/gradlew`).
- Full Android build/tests now runnable in this shell.
