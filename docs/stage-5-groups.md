# Stage 5 Groups Status

This repository now includes production-ready group-chat foundations.

## Implemented

- Group chat creation API:
  - `POST /api/v1/chats/group`
- Group rename API for admin members:
  - `PATCH /api/v1/chats/:chat_id/group`
- Group member admin APIs:
  - `GET /api/v1/chats/:chat_id/members`
  - `PATCH /api/v1/chats/:chat_id/members/:user_id`
  - `POST /api/v1/chats/:chat_id/members/:user_id/remove`
- Group membership insertion on top of the existing `chat_members` model
- Group title rendering via the current chat metadata field
- Persisted reactions:
  - `POST /api/v1/chats/:chat_id/messages/:message_id/reactions`
- Message replies:
  - `POST /api/v1/chats/:chat_id/messages` now accepts `reply_to_message_id`
- Message edits:
  - `PATCH /api/v1/chats/:chat_id/messages/:message_id`
- Message deletes:
  - `POST /api/v1/chats/:chat_id/messages/:message_id/delete`
- Single pinned message per chat:
  - `POST /api/v1/chats/:chat_id/messages/:message_id/pin`
- Web quick-reaction surface for recent messages
- Web reply composer state plus inline reply previews in the message thread
- Web edit/delete controls for outgoing messages
- Web pinned-message banner plus pin/unpin controls in the message thread
- Web group-admin rename form in the detail rail for the active group chat
- Web group-member promote/demote/remove controls for non-self members in the detail rail
- Detail-rail chat media gallery for recent attachments in the active chat
- Group Sender Key distribution API:
  - `POST /api/v1/chats/:chat_id/sender-keys`
- Group Sender Key recipient inbox API:
  - `GET /api/v1/chats/:chat_id/sender-keys`
- Web group-admin Sender Key rotation action plus inbound Sender Key list in the detail rail

## Not Yet Implemented

- None in the current Stage 5 scope.

## Current Meaning of Stage 5

The backend now supports real group chat containers with multiple members, which gives the later rich-interaction work an actual chat surface to build on.
