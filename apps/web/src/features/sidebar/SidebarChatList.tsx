import { useMemo } from 'react'
import { ChatListItem } from '@vostok/ui-chat'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { formatRelativeTime } from '../../utils/format.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import type { useChatFolders } from '../../hooks/useChatFolders.ts'
import type { ChatSummary } from '../../lib/api.ts'

type SidebarChatListProps = {
  chatList: ReturnType<typeof useChatList>
  activeChat: ChatSummary | null
  draftChatIds: Set<string>
  chatFolders: ReturnType<typeof useChatFolders>
}

export function SidebarChatList({ chatList, activeChat, draftChatIds, chatFolders }: SidebarChatListProps) {
  const { chatButtonRefs } = useUIContext()

  const folderFilteredItems: ChatSummary[] = useMemo(
    () => chatFolders.filterChatsByFolder(chatList.visibleChatItems),
    [chatFolders.filterChatsByFolder, chatList.visibleChatItems]
  )

  if (chatList.newMessageMode) {
    return (
      <div className="sidebar__list">
        {chatList.chatItems
          .filter((c) => !chatList.newChatUsername || c.title.toLowerCase().includes(chatList.newChatUsername.toLowerCase()))
          .map((chat) => (
            <button
              key={chat.id}
              className="chat-list-button"
              type="button"
              onClick={() => { chatList.setActiveChatId(chat.id); chatList.setNewMessageMode(false); chatList.setNewChatUsername('') }}
            >
              <ChatListItem
                title={chat.title}
                preview={chat.is_self_chat ? 'Saved Messages' : chat.type === 'group' ? 'Group' : 'Direct message'}
                timestamp=""
                avatarColor={chat.is_self_chat ? '#007AFF' : chat.type === 'group' ? '#4CD964' : '#5856D6'}
                avatarInitial={chat.is_self_chat ? '\uD83D\uDD16' : chat.title.slice(0, 1)}
              />
            </button>
          ))}
        {chatList.newChatUsername.trim().length > 0 &&
          !chatList.chatItems.some((c) => c.title.toLowerCase() === chatList.newChatUsername.trim().toLowerCase()) ? (
          <button
            className="chat-list-button new-message-create"
            type="button"
            onClick={() => chatList.startDirectChatWith(chatList.newChatUsername.trim())}
          >
            <div
              className="chat-list-item__avatar"
              style={{ background: 'var(--accent)', flexShrink: 0 }}
            >
              {chatList.newChatUsername.trim().slice(0, 1).toUpperCase()}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
              <strong style={{ fontSize: 15 }}>{chatList.newChatUsername.trim()}</strong>
              <span style={{ fontSize: 13, color: 'var(--label2)' }}>Start new chat</span>
            </div>
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="sidebar__list">
      {folderFilteredItems.length > 0 ? (
        folderFilteredItems.map((chat, index) => (
          <button
            key={chat.id}
            className="chat-list-button"
            onClick={() => chatList.setActiveChatId(chat.id)}
            ref={(element) => {
              chatButtonRefs.current[chat.id] = element
            }}
            type="button"
          >
            <ChatListItem
              title={chat.title}
              preview={
                chat.is_self_chat
                  ? ''
                  : draftChatIds.has(chat.id)
                    ? 'Draft'
                    : chat.message_count > 0
                      ? `${chat.message_count} encrypted ${chat.message_count === 1 ? 'message' : 'messages'}`
                      : 'No messages yet'
              }
              previewClassName={draftChatIds.has(chat.id) ? 'chat-list-item__draft' : undefined}
              timestamp={chat.is_self_chat ? '' : formatRelativeTime(chat.latest_message_at)}
              unreadCount={chat.is_self_chat ? undefined : chat.message_count > 0 ? Math.min(chat.message_count, 9) : undefined}
              active={chat.id === activeChat?.id}
              pinned={chat.is_self_chat}
              avatarColor={chat.is_self_chat ? '#007AFF' : chat.type === 'group' ? '#4CD964' : '#5856D6'}
              avatarInitial={chat.is_self_chat ? '\uD83D\uDD16' : chat.title.slice(0, 1)}
              isFirst={index === 0}
            />
          </button>
        ))
      ) : (
        <div style={{ padding: '48px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>{'\uD83D\uDCAC'}</div>
          <p style={{ fontSize: 15, color: 'var(--label2)', margin: 0 }}>
            No chats yet
          </p>
          <p style={{ fontSize: 13, color: 'var(--label3)', margin: '4px 0 0' }}>
            Start a conversation above
          </p>
        </div>
      )}
    </div>
  )
}
