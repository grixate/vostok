# Shared UI Contracts

These contracts are implemented in `packages/ui-chat`.

## ChatListItem

- Variants: `default`, `pinned`, `muted`
- States: `idle`, `active`, `unread`
- Responsive rule: compact metadata on phone, expanded preview on desktop

## ConversationHeader

- Variants: `direct`, `group`, `channel`
- States: `online`, `offline`, `typing`
- Responsive rule: action cluster remains trailing; secondary metadata collapses first

## MessageBubble

- Variants: `incoming`, `outgoing`, `system`
- States: `sending`, `delivered`, `read`, `failed`
- Accessibility: surface status in text, not color alone

## Composer

- Variants: `idle`, `typing`, `reply`
- States: `enabled`, `recording`, `disabled`
- Responsive rule: bottom-sticky on phone, footer-sticky within conversation pane on desktop

## VoiceNoteBubble

- Variants: `incoming`, `outgoing`
- States: `playing`, `paused`, `buffering`

## RoundVideoBubble

- Variants: `inline`, `expanded`
- States: `idle`, `playing`, `looping`

## ReactionBar

- Variants: `inline`, `contextual`
- States: `collapsed`, `expanded`

## ContextMenu

- Variants: `sender`, `recipient`
- States: `open`, `closed`
- Responsive rule: long-press sheet on touch, anchored menu on pointer

## ChatInfoPanel

- Variants: `direct`, `group`
- States: `summary`, `media`

## CallSurface

- Variants: `incoming`, `active`, `minimized`
- States: `voice`, `video`, `group`

