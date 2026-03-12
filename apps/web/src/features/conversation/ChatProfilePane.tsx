import { useEffect } from 'react'
import type { useGroupChat } from '../../hooks/useGroupChat.ts'
import type { ChatSummary } from '../../lib/api.ts'
import { ChevronLeftIcon } from '../../icons/index.tsx'
import { chatAvatarColor, peerColor } from '../../utils/avatar-colors.ts'

type ChatProfilePaneProps = {
  activeChat: ChatSummary
  groupChat: ReturnType<typeof useGroupChat>
  onClose: () => void
}

export function ChatProfilePane({ activeChat, groupChat, onClose }: ChatProfilePaneProps) {
  // Escape closes the profile pane
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const avatarColor = chatAvatarColor(activeChat.title, activeChat.is_self_chat)

  const avatarInitial = activeChat.is_self_chat
    ? '\uD83D\uDD16'
    : activeChat.title.slice(0, 1)

  const subtitle = activeChat.is_self_chat
    ? 'Your saved messages'
    : activeChat.type === 'group'
      ? `${groupChat.groupMembers.length} members`
      : 'last seen recently'

  return (
    <div className="chat-profile-pane">
      <div className="chat-profile-pane__header">
        <button
          type="button"
          className="vostok-icon-button"
          onClick={onClose}
          aria-label="Back"
        >
          <ChevronLeftIcon />
        </button>
        <span className="chat-profile-pane__header-title">Info</span>
      </div>

      <div className="chat-profile-pane__body">
        <div className="chat-profile-pane__avatar-wrap">
          <div
            className="chat-profile-pane__avatar"
            style={{ background: avatarColor }}
          >
            {avatarInitial}
          </div>
          <h2 className="chat-profile-pane__title">{activeChat.title}</h2>
          <p className="chat-profile-pane__subtitle">{subtitle}</p>
        </div>

        {activeChat.type === 'group' && groupChat.groupMembers.length > 0 && (
          <div className="chat-profile-pane__section">
            <div className="chat-profile-pane__section-title">
              {groupChat.groupMembers.length} members
            </div>
            {groupChat.groupMembers.map((member) => (
              <div key={member.username} className="chat-profile-pane__member">
                <div
                  className="chat-profile-pane__member-avatar"
                  style={{ background: peerColor(member.username) }}
                >
                  {member.username.slice(0, 1).toUpperCase()}
                </div>
                <span className="chat-profile-pane__member-name">{member.username}</span>
                {member.role === 'admin' && (
                  <span className="chat-profile-pane__member-role">admin</span>
                )}
              </div>
            ))}
          </div>
        )}

        {!activeChat.is_self_chat && activeChat.type !== 'group' && (
          <div className="chat-profile-pane__section">
            <div className="chat-profile-pane__info-row">
              <span className="chat-profile-pane__info-label">Username</span>
              <span className="chat-profile-pane__info-value">@{activeChat.title}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
