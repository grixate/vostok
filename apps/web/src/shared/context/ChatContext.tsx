import { createContext, useContext, type ReactNode, type ChangeEvent, type FormEvent } from 'react'
import type { ChatSummary, GroupMember, GroupSenderKey, LinkMetadata } from '../../lib/api'
import type { CachedMessage } from '../../lib/message-cache'
import type { AttachmentDescriptor, SafetyNumberEntry } from '../types/chat'

// ─── Context ───────────────────────────────────────────────────────────────

export type ChatContextValue = {
  // ── Chat list ─────────────────────────────────────────────────────────────
  chatItems: ChatSummary[]
  setChatItems: React.Dispatch<React.SetStateAction<ChatSummary[]>>
  chatFilter: string
  setChatFilter: (v: string) => void
  activeChatId: string | null
  setActiveChatId: (id: string | null) => void
  activeChat: ChatSummary | null
  visibleChatItems: ChatSummary[]
  contacts: Array<{ username: string }>
  /** Refs for sidebar keyboard navigation */
  chatButtonRefs: React.MutableRefObject<Record<string, HTMLButtonElement | null>>
  chatFilterInputRef: React.RefObject<HTMLInputElement | null>
  handleCreateDirectChatByUsername: (username: string) => Promise<void>
  handleCreateGroupFromNav: (title: string, members: string[]) => Promise<void>
  focusRelativeChat: (offset: number) => void

  // ── Conversation ──────────────────────────────────────────────────────────
  messageItems: CachedMessage[]
  draft: string
  setDraft: React.Dispatch<React.SetStateAction<string>>
  editingMessageId: string | null
  setEditingMessageId: (id: string | null) => void
  replyTargetMessageId: string | null
  setReplyTargetMessageId: (id: string | null) => void
  editingTargetMessage: CachedMessage | null
  replyTargetMessage: CachedMessage | null
  pinnedMessage: CachedMessage | null
  chatMediaItems: CachedMessage[]
  groupMembers: GroupMember[]
  groupSenderKeys: GroupSenderKey[]
  groupRenameTitle: string
  setGroupRenameTitle: React.Dispatch<React.SetStateAction<string>>
  safetyNumbers: SafetyNumberEntry[]
  linkMetadataByUrl: Record<string, LinkMetadata>
  attachmentPlaybackUrls: Record<string, string>
  outboxPendingCount: number
  voiceNoteRecording: boolean
  roundVideoRecording: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  draftInputRef: React.RefObject<HTMLTextAreaElement | null>

  // ── Handlers ─────────────────────────────────────────────────────────────
  handleSendMessage: (event: FormEvent<HTMLFormElement>) => Promise<void>
  handleAttachmentPick: (event: ChangeEvent<HTMLInputElement>) => Promise<void>
  handleVoiceNoteToggle: () => Promise<void>
  handleRoundVideoToggle: () => Promise<void>
  handleReplyToMessage: (message: CachedMessage) => void
  handleStartEditingMessage: (message: CachedMessage) => void
  handleDeleteExistingMessage: (message: CachedMessage) => Promise<void>
  handleToggleMessagePin: (message: CachedMessage) => Promise<void>
  handleDownloadAttachment: (attachment: AttachmentDescriptor) => Promise<void>
  ensureAttachmentPlaybackUrl: (attachment: AttachmentDescriptor) => Promise<string>
  handleVerifyPeerSafetyNumber: (peerDeviceId: string) => Promise<void>
  handleRekeyActiveChatSessions: () => Promise<void>
  handleRenameActiveGroupChat: (event: FormEvent<HTMLFormElement>) => Promise<void>
  handleUpdateActiveGroupMemberRole: (member: GroupMember, role: 'admin' | 'member') => Promise<void>
  handleRemoveActiveGroupMember: (member: GroupMember) => Promise<void>
  handleRotateGroupSenderKey: () => Promise<void>
}

export const ChatContext = createContext<ChatContextValue | null>(null)

/** Context consumer — use inside components rendered below ChatContext.Provider. */
export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChat must be used within ChatContext.Provider')
  return ctx
}

export function ChatProvider({
  children,
  value,
}: {
  children: ReactNode
  value: ChatContextValue
}) {
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}
