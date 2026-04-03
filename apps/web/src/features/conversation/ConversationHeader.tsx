import { ConversationHeader as ConversationHeaderUI } from '@vostok/ui-chat'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { Tooltip } from '../../components/Tooltip.tsx'
import { chatAvatarColor } from '../../utils/avatar-colors.ts'
import type { useGroupChat } from '../../hooks/useGroupChat.ts'
import type { useCall } from '../../hooks/useCall.ts'
import type { usePresence } from '../../hooks/usePresence.ts'
import type { ChatSummary } from '../../lib/api.ts'
import {
  PhoneIcon,
  SearchIcon,
  VideoCamIcon,
} from '../../icons/index.tsx'
import { useProfilePhoto } from '../../hooks/useProfilePhotos.ts'

type ConversationHeaderProps = {
  activeChat: ChatSummary | null
  currentUserId?: string | null
  serverLabel?: string | null
  serverUrl?: string | null
  groupChat: ReturnType<typeof useGroupChat>
  call: ReturnType<typeof useCall>
  typingUsers: string[]
  presence: ReturnType<typeof usePresence>
  onClickTitle?: () => void
  onBack?: () => void
}

function getOtherUserId(activeChat: ChatSummary, currentUserId: string | null | undefined): string | null {
  if (activeChat.is_self_chat || activeChat.type === 'group') return null
  return activeChat.participant_user_ids?.find((id) => id !== currentUserId) ?? null
}

export function ConversationHeader({ activeChat, currentUserId, serverLabel, serverUrl, groupChat, call, typingUsers, presence, onClickTitle, onBack }: ConversationHeaderProps) {
  const {
    setChatSearchOpen,
    setChatSearchQuery,
  } = useUIContext()
  const otherUserId = activeChat ? getOtherUserId(activeChat, currentUserId) : null
  const otherPhotoUrl = useProfilePhoto(activeChat?.is_self_chat ? null : otherUserId, serverUrl)

  if (!activeChat) {
    return null
  }

  const isPresenceOnline = otherUserId ? presence.onlineUserIds.has(otherUserId) : false
  // If user is typing, they're clearly online
  const isOnline = isPresenceOnline || (typingUsers.length > 0 && !activeChat.is_self_chat && activeChat.type !== 'group')
  const supportsCalling = !activeChat.is_self_chat
  const callingUnavailable = call.callCapabilityState !== 'supported' || !call.isCallSessionReady
  const callTooltip = callingUnavailable
    ? (!call.isCallSessionReady
        ? 'Calls are still loading for this account.'
        : (call.callCapabilityReason ?? 'Calls are unavailable on this browser.'))
    : 'Call'
  const videoTooltip = callingUnavailable
    ? (!call.isCallSessionReady
        ? 'Calls are still loading for this account.'
        : (call.callCapabilityReason ?? 'Calls are unavailable on this browser.'))
    : 'Video call'

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
  const combinedSubtitle = serverLabel
    ? subtitleText
      ? `${serverLabel} · ${subtitleText}`
      : serverLabel
    : subtitleText

  return (
    <ConversationHeaderUI
      title={activeChat.title}
      subtitle={combinedSubtitle}
      avatarColor={chatAvatarColor(activeChat.title, activeChat.is_self_chat)}
      avatarInitial={activeChat.is_self_chat ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg> : activeChat.title.slice(0, 1)}
      avatarUrl={otherPhotoUrl}
      online={isOnline}
      onBack={onBack}
      onClickInfo={onClickTitle}
      actions={(
        <>
          {supportsCalling ? (
            <>
              <Tooltip text={callTooltip}>
                <button
                  className="conversation-header__btn"
                  type="button"
                  aria-label="Call"
                  onClick={() => call.handleStartCall('voice')}
                  disabled={callingUnavailable}
                  title={callTooltip}
                >
                  <PhoneIcon />
                </button>
              </Tooltip>
              <Tooltip text={videoTooltip}>
                <button
                  className="conversation-header__btn"
                  type="button"
                  aria-label="Video call"
                  onClick={() => call.handleStartCall('video')}
                  disabled={callingUnavailable}
                  title={videoTooltip}
                >
                  <VideoCamIcon />
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
