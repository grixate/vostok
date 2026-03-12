import { ConversationHeader as ConversationHeaderUI } from '@vostok/ui-chat'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { Tooltip } from '../../components/Tooltip.tsx'
import type { useGroupChat } from '../../hooks/useGroupChat.ts'
import type { useCall } from '../../hooks/useCall.ts'
import type { useViewportLayout } from '../../hooks/useViewportLayout.ts'
import type { ChatSummary } from '../../lib/api.ts'
import {
  PhoneIcon,
  SearchIcon,
  MoreVertIcon,
  SearchSmallIcon,
  EditSmallIcon,
  InfoSmallIcon,
  DeleteSmallIcon,
} from '../../icons/index.tsx'

type ConversationHeaderProps = {
  activeChat: ChatSummary | null
  groupChat: ReturnType<typeof useGroupChat>
  call: ReturnType<typeof useCall>
  layout: ReturnType<typeof useViewportLayout>
  typingUsers: string[]
  onClickTitle?: () => void
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

export function ConversationHeader({ activeChat, groupChat, call, layout, typingUsers, onClickTitle }: ConversationHeaderProps) {
  const {
    setChatSearchOpen,
    setChatSearchQuery,
    setMoreMenuOpen,
    moreMenuOpen
  } = useUIContext()

  if (!activeChat) {
    return null
  }

  const typingSubtitle = formatTypingSubtitle(typingUsers, activeChat.type)
  const defaultSubtitle = activeChat.is_self_chat
    ? ''
    : activeChat.type === 'group'
      ? `${groupChat.groupMembers.length} members`
      : 'last seen recently'

  // For the subtitle prop we need a string, but for typing we need JSX.
  // The ConversationHeaderUI uses subtitle as a string. Since we can't easily
  // pass JSX into it, we use the string version for the subtitle prop and
  // handle typing differently if needed. For now, we use a simple string.
  const subtitleText = typingUsers.length > 0
    ? (activeChat.type === 'group'
        ? `${typingUsers[0]} is typing...`
        : 'typing...')
    : defaultSubtitle

  return (
    <ConversationHeaderUI
      title={activeChat.title}
      subtitle={subtitleText}
      avatarColor={activeChat.is_self_chat ? '#007AFF' : activeChat.type === 'group' ? '#4CD964' : '#5856D6'}
      avatarInitial={activeChat.is_self_chat ? '\uD83D\uDD16' : activeChat.title.slice(0, 1)}
      online={!activeChat.is_self_chat && activeChat.type !== 'group'}
      onClickInfo={onClickTitle}
      actions={(
        <>
          {!activeChat.is_self_chat ? (
            <Tooltip text="Voice call">
              <button className="vostok-icon-button" type="button" aria-label="Voice call" onClick={() => call.handleStartCall('voice')}>
                <PhoneIcon />
              </button>
            </Tooltip>
          ) : null}
          <Tooltip text="Search messages">
            <button className="vostok-icon-button" type="button" aria-label="Search" onClick={() => { setChatSearchOpen((v) => !v); setChatSearchQuery('') }}>
              <SearchIcon />
            </button>
          </Tooltip>
          <div className="dropdown-anchor">
            <Tooltip text="More options">
              <button className="vostok-icon-button" type="button" aria-label="More options" onClick={() => setMoreMenuOpen((v) => !v)}>
                <MoreVertIcon />
              </button>
            </Tooltip>
            {moreMenuOpen ? (
              <div className="dropdown-menu" onClick={() => setMoreMenuOpen(false)}>
                <button className="dropdown-menu__item" type="button" onClick={() => { setChatSearchOpen(true); setChatSearchQuery('') }}>
                  <SearchSmallIcon />
                  Search
                </button>
                {activeChat?.type === 'group' ? (
                  <button className="dropdown-menu__item" type="button" onClick={() => { /* edit group */ }}>
                    <EditSmallIcon />
                    Edit
                  </button>
                ) : null}
                <button className="dropdown-menu__item" type="button" onClick={() => { setMoreMenuOpen(false); onClickTitle?.() }}>
                  <InfoSmallIcon />
                  Info
                </button>
                <div className="dropdown-menu__sep" />
                <button className="dropdown-menu__item dropdown-menu__item--danger" type="button">
                  <DeleteSmallIcon />
                  Delete Chat
                </button>
              </div>
            ) : null}
          </div>
        </>
      )}
    />
  )
}
