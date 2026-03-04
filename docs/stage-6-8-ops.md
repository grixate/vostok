# Stage 6-8 Ops Status

This repository now includes early operator scaffolding that reaches into the later implementation stages.

## Implemented

- Admin overview API:
  - `GET /api/v1/admin/overview`
- Federation peer scaffold APIs:
  - `GET /api/v1/admin/federation/peers`
  - `POST /api/v1/admin/federation/peers`
  - `POST /api/v1/admin/federation/peers/:peer_id/status`
  - `POST /api/v1/admin/federation/peers/:peer_id/heartbeat`
  - `GET /api/v1/admin/federation/deliveries`
  - `POST /api/v1/admin/federation/peers/:peer_id/deliveries`
  - `POST /api/v1/admin/federation/deliveries/:job_id/attempt`
- Federation ingress API:
  - `POST /api/v1/federation/deliveries`
- TURN credential API:
  - `POST /api/v1/calls/turn-credentials`
- Call session APIs:
  - `GET /api/v1/chats/:chat_id/calls/active`
  - `POST /api/v1/chats/:chat_id/calls`
  - `GET /api/v1/calls/:call_id`
  - `POST /api/v1/calls/:call_id/join`
  - `POST /api/v1/calls/:call_id/webrtc-endpoint`
  - `GET /api/v1/calls/:call_id/webrtc-endpoint`
  - `POST /api/v1/calls/:call_id/webrtc-endpoint/media-events`
  - `POST /api/v1/calls/:call_id/webrtc-endpoint/poll`
  - `GET /api/v1/calls/:call_id/signals`
  - `POST /api/v1/calls/:call_id/signals`
  - `POST /api/v1/calls/:call_id/leave`
  - `POST /api/v1/calls/:call_id/end`
- Persisted `federation_peers` table for remote peer configuration
- Persisted `federation_delivery_jobs` table for durable outbound queue state
- Queued federation deliveries now auto-enqueue background Oban jobs for worker-driven dispatch
- Outbound federation deliveries now dispatch over a real mTLS `Req` transport to remote `/api/v1/federation/deliveries`
- Inbound federation relay ingestion now persists idempotent `inbound` delivery rows keyed by remote delivery ID
- Persisted `call_sessions` table for lightweight call signaling state
- Persisted `call_participants` table for device-level join/leave state
- Persisted `call_signals` table for offer/answer/ICE signaling state
- Supervised `VostokServer.Calls.MembraneRoom` processes that boot real `membrane_rtc_engine` instances
- Per-device `Membrane.RTC.Engine.Endpoint.WebRTC` instances now boot inside each active room
- A local endpoint queue is retained for polled native endpoint-emitted media events (for example the initial `connected` event)
- `call_signals` remain persisted and realtime-visible for operator inspection while native media negotiation runs through Membrane
- Joining a call now provisions the current device's Membrane WebRTC endpoint automatically
- Leaving a call now removes the current device endpoint and clears local endpoint queue state
- Call start and end now write `system` messages into the chat timeline, including a missed-call variant when no remote participant ever joined
- Tauri desktop wrapper scaffold in `apps/desktop`
- Web operator surface for peer activation, heartbeat, call-session controls, Membrane room join state, per-device endpoint provisioning, and signaling inspection
- The Stage 6 operator surface now renders recent federation delivery rows, not just aggregate queue counts
- The Stage 6 operator surface can now queue a relay on a peer row and manually advance recent delivery jobs
- Browser-side `@jellyfish-dev/membrane-webrtc-js` client wiring that now sends native `connect` / `updateEndpointMetadata` media events and consumes native endpoint events from the polled Membrane queue
- Local browser microphone/camera tracks now attach directly into the native Membrane client pipeline
- Automatic endpoint polling in the web call panel while a per-device Membrane endpoint exists
- The fallback browser `RTCPeerConnection` lab path is fully removed from the web shell and operator panel
- Backend `call_signal_bridge` fanout has been removed, so polled endpoint queues now carry protocol-native Membrane media events only
- The Stage 7 operator panel now exposes native remote endpoint IDs and track IDs reported by the Membrane browser client
- The Stage 7 operator panel now distinguishes native remote track discovery from native remote track readiness (`Negotiating` vs `Ready`)
- Ready native remote tracks now render as live audio/video previews in the Stage 7 operator panel
- The Stage 7 operator panel now surfaces Membrane voice-activity state so active speakers are visible immediately
- The Stage 7 operator panel now highlights the dominant remote speaker and promotes that endpoint into a featured live preview
- The desktop/web shell now includes keyboard shortcuts for composer focus, direct/group entry points, quick send, and voice/video call launch
- The desktop/web shell now supports keyboard chat-list traversal (`Alt+ArrowUp/Down`) with explicit focus treatment
- The desktop/web sidebar now includes a live title filter, and `Cmd/Ctrl+Shift+F` focuses that filter for keyboard-first chat selection
- The desktop/web shell now supports a user-controlled detail rail toggle (`Cmd/Ctrl+\`) that switches between focused two-column and full three-column mode
- The detail-rail layout preference is now persisted locally and automatically reapplied when the viewport returns to desktop width
- The Tauri desktop wrapper now auto-starts the shared web dev server in development and auto-builds the shared web bundle for desktop packaging
- The Tauri host now exposes runtime metadata plus minimize/maximize window commands, and the shared web shell consumes that bridge when running inside desktop mode
- The desktop shell now renders a compact titlebar control strip and supports keyboard minimize/maximize shortcuts when hosted in Tauri
- The desktop titlebar now doubles as a draggable host region and initializes from the real native maximized state
- Full desktop packaging now succeeds locally and produces both `Vostok.app` and a distributable `.dmg`
- The desktop shell now reacts to native Tauri resize/move/focus events, keeping window maximize/focus state live in the UI
- The desktop shell now exposes a real always-on-top control with live state in both the titlebar and the desktop host panel
- The desktop shell now also exposes native fullscreen state and controls in both the titlebar and the desktop host panel
- The desktop shell now persists the always-on-top preference locally and reapplies it when the Tauri app relaunches
- The native desktop window title now tracks the active chat and live call mode instead of staying static
- The desktop wrapper now restores and re-persists its last window frame, so reopened sessions keep their prior size and position
- The desktop host card can now reset the native window back to its default centered frame, and `Cmd/Ctrl+Shift+0` exposes the same action from the keyboard
- The desktop host card can now copy a full desktop diagnostics snapshot to the clipboard for debugging and support, and `Cmd/Ctrl+Shift+D` exposes the same action from the keyboard
- The repo now includes a desktop release-manifest generator that hashes built artifacts into `apps/desktop/release-manifest.json`
- The repo now includes desktop signing automation (`ops/sign-desktop-bundles.mjs`) for signed bundle output with optional notarization
- The repo now includes installer-grade desktop release packaging (`ops/package-desktop-release.mjs`) into versioned `apps/desktop/releases/<version>` directories
- The repo now includes desktop channel promotion and rollback orchestration (`ops/promote-desktop-release.mjs`, `ops/rollback-desktop-release.mjs`)
- The chat timeline now renders persisted call lifecycle entries as system bubbles instead of opaque encrypted placeholders

## Not Yet Implemented

- None in the current Stage 6-8 scope.

## Current Meaning of Stage 6-8

The backend now exposes real operator and call-setup surfaces instead of placeholders. It boots a real `membrane_rtc_engine` per room, creates live `Membrane.RTC.Engine.Endpoint.WebRTC` endpoints per joined device, and now runs a native Membrane-first media path without the previous browser-only fallback bridge.
