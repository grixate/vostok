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
- group-title rename for active group chats
- group-member admin controls (promote, demote, remove) for active group chats
- group Sender Key rotation and inbound Sender Key visibility in active group chats
- detail-rail media gallery for recent attachments in the active chat
- authenticated attachment uploads and encrypted file download
- server-fetched link metadata previews for message URLs
- browser-side voice-note recording through the encrypted attachment path
- lightweight waveform rendering for recorded voice notes
- voice-note playback controls (play/pause, seek, speed, volume)
- browser-side round-video recording through the encrypted attachment path
- inline round-video playback inside message threads
- quick reaction toggles for recent messages
- reply composer state with inline reply previews for current-thread messages
- message edit/delete controls for outgoing messages
- single pinned-message controls with a pinned-message banner in the active thread
- persisted direct-chat session bootstrap with explicit initiator ephemeral keys, handshake assertions, and local session-key caching
- new or re-handshaken direct-chat sessions now derive their local root key through an HKDF-based X3DH-style transcript
- new or re-handshaken direct-chat sessions now seed distinct send and receive chains by initiator/recipient role
- recipient-wrapped message encryption for devices with published encryption keys
- per-message derived session-key encryption with local ratchet state and skipped-message handling when a full chat session map is available
- session-encrypted headers now carry an explicit per-device ratchet version so future crypto migrations have a safe compatibility boundary
- re-handshaken direct-chat sessions now mix the previous cached root into a new local ratchet epoch instead of blindly resetting chain state
- session-encrypted headers now also carry a per-device local ratchet public key so peer key changes can drive a local DH-ratchet step between full re-handshakes
- session-encrypted sends now report the `established_session_ids` they actually used, and the Stage 3 panel shows which cached sessions are still pending their first encrypted message
- routine chat sync now only generates fresh initiator ephemeral bootstrap keys for recipients that do not already have an established session
- the Stage 3 panel now includes an explicit `Rekey Active Sessions` action, which rotates selected device-pair sessions onto fresh pending-first-message session records
- superseded session records are excluded from the outbound send path but still retained in local metadata so older encrypted messages remain decryptable
- new outbound user messages now require session transport; the old recipient-wrapping and legacy local modes are decode-compatibility paths only
- session synchronization now prunes consumed local one-time prekeys for device-pair sessions where this device acted as the one-time-prekey recipient
- IndexedDB-backed local message cache for the selected chat
- client-side safety-number display for published remote identity keys in the active chat
- Phoenix Channel subscription for live updates in the active chat
- image attachments now include inline encrypted thumbnail previews for faster message rendering
- realtime call-state subscription for the active chat
- realtime participant updates for the active call room
- realtime call-signal updates for offer/answer/ICE scaffolding
- admin overview, federation-peer lifecycle controls, and TURN bootstrap surfaces in the detail rail
- recent federation delivery queue rows in the Stage 6 admin surface
- queue and manually advance federation deliveries from the Stage 6 admin surface
- lightweight call-session start/end plus Membrane room join/leave controls
- per-device Membrane endpoint provisioning, control ping, and event polling in the Stage 7 panel
- automatic polling of the per-device Membrane queue while the endpoint exists
- native endpoint-emitted media events (such as the initial `connected` event) now appear in the same polled queue
- joining/leaving the Membrane room now refreshes endpoint state immediately
- persisted call lifecycle entries now render as chat timeline system bubbles
- native Membrane WebRTC initialization now provisions endpoints and sends protocol-native connect events
- the Stage 7 "Ping" action now sends a protocol-valid `updateEndpointMetadata` event instead of custom placeholder JSON
- the web client now includes `@jellyfish-dev/membrane-webrtc-js` and feeds native endpoint events from the polled Membrane queue back into a real `WebRTCEndpoint` instance
- local microphone/camera tracks now attach directly into the native Membrane client pipeline
- the Stage 7 panel now shows native remote Membrane endpoint IDs and track IDs as the client discovers them
- native remote tracks now render as explicit `Ready` vs `Negotiating` rows in the Stage 7 panel instead of only aggregate counts
- ready native remote tracks now render as live audio/video previews in the Stage 7 panel instead of metadata-only rows
- native remote tracks now surface Membrane voice-activity state so speaking tracks are called out in the Stage 7 panel
- the Stage 7 panel now promotes the dominant remote speaker into a featured live preview and marks the matching endpoint row
- desktop keyboard shortcuts are now wired for quick chat focus, send, and voice/video call start actions
- desktop keyboard navigation now supports `Alt+ArrowUp/Down` chat switching with visible focus rings on the chat list
- the desktop sidebar now includes a live chat-title filter with `Cmd/Ctrl+Shift+F` keyboard focus
- the desktop shell now supports a toggleable detail rail (`Cmd/Ctrl+\\`) that switches between two-column and three-column layout
- the detail-rail preference is now persisted in local storage and automatically re-applies whenever the window is back in wide desktop mode
- when running inside Tauri, the web shell now exposes a desktop host bridge for runtime info plus minimize/maximize window controls
- when running inside Tauri, the sidebar now shows a compact desktop titlebar strip and keyboard shortcuts for minimize/maximize host window actions
- the desktop titlebar now uses a real Tauri window-state query and a draggable region, so its controls and state label stay aligned with the host window
- the desktop shell now listens to native Tauri window resize/move/focus events, so maximize and focus state stay synchronized without manual refresh
- the desktop titlebar and host card now expose an always-on-top toggle, including a `Cmd/Ctrl+Shift+P` shortcut
- the desktop shell now reapplies the saved always-on-top preference on startup, so pinning survives relaunches
- the desktop titlebar and host card now also expose native fullscreen mode, including a `Cmd/Ctrl+Shift+U` shortcut
- the desktop shell now synchronizes the native Tauri window title with the active chat and call mode
- the desktop shell now persists and restores the native window frame (size and position) across launches
- the desktop host card now includes a `Reset Window Frame` action, and `Cmd/Ctrl+Shift+0` restores the default centered desktop frame
- the desktop host card can now copy a runtime/window/layout diagnostics snapshot to the clipboard for debugging, with a `Cmd/Ctrl+Shift+D` shortcut

## Commands

- `npm run dev`
- `npm run build`
- `npm run lint`

## Shared Packages Used

- `@vostok/ui-tokens`
- `@vostok/ui-primitives`
- `@vostok/ui-chat`
