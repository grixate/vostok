# Desktop Release Runbook

## Scope

Operational runbook for Stage 8 desktop GA release, promotion, and rollback.

## Preconditions

- macOS build host with Xcode command line tools installed.
- Valid signing identity in keychain (`APPLE_CODESIGN_IDENTITY`).
- Optional notarization profile configured (`APPLE_NOTARY_PROFILE`).
- Desktop package dependencies installed (`npm run setup:desktop`).

## Build and Package

1. `npm run build:desktop`
2. `npm run manifest:desktop`
3. `npm run sign:desktop`
4. `npm run package:desktop`

The packaged release folder is created at:

- `apps/desktop/releases/<version>`

## Promote

Promote the latest packaged version to stable:

1. `npm run promote:desktop:stable`
2. Verify channel file:
   - `apps/desktop/releases/channels/stable.json`

## Rollback

Rollback stable to the previous promoted version:

1. `npm run rollback:desktop:stable`
2. Re-check channel file and ensure clients receive the prior manifest.

## Incident Checks

- Confirm signing succeeded (`codesign --verify --deep --strict`).
- Validate the release manifest hashes match actual artifacts.
- Smoke test fresh install, update, and rollback on clean host VM.
- Confirm desktop update checks point to the expected channel manifest.

