import { ConversationHeader as ConversationHeaderUI } from '@vostok/ui-chat'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { Tooltip } from '../../components/Tooltip.tsx'
import { chatAvatarColor } from '../../utils/avatar-colors.ts'
import type { useGroupChat } from '../../hooks/useGroupChat.ts'
import type { useCall } from '../../hooks/useCall.ts'
import type { useViewportLayout } from '../../hooks/useViewportLayout.ts'
import type { usePresence } from '../../hooks/usePresence.ts'
import type { ChatSummary } from '../../lib/api.ts'
import { readAuthSession } from '../../utils/storage.ts'
import {
  BackIcon,
  PhoneIcon,
  MoreVertIcon,
  SearchIcon,
} from '../../icons/index.tsx'
import { useProfilePhoto } from '../../hooks/useProfilePhotos.ts'

type ConversationHeaderProps = {
  activeChat: ChatSummary | null
  groupChat: ReturnType<typeof useGroupChat>
  call: ReturnType<typeof useCall>
  layout: ReturnType<typeof useViewportLayout>
  typingUsers: string[]
  presence: ReturnType<typeof usePresence>
  onClickTitle?: () => void
  onBack?: () => void
}

function TypingIndicator() {
  return (
    <span className="typing-indicator">
      <span className="typing-indicator__text">typing</span>
      <span className="typing-dot" />
      <span className="typing-dot" />
      <span className="typing-dot" />
    </span>
  )
}

function formatTypingSubtitle(typingUsers: string[], chatType: string): React.ReactNode {
  if (typingUsers.length === 0) {
    return null
  }

  if (chatType === 'group') {
    if (typingUsers.length === 1) {
      return <>{typingUsers[0]} is <TypingIndicator /></>
    }

    if (typingUsers.length === 2) {
      return <>{typingUsers[0]} and {typingUsers[1]} are <TypingIndicator /></>
    }

    return <>{typingUsers[0]} and {typingUsers.length - 1} others are <TypingIndicator /></>
  }

  return <TypingIndicator />
}

function getOtherUserId(activeChat: ChatSummary): string | null {
  if (activeChat.is_self_chat || activeChat.type === 'group') return null
  const currentUserId = readAuthSession()?.user.id ?? null
  return activeChat.participant_user_ids?.find((id) => id !== currentUserId) ?? null
}

export function ConversationHeader({ activeChat, groupChat, call, layout, typingUsers, presence, onClickTitle, onBack }: ConversationHeaderProps) {
  const {
    setChatSearchOpen,
    setChatSearchQuery,
  } = useUIContext()

  if (!activeChat) {
    return null
  }

  const otherUserId = getOtherUserId(activeChat)
  const otherPhotoUrl = useProfilePhoto(activeChat.is_self_chat ? null : otherUserId)
  const isPresenceOnline = otherUserId ? presence.onlineUserIds.has(otherUserId) : false
  // If user is typing, they're clearly online
  const isOnline = isPresenceOnline || (typingUsers.length > 0 && !activeChat.is_self_chat && activeChat.type !== 'group')

  const presenceSubtitle = isPresenceOnline ? 'online' : 'last seen recently'
  const defaultSubtitle = activeChat.is_self_chat
    ? ''
    : activeChat.type === 'group'
      ? `${groupChat.groupMembers.length} members`
      : presenceSubtitle

  const subtitleText = typingUsers.length > 0
    ? (activeChat.type === 'group'
        ? `${typingUsers[0]} is typing...`
        : 'typing...')
    : defaultSubtitle

  return (
    <ConversationHeaderUI
      title={activeChat.title}
      subtitle={subtitleText}
      avatarColor={chatAvatarColor(activeChat.title, activeChat.is_self_chat)}
      avatarInitial={activeChat.is_self_chat ? '\uD83D\uDD16' : activeChat.title.slice(0, 1)}
      avatarUrl={otherPhotoUrl}
      online={isOnline}
      onBack={onBack}
      onClickInfo={onClickTitle}
      actions={(
        <>
          {!activeChat.is_self_chat ? (
            <>
              <Tooltip text="Call">
                <button className="conversation-header__btn" type="button" aria-label="Call" onClick={() => call.handleStartCall('voice')}>
                  <PhoneIcon />
                </button>
              </Tooltip>
            </>
          ) : null}
          <Tooltip text="Search in chat">
            <button className="conversation-header__btn" type="button" aria-label="Search in chat" onClick={() => { setChatSearchOpen((v) => !v); setChatSearchQuery('') }}>
              <SearchIcon />
            </button>
          </Tooltip>
        </>
      )}
    />
  )
}
