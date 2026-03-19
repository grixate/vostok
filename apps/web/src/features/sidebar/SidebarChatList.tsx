import { useCallback, useMemo, useState } from 'react'
import { ChatListItem } from '@vostok/ui-chat'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { formatRelativeTime } from '../../utils/format.ts'
import { chatAvatarColor } from '../../utils/avatar-colors.ts'
import { readChatPreview } from '../../lib/message-cache.ts'
import { markChatRead } from '../../lib/api.ts'
import {
  UserSmallIcon,
  UsersSmallIcon,
  CheckCheckSmallIcon,
  MuteSmallIcon,
  PinSmallIcon,
  ArchiveSmallIcon,
  DeleteSmallTrashIcon,
  SignOutSmallIcon,
} from '../../icons/index.tsx'
import type { useChatList } from '../../hooks/useChatList.ts'
import type { useChatFolders } from '../../hooks/useChatFolders.ts'
import type { ChatSummary } from '../../lib/api.ts'

type ChatContextMenu = { chatId: string; x: number; y: number } | null

type SidebarChatListProps = {
  chatList: ReturnType<typeof useChatList>
  activeChat: ChatSummary | null
  draftChatIds: Set<string>
  chatFolders: ReturnType<typeof useChatFolders>
}

export function SidebarChatList({ chatList, activeChat, draftChatIds, chatFolders }: SidebarChatListProps) {
  const { storedDevice } = useAppContext()
  const { chatButtonRefs, showToast } = useUIContext()
  const [chatContextMenu, setChatContextMenu] = useState<ChatContextMenu>(null)

  const handleChatContextMenu = useCallback((e: React.MouseEvent, chatId: string) => {
    e.preventDefault()
    setChatContextMenu({ chatId, x: e.clientX, y: e.clientY })
  }, [])

  const closeChatContextMenu = useCallback(() => {
    setChatContextMenu(null)
  }, [])

  const handleMarkAsRead = useCallback(() => {
    if (!chatContextMenu || !storedDevice) return
    void markChatRead(storedDevice.sessionToken, chatContextMenu.chatId).catch(() => {})
    // Zero out unread count locally
    chatList.setChatItems((prev) =>
      prev.map((c) => c.id === chatContextMenu.chatId ? { ...c, message_count: 0 } : c)
    )
    showToast('Marked as read')
    closeChatContextMenu()
  }, [chatContextMenu, storedDevice, chatList, showToast, closeChatContextMenu])

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
                avatarColor={chatAvatarColor(chat.title, chat.is_self_chat)}
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
            onContextMenu={(e) => handleChatContextMenu(e, chat.id)}
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
                    : readChatPreview(chat.id) ?? (chat.latest_message_at ? 'Encrypted message' : 'No messages yet')
              }
              previewClassName={draftChatIds.has(chat.id) ? 'chat-list-item__draft' : undefined}
              timestamp={chat.is_self_chat ? '' : formatRelativeTime(chat.latest_message_at)}
              unreadCount={chat.is_self_chat ? undefined : chat.message_count > 0 ? Math.min(chat.message_count, 9) : undefined}
              active={chat.id === activeChat?.id}
              pinned={chat.is_self_chat}
              avatarColor={chatAvatarColor(chat.title, chat.is_self_chat)}
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

      {chatContextMenu ? (() => {
        const contextChat = chatList.chatItems.find((c) => c.id === chatContextMenu.chatId)
        const isGroup = contextChat?.type === 'group'
        return (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 200 }}
              onClick={closeChatContextMenu}
              onContextMenu={(e) => { e.preventDefault(); closeChatContextMenu() }}
            />
            <div
              className="msg-context-menu"
              style={{ top: chatContextMenu.y, left: chatContextMenu.x }}
            >
              <button type="button" onClick={() => { chatList.setActiveChatId(chatContextMenu.chatId); closeChatContextMenu() }}>
                {isGroup ? <UsersSmallIcon style={{ color: '#888' }} /> : <UserSmallIcon style={{ color: '#888' }} />}
                {isGroup ? 'View Group Info' : 'View Profile'}
              </button>
              <button type="button" onClick={handleMarkAsRead}>
                <CheckCheckSmallIcon style={{ color: '#888' }} />
                Mark as Read
              </button>
              <button type="button" disabled>
                <MuteSmallIcon style={{ color: '#888' }} />
                Mute Notifications
              </button>
              <button type="button" disabled>
                <PinSmallIcon style={{ color: '#888' }} />
                Pin Chat
              </button>
              {isGroup ? (
                <>
                  <div className="msg-context-menu__sep" />
                  <button type="button" className="msg-context-menu__danger" disabled>
                    <SignOutSmallIcon style={{ color: '#FF4444' }} />
                    Leave Group
                  </button>
                </>
              ) : (
                <>
                  <button type="button" disabled>
                    <ArchiveSmallIcon style={{ color: '#888' }} />
                    Archive
                  </button>
                  <div className="msg-context-menu__sep" />
                  <button type="button" className="msg-context-menu__danger" disabled>
                    <DeleteSmallTrashIcon style={{ color: '#FF5500' }} />
                    Delete Chat
                  </button>
                </>
              )}
            </div>
          </>
        )
      })() : null}
    </div>
  )
}
