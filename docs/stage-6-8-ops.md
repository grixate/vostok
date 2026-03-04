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
- Persisted `call_sessions` table for lightweight call signaling state
- Persisted `call_participants` table for device-level join/leave state
- Persisted `call_signals` table for offer/answer/ICE signaling state
- Supervised `VostokServer.Calls.MembraneRoom` processes that boot real `membrane_rtc_engine` instances
- Per-device `Membrane.RTC.Engine.Endpoint.WebRTC` instances now boot inside each active room
- A local endpoint queue is retained only for custom bridge events plus native endpoint-emitted media events
- `call_signals` are mirrored into the per-device Membrane endpoint queue, and native WebRTC endpoints now emit their own media events (for example the initial `connected` event)
- Joining a call now provisions the current device's Membrane bridge endpoint automatically
- Leaving a call now removes the current device's bridge endpoint and clears the local queue state
- Call start and end now write `system` messages into the chat timeline, including a missed-call variant when no remote participant ever joined
- Tauri desktop wrapper scaffold in `apps/desktop`
- Web operator surface for peer activation, heartbeat, call-session controls, Membrane room join state, per-device endpoint provisioning, and signaling inspection
- Browser-side `RTCPeerConnection` lab that generates real SDP offers/answers and ICE candidates against the existing signaling API
- Browser-side `getUserMedia` track attachment so offers can advertise real microphone/camera transports before server-side Membrane media handling lands
- Browser-side `@jellyfish-dev/membrane-webrtc-js` client wiring that now sends native `connect` / `updateEndpointMetadata` media events and consumes native endpoint events from the polled Membrane queue
- Local browser microphone/camera tracks now sync into the native Membrane client automatically after the endpoint connects
- Automatic endpoint polling in the web call panel while a per-device Membrane endpoint exists
- Polled `call_signal_bridge` events are now merged into the client call state and processed as a WebRTC fallback transport
- Once the native Membrane client is connected, fallback manual offer/answer/ICE controls remain visible for debugging but are disabled by default
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
- Untargeted signals now fan out to joined participant device endpoints by default, with sender-loopback only as a fallback
- The web call panel now exposes an explicit "Broadcast to joined peers" signal target, matching the backend fanout behavior
- Backend coverage now includes a real two-device joined-call fanout test for untargeted signal bridging
- The chat timeline now renders persisted call lifecycle entries as system bubbles instead of opaque encrypted placeholders

## Not Yet Implemented

- mTLS federation transport
- real cross-instance delivery over the new durable queue (the queue now auto-enqueues background workers, but transport is still local-only)
- full replacement of the fallback browser `RTCPeerConnection` lab with the native `membrane-webrtc-js` path
- camera/microphone track attachment and binding those transports into the real Membrane RTC Engine pipeline
- signed desktop bundles and installer flows
- rollback/update orchestration

## Current Meaning of Stage 6-8

The backend now exposes real operator and call-setup surfaces instead of placeholders. This is not complete federation or calling yet, but it now boots a real `membrane_rtc_engine` per room, creates live `Membrane.RTC.Engine.Endpoint.WebRTC` endpoints per joined device, and preserves the bridge queue only for custom fallback traffic while the protocol-native client path is finished.
