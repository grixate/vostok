# Stage 4 Media Status

This repository now includes the first practical Stage 4 attachment slice.

## Implemented

- Opaque encrypted media upload APIs:
  - `POST /api/v1/media/uploads`
  - `PATCH /api/v1/media/uploads/:id/part`
  - `POST /api/v1/media/uploads/:id/complete`
  - `GET /api/v1/media/:id`
- Media persistence on the server via `media_uploads`
- Browser-side attachment encryption before upload
- Browser-side attachment download and local decryption
- Attachment descriptors sent over the existing encrypted message transport
- Attachment message rendering in the current chat shell
- Browser-side inline thumbnail generation for image attachments, stored inside the encrypted attachment descriptor for fast preview rendering

## Not Yet Implemented

- Resumable multi-part chunk tracking beyond sequential append
- Voice note waveform UI
- Round video recording and playback
- Link preview cards

## Current Meaning of Stage 4

The server can now store opaque encrypted attachment payloads, and the web client can upload an encrypted file, send an encrypted attachment descriptor through chat, and later download and decrypt that file locally.
