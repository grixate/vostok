# Stage 5 Groups Status

This repository now includes the first practical group-chat scaffold.

## Implemented

- Group chat creation API:
  - `POST /api/v1/chats/group`
- Group membership insertion on top of the existing `chat_members` model
- Group title rendering via the current chat metadata field
- Persisted reactions:
  - `POST /api/v1/chats/:chat_id/messages/:message_id/reactions`
- Message replies:
  - `POST /api/v1/chats/:chat_id/messages` now accepts `reply_to_message_id`
- Web quick-reaction surface for recent messages
- Web reply composer state plus inline reply previews in the message thread

## Not Yet Implemented

- Sender Keys
- Edits, deletes, and pinning rules
- Group admin management UI
- Chat info media gallery

## Current Meaning of Stage 5

The backend now supports real group chat containers with multiple members, which gives the later rich-interaction work an actual chat surface to build on.
