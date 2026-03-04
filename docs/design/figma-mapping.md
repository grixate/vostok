# Figma Mapping

The current implementation uses child-frame mappings from the Telegram iOS UI kit as structural reference, not as a literal product skin.

## Rules

- Use child frames and concrete component nodes, never canvas roots, for implementation work.
- Treat the Figma output as structure and behavior reference.
- Replace community-kit naming with Vostok-owned component names.

## Current Mappings

| Figma Node | Source Frame | Vostok Target |
| --- | --- | --- |
| `6425:11260` | Write Bar - Idle | `Composer.EmptyState` |
| `6425:11495` | Write Bar - Typing | `Composer.Typing` |
| `6559:17224` | Write Bar - Reply | `Composer.Reply` |
| `6559:3286` | Messages - Edit | `Conversation.EditMode` |
| `6479:22617` | Messages - Context Menu - Recipient | `ContextMenu.Recipient` |
| `6559:17689` | Messages - Context Menu - Sender | `ContextMenu.Sender` |
| `6568:15069` | Chat info - Default | `ChatInfoPanel.Default` |
| `6479:21328` | Messages - Status | `MessageBubble.StatusStates` |

## Asset Policy

- Temporary Figma assets may be used only for prototyping.
- Product assets must be replaced with Vostok-owned icons, illustration, and branding before release.

