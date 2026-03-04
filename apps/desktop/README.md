# Vostok Desktop

This is the Stage 8 desktop scaffold for the Tauri wrapper around the Vostok web client.

## Current Scope

- Tauri application shell configuration
- Desktop window metadata and permissions scaffold
- Dev mode now boots the shared web client automatically and points Tauri at `http://127.0.0.1:5173`
- Production mode now builds the shared web workspace automatically and loads the built bundle from `../../web/dist`
- Custom Tauri commands now expose desktop runtime metadata plus minimize/maximize window controls to the shared web UI
- The desktop host now also exposes the real maximized state so the shared titlebar UI can stay synchronized with the native window
- Local packaging has been verified: `npm run build` now produces a macOS `.app` bundle and `.dmg` under `src-tauri/target/release/bundle`
- The shared web shell now also uses the Tauri window API directly for reactive maximize/focus updates while the host commands remain the control path
- The shared web shell now uses the same Tauri window API to manage and display the desktop always-on-top state
- The shared web shell now persists that always-on-top preference locally and reapplies it when the desktop app starts again
- The shared web shell now also uses the Tauri window API to toggle and display native fullscreen state
- The shared web shell now also drives the native Tauri window title so the host reflects the active chat and call context
- The shared web shell now also restores and persists the native Tauri window frame using the Tauri window API
- The shared web shell can also reset the native desktop frame back to the default centered size from the host card or `Cmd/Ctrl+Shift+0`
- The shared web shell can also copy a desktop diagnostics snapshot (runtime, window state, layout state) to the clipboard from the host card or `Cmd/Ctrl+Shift+D`
- `npm run build` now emits `release-manifest.json` automatically after packaging, and `npm run manifest` can regenerate it on demand

## Commands

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run manifest`

## Notes

- The desktop package is intentionally kept outside the current npm workspace until the team is ready to install desktop-specific dependencies.
- The root workspace now exposes `npm run setup:desktop` as a one-step install for this package.
- `npm run dev` and `npm run build` now rely on the Tauri `beforeDevCommand` / `beforeBuildCommand` hooks to start or build the shared web shell automatically.
- The current Rust entrypoint is minimal and only bootstraps the Tauri host.
