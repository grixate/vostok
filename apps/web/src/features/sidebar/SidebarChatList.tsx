import { useCallback, useMemo, useState } from 'react'
import { ChatListItem } from '@vostok/ui-chat'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { useProfilePhotos } from '../../hooks/useProfilePhotos.ts'
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
import type { usePresence } from '../../hooks/usePresence.ts'
import type { ChatSummary } from '../../lib/api.ts'

type ChatContextMenu = { chatId: string; x: number; y: number } | null

type SidebarChatListProps = {
  chatList: ReturnType<typeof useChatList>
  activeChat: ChatSummary | null
  draftChatIds: Map<string, string>
  chatFolders: ReturnType<typeof useChatFolders>
  presence: ReturnType<typeof usePresence>
}

function isChatOnline(chat: ChatSummary, onlineUserIds: Set<string>, currentUserId: string | null): boolean {
  if (chat.is_self_chat || chat.type === 'group') return false
  const otherUserId = chat.participant_user_ids?.find((id) => id !== currentUserId)
  return otherUserId ? onlineUserIds.has(otherUserId) : false
}

function readCurrentUserId(): string | null {
  try {
    const raw = window.localStorage.getItem('vostok.auth')
    if (raw) {
      const session = JSON.parse(raw) as { user?: { id?: string } }
      return session.user?.id ?? null
    }
  } catch { /* ignore */ }
  return null
}

export function SidebarChatList({ chatList, activeChat, draftChatIds, chatFolders, presence }: SidebarChatListProps) {
  const { sessionToken } = useAppContext()
  const { chatButtonRefs, showToast } = useUIContext()
  const [chatContextMenu, setChatContextMenu] = useState<ChatContextMenu>(null)
  // Re-read user ID only when session token changes (login/logout)
  const currentUserId = useMemo(() => readCurrentUserId(), [sessionToken])

  // Collect all participant user IDs for photo resolution
  const allParticipantIds = useMemo(() => {
    const ids: string[] = []
    for (const chat of chatList.visibleChatItems) {
      if (!chat.is_self_chat && chat.participant_user_ids) {
        for (const id of chat.participant_user_ids) {
          if (id !== currentUserId && !ids.includes(id)) ids.push(id)
        }
      }
    }
    return ids
  }, [chatList.visibleChatItems, currentUserId])
  const profilePhotos = useProfilePhotos(allParticipantIds)

  const handleChatContextMenu = useCallback((e: React.MouseEvent, chatId: string) => {
    e.preventDefault()
    setChatContextMenu({ chatId, x: e.clientX, y: e.clientY })
  }, [])

  const closeChatContextMenu = useCallback(() => {
    setChatContextMenu(null)
  }, [])

  const handleMarkAsRead = useCallback(() => {
    if (!chatContextMenu || !sessionToken) return
    void markChatRead(sessionToken, chatContextMenu.chatId).catch(() => {})
    // Zero out unread count locally
    chatList.setChatItems((prev) =>
      prev.map((c) => c.id === chatContextMenu.chatId ? { ...c, message_count: 0 } : c)
    )
    showToast('Marked as read')
    closeChatContextMenu()
  }, [chatContextMenu, sessionToken, chatList, showToast, closeChatContextMenu])

  const folderFilteredItems: ChatSummary[] = useMemo(
    () => chatFolders.filterChatsByFolder(chatList.visibleChatItems).filter((chat) => {
      // Hide empty chats with no messages and no draft (unless it's the active chat)
      if (!chat.is_self_chat && !chat.latest_message_at && chat.message_count === 0 && !draftChatIds.has(chat.id)) {
        return chat.id === activeChat?.id
      }
      return true
    }),
    [chatFolders.filterChatsByFolder, chatList.visibleChatItems, draftChatIds, activeChat?.id]
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
                  ? (readChatPreview(chat.id) ? `You: ${readChatPreview(chat.id)?.slice(0, 40) ?? ''}` : 'Your Cloud Storage')
                  : draftChatIds.has(chat.id)
                    ? `Draft: ${draftChatIds.get(chat.id)!.slice(0, 40)}`
                    : readChatPreview(chat.id) ?? (chat.latest_message_at ? 'Encrypted message' : 'No messages yet')
              }
              previewClassName={draftChatIds.has(chat.id) && !chat.is_self_chat ? 'chat-list-item__draft' : undefined}
              timestamp={chat.is_self_chat ? '' : formatRelativeTime(chat.latest_message_at)}
              unreadCount={chat.is_self_chat ? undefined : chat.message_count > 0 ? Math.min(chat.message_count, 9) : undefined}
              active={chat.id === activeChat?.id}
              pinned={false}
              avatarColor={chatAvatarColor(chat.title, chat.is_self_chat)}
              avatarInitial={chat.is_self_chat ? '\uD83D\uDD16' : chat.title.slice(0, 1)}
              avatarUrl={!chat.is_self_chat ? (profilePhotos.get(chat.participant_user_ids?.find((id) => id !== currentUserId) ?? '') ?? null) : null}
              isFirst={index === 0}
              online={isChatOnline(chat, presence.onlineUserIds, currentUserId)}
            />
          </button>
        ))
      ) : (
        <div className="sidebar-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
            <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>
          </svg>
          <span className="sidebar-empty-state__title">Welcome to Vostok</span>
          <span className="sidebar-empty-state__subtitle">Start a conversation or join a group</span>
          <button
            className="sidebar-empty-state__btn"
            type="button"
            onClick={() => chatList.setNewMessageMode(true)}
          >
            New Message
          </button>
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
