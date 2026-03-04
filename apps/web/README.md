# Vostok Web

This package is the current web shell for Vostok through the early Stage 3 messaging slice.

## Current Scope

- shared design-system consumption from local packages
- responsive chat shell
- desktop two-pane plus detail-rail layout
- mobile stacked fallback
- Figma-derived interaction structure with Vostok-owned styling
- browser-side signing and encryption key generation
- browser-side signed prekey and one-time prekey generation with identity signatures
- registration and challenge-sign-in flows against the Phoenix API
- local device persistence for the current browser
- device prekey rotation for the current browser
- authenticated direct-chat creation
- authenticated group-chat creation
- authenticated attachment uploads and encrypted file download
- quick reaction toggles for recent messages
- persisted direct-chat session bootstrap with explicit initiator ephemeral keys, handshake assertions, and local session-key caching
- recipient-wrapped message encryption for devices with published encryption keys
- per-message derived session-key encryption with local ratchet state and skipped-message handling when a full chat session map is available
- legacy browser-local AES-GCM fallback for older local-only messages
- local message cache for the selected chat
- Phoenix Channel subscription for live updates in the active chat
- realtime call-state subscription for the active chat
- realtime participant updates for the active call room
- realtime call-signal updates for offer/answer/ICE scaffolding
- admin overview, federation-peer lifecycle controls, and TURN bootstrap surfaces in the detail rail
- lightweight call-session start/end plus Membrane room join/leave controls
- per-device Membrane endpoint provisioning, control ping, and event polling in the Stage 7 panel
- automatic polling of the per-device Membrane queue while the endpoint exists
- polled `call_signal_bridge` events now merge into the visible signal log and can drive browser WebRTC negotiation as a fallback path
- native endpoint-emitted media events (such as the initial `connected` event) now appear in the same polled queue
- joining the Membrane room now discovers the auto-provisioned per-device endpoint immediately, so fallback polling starts without a second step
- leaving the Membrane room now refreshes endpoint state immediately so fallback polling stops without waiting for a full call refresh
- manual signaling now defaults to "Broadcast to joined peers" and can be switched to a specific joined device when needed
- persisted call lifecycle entries now render as chat timeline system bubbles
- signaling inspector and manual offer/answer/ICE dispatch for the active call
- browser-side `RTCPeerConnection` lab for real SDP offer/answer generation and ICE capture
- real `getUserMedia` microphone/camera attachment to the browser WebRTC lab before renegotiation
- automatic Membrane endpoint provisioning during browser WebRTC initialization so the call panel tracks both sides of the bridge
- browser WebRTC initialization now sends a native Membrane `connect` media event to the provisioned endpoint
- the Stage 7 "Ping" action now sends a protocol-valid `updateEndpointMetadata` event instead of custom placeholder JSON
- the web client now includes `@jellyfish-dev/membrane-webrtc-js` and feeds native endpoint events from the polled Membrane queue back into a real `WebRTCEndpoint` instance
- local microphone/camera tracks are mirrored into the Membrane client once the native endpoint is connected
- the Stage 7 "Create Offer" action is now explicitly for the fallback browser-only lab; native Membrane negotiation is the primary path
- the Stage 7 panel now shows native remote Membrane endpoint IDs and track IDs as the client discovers them
- manual fallback offer/answer/ICE form controls are disabled while the native Membrane client is connected
- native remote tracks now render as explicit `Ready` vs `Negotiating` rows in the Stage 7 panel instead of only aggregate counts
- ready native remote tracks now render as live audio/video previews in the Stage 7 panel instead of metadata-only rows
- native remote tracks now surface Membrane voice-activity state so speaking tracks are called out in the Stage 7 panel
- the Stage 7 panel now promotes the dominant remote speaker into a featured live preview and marks the matching endpoint row
- desktop keyboard shortcuts are now wired for quick chat focus, send, and voice/video call start actions
- desktop keyboard navigation now supports `Alt+ArrowUp/Down` chat switching with visible focus rings on the chat list
- the desktop sidebar now includes a live chat-title filter with `Cmd/Ctrl+Shift+F` keyboard focus

## Commands

- `npm run dev`
- `npm run build`
- `npm run lint`

## Shared Packages Used

- `@vostok/ui-tokens`
- `@vostok/ui-primitives`
- `@vostok/ui-chat`
