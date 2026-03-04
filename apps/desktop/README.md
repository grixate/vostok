# Vostok Desktop

This is the Stage 8 desktop scaffold for the Tauri wrapper around the Vostok web client.

## Current Scope

- Tauri application shell configuration
- Desktop window metadata and permissions scaffold
- Dev mode pointed at the local web client (`http://localhost:5173`)
- Production mode pointed at the built web bundle in `../web/dist`

## Commands

- `npm install`
- `npm run dev`
- `npm run build`

## Notes

- The desktop package is intentionally kept outside the current npm workspace until the team is ready to install desktop-specific dependencies.
- The current Rust entrypoint is minimal and only bootstraps the Tauri host.
