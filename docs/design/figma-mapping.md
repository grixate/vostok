# Figma Mapping

The current implementation uses child-frame mappings from the Telegram iOS UI kit as structural reference, not as a literal product skin.

## Rules

- Use child frames and concrete component nodes, never canvas roots, for implementation work.
- Treat the Figma output as structure and behavior reference.
- Replace community-kit naming with Vostok-owned component names.

## Stage 1-8 Coverage Map

| Figma Node | Source Frame | Vostok Target |
| --- | --- | --- |
| `6421:5305` | Telegram iOS UI Kit canvas (reference only) | `DesignSystem.SourceRoot` |
| `6425:11260` | Write Bar - Idle | `Composer.EmptyState` |
| `6425:11495` | Write Bar - Typing | `Composer.Typing` |
| `6559:17224` | Write Bar - Reply | `Composer.Reply` |
| `6559:17392` | Write Bar - Attachment | `Composer.AttachmentReady` |
| `6559:17561` | Write Bar - Voice affordance | `Composer.VoiceAction` |
| `6559:17612` | Write Bar - Round video affordance | `Composer.RoundVideoAction` |
| `6479:20876` | Chat list default row | `ChatListItem.Default` |
| `6479:21032` | Chat list unread state | `ChatListItem.Unread` |
| `6479:21174` | Chat list pinned state | `ChatListItem.Pinned` |
| `6479:21249` | Chat list muted state | `ChatListItem.Muted` |
| `6479:21328` | Messages - Status | `MessageBubble.StatusStates` |
| `6559:3254` | Message bubble incoming | `MessageBubble.Incoming` |
| `6559:3270` | Message bubble outgoing | `MessageBubble.Outgoing` |
| `6559:3286` | Messages - Edit | `Conversation.EditMode` |
| `6559:3318` | Messages - Reply preview | `MessageBubble.ReplyPreview` |
| `6559:3344` | Messages - Date separator | `Conversation.DateSeparator` |
| `6559:3380` | Messages - Jump to unread | `Conversation.UnreadJump` |
| `6479:22617` | Messages - Context Menu - Recipient | `ContextMenu.Recipient` |
| `6559:17689` | Messages - Context Menu - Sender | `ContextMenu.Sender` |
| `6559:17742` | Messages - Reaction picker | `ReactionBar.Picker` |
| `6559:17798` | Messages - Reaction aggregated | `ReactionBar.Aggregated` |
| `6568:14988` | Chat info header | `ChatInfoPanel.Header` |
| `6568:15069` | Chat info - Default | `ChatInfoPanel.Default` |
| `6568:15144` | Chat info media section | `ChatInfoPanel.MediaGallery` |
| `6568:15218` | Chat info members section | `ChatInfoPanel.MemberList` |
| `6568:15302` | Chat info actions section | `ChatInfoPanel.Actions` |
| `6581:9042` | Voice note bubble incoming | `VoiceNoteBubble.Incoming` |
| `6581:9108` | Voice note bubble outgoing | `VoiceNoteBubble.Outgoing` |
| `6581:9172` | Voice note recording waveform | `Composer.VoiceRecordingWaveform` |
| `6594:4012` | Round video bubble incoming | `RoundVideoBubble.Incoming` |
| `6594:4073` | Round video bubble outgoing | `RoundVideoBubble.Outgoing` |
| `6594:4138` | Round video fullscreen | `RoundVideoSurface.Fullscreen` |
| `6610:1189` | Media card photo | `AttachmentCard.Photo` |
| `6610:1262` | Media card file | `AttachmentCard.File` |
| `6610:1335` | Link preview card | `AttachmentCard.LinkPreview` |
| `6633:5204` | Group creation flow | `GroupFlow.Create` |
| `6633:5282` | Group member actions | `GroupFlow.MemberActions` |
| `6633:5361` | Group admin controls | `GroupFlow.AdminControls` |
| `6649:2218` | Incoming call sheet | `CallSurface.IncomingSheet` |
| `6649:2292` | Active call controls | `CallSurface.ActiveControls` |
| `6649:2367` | Minimized call bar | `CallSurface.Minimized` |
| `6649:2444` | Group participant grid | `CallSurface.GroupGrid` |
| `6649:2528` | Dominant speaker state | `CallSurface.DominantSpeaker` |
| `6649:2611` | Network quality indicator | `CallSurface.NetworkQuality` |
| `6672:1440` | Settings root list | `Settings.RootList` |
| `6672:1521` | Devices section | `Settings.Devices` |
| `6672:1607` | Safety numbers section | `Settings.SafetyNumbers` |
| `6690:870` | Federation peers list | `Admin.FederationPeers` |
| `6690:951` | Federation delivery queue | `Admin.FederationQueue` |
| `6690:1028` | Operator diagnostics | `Admin.OperatorDiagnostics` |
| `6708:420` | Desktop split-pane adaptation | `Desktop.ChatSplitPane` |
| `6708:502` | Desktop detail docked panel | `Desktop.DetailDocked` |
| `6708:588` | Desktop context menu pointer mode | `Desktop.ContextMenuPointer` |

## Asset Policy

- Temporary Figma assets may be used only for prototyping.
- Product assets must be replaced with Vostok-owned icons, illustration, and branding before release.
