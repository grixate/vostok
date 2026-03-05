# Stage 4 Media Status

This repository now includes the first practical Stage 4 attachment slice.

## Implemented

- Opaque encrypted media upload APIs:
  - `POST /api/v1/media/uploads`
  - `GET /api/v1/media/uploads/:id` (authorized resumable state)
  - `PATCH /api/v1/media/uploads/:id/part`
  - `POST /api/v1/media/uploads/:id/complete`
  - `GET /api/v1/media/:id`
- Media persistence on the server via `media_uploads`
- Browser-side attachment encryption before upload
- Browser-side attachment download and local decryption
- Attachment descriptors sent over the existing encrypted message transport
- Attachment message rendering in the current chat shell
- Browser-side inline thumbnail generation for image attachments, stored inside the encrypted attachment descriptor for fast preview rendering
- Client-side link preview cards now hydrated from server-fetched metadata with local fallback rendering
- Browser-side voice-note recording that reuses the encrypted attachment transport
- Lightweight client-side waveform rendering for recorded voice notes
- Advanced voice-note playback controls (load, play/pause, seek, playback rate, volume)
- Browser-side round-video recording that reuses the encrypted attachment transport with circular preview rendering
- Inline round-video playback in message threads (not just file download)
- Chunk-indexed multipart encrypted upload support with resumable progress reporting
- Deterministic upload-state recovery via uploaded part index snapshots from `GET /api/v1/media/uploads/:id`
- Privacy-safe server-side link metadata fetches (`POST /api/v1/media/link-metadata`) with local/private-network target blocking

## Not Yet Implemented

- None in the current Stage 4 scope.

## Current Meaning of Stage 4

The server can now store opaque encrypted attachment payloads, and the web client can upload an encrypted file, send an encrypted attachment descriptor through chat, and later download and decrypt that file locally.
