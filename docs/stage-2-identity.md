# Stage 2 Identity Status

This document tracks the current Stage 2 slice.

## Implemented

- `POST /api/v1/register`
  - creates a user
  - creates the initial device
  - verifies and stores an uploaded signed prekey signature plus one-time prekeys
  - issues an initial session token
- `POST /api/v1/auth/challenge`
  - issues a short-lived challenge for a device
- `POST /api/v1/auth/verify`
  - verifies an Ed25519 signature over the challenge
  - issues a fresh session token
- `POST /api/v1/devices/prekeys`
  - verifies and rotates the current device's signed prekey
  - replaces or appends one-time prekeys
- `GET /api/v1/users/:username/devices/prekeys`
  - returns discoverable device prekey bundles for a user
  - currently exposes the next available one-time prekey without consuming it
- `/socket/device`
  - now validates session tokens against persisted device sessions
- Web onboarding flow
  - browser-side signing and encryption key generation
  - registration flow
  - challenge-sign-in flow
  - prekey generation and rotation flow
  - local device persistence in browser storage

## Still Deferred Inside Stage 2

- QR-based cross-device pairing transport
- explicit device-revocation UI backed by an API
- safety-number UX
- native mobile identity storage

## Next Step

The natural next slice is Stage 3: chats, membership, messages, and encrypted 1:1 routing on top of the identity/auth base.
