import { useCallback, useMemo, useState } from 'react'
import { t } from '../../lib/i18n.ts'
import { LayoutGroup, motion } from 'motion/react'
import { ChatListItem } from '@vostok/ui-chat'
import { resolveApiAssetUrl, useProfilePhotos } from '../../hooks/useProfilePhotos.ts'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { formatRelativeTime } from '../../utils/format.ts'
import { chatAvatarColor } from '../../utils/avatar-colors.ts'
import { readChatPreview } from '../../lib/message-cache.ts'
import {
  MegaphoneIcon,
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

import type { MergedChatSummary } from '../../lib/multi-server.ts'

type ChatContextMenu = { chatId: string; x: number; y: number } | null

type SidebarChatListProps = {
  chatList: ReturnType<typeof useChatList>
  activeChat: MergedChatSummary | null
  draftChatIds: Map<string, string>
}

export function SidebarChatList({ chatList, activeChat, draftChatIds }: SidebarChatListProps) {
  const { chatButtonRefs, showToast } = useUIContext()
  const [chatContextMenu, setChatContextMenu] = useState<ChatContextMenu>(null)

  // Collect all participant user IDs for photo resolution
  const allParticipantIds = useMemo(() => {
    const ids: string[] = []
    for (const chat of chatList.visibleChatItems) {
      if (!chat.is_self_chat && chat.participant_user_ids && chat.serverId === chatList.activeServerId) {
        const currentUserId =
          chatList.resolveServerScope(chat.id)?.server.auth?.user.id ?? null
        for (const id of chat.participant_user_ids) {
          if (id !== currentUserId && !ids.includes(id)) ids.push(id)
        }
      }
    }
    return ids
  }, [chatList])
  const profilePhotos = useProfilePhotos(allParticipantIds, chatList.activeServerUrl)

  const handleChatContextMenu = useCallback((e: React.MouseEvent, chatId: string) => {
    e.preventDefault()
    setChatContextMenu({ chatId, x: e.clientX, y: e.clientY })
  }, [])

  const closeChatContextMenu = useCallback(() => {
    setChatContextMenu(null)
  }, [])

  const handleMarkAsRead = useCallback(() => {
    if (!chatContextMenu) return
    const scope = chatList.resolveServerScope(chatContextMenu.chatId)
    if (!scope?.token || !scope.rawChatId) return
    void scope.api.markChatRead(scope.token, scope.rawChatId).catch(() => {})
    // Zero out unread count locally
    chatList.setChatItems((prev) =>
      prev.map((c) => c.id === chatContextMenu.chatId ? { ...c, message_count: 0 } : c)
    )
    showToast(t('marked_as_read'))
    closeChatContextMenu()
  }, [chatContextMenu, chatList, showToast, closeChatContextMenu])

  const folderFilteredItems: MergedChatSummary[] = chatList.visibleChatItems
    .filter((chat) => {
      // Hide empty chats with no messages and no draft (unless it's the active chat)
      if (!chat.is_self_chat && !chat.latest_message_at && chat.message_count === 0 && !draftChatIds.has(chat.id)) {
        return chat.id === activeChat?.id
      }
      return true
    })

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
              onClick={() => { chatList.setActiveChatId(chat.id); chatList.setNewChatMode(null); chatList.setNewChatUsername('') }}
            >
              <ChatListItem
                title={chat.title}
                preview={
                  chat.is_self_chat
                    ? t('saved_messages')
                    : chat.type === 'group'
                      ? t('group')
                      : chat.type === 'channel'
                        ? 'Channel'
                        : t('direct_message')
                }
                timestamp=""
                avatarColor={chatAvatarColor(chat.title, chat.is_self_chat)}
                avatarInitial={
                  chat.is_self_chat
                    ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                    : chat.type === 'group'
                      ? '👥'
                      : chat.type === 'channel'
                        ? '📢'
                        : chat.title.slice(0, 1)
                }
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
              <span style={{ fontSize: 13, color: 'var(--label2)' }}>{t('start_new_chat')}</span>
            </div>
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="sidebar__list">
      {folderFilteredItems.length > 0 ? (
        <LayoutGroup>
        {folderFilteredItems.map((chat, index) => (
          <motion.button
            key={chat.id}
            layout
            transition={{ type: 'tween', duration: 0.25, ease: [0.2, 0, 0, 1] }}
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
                (() => {
                  const rawPreview = chat.is_self_chat
                    ? (readChatPreview(chat.id) ? `You: ${readChatPreview(chat.id)?.slice(0, 40) ?? ''}` : t('your_cloud_storage'))
                    : draftChatIds.has(chat.id)
                      ? `Draft: ${draftChatIds.get(chat.id)!.slice(0, 40)}`
                      : readChatPreview(chat.id) ?? (chat.latest_message_at ? t('new_message') : t('no_messages'))

                  return chatList.hasMultipleServers ? `${chat.serverLabel} · ${rawPreview}` : rawPreview
                })()
              }
              previewClassName={draftChatIds.has(chat.id) && !chat.is_self_chat ? 'chat-list-item__draft' : undefined}
              timestamp={chat.is_self_chat ? '' : formatRelativeTime(chat.latest_message_at)}
              unreadCount={chat.is_self_chat || chat.id === activeChat?.id ? undefined : chat.message_count > 0 ? Math.min(chat.message_count, 9) : undefined}
              active={chat.id === activeChat?.id}
              pinned={false}
              avatarColor={chatAvatarColor(chat.title, chat.is_self_chat)}
              avatarInitial={
                chat.is_self_chat
                  ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
                  : chat.type === 'group'
                    ? '👥'
                    : chat.type === 'channel'
                      ? <MegaphoneIcon width={22} height={22} />
                      : chat.title.slice(0, 1)
              }
              avatarUrl={chat.is_self_chat
                ? null
                : chat.type === 'direct'
                  ? (chat.serverId === chatList.activeServerId
                      ? (profilePhotos.get(
                          chat.participant_user_ids?.find(
                            (id) => id !== (chatList.resolveServerScope(chat.id)?.server.auth?.user.id ?? null)
                          ) ?? ''
                        ) ?? null)
                      : null)
                  : resolveApiAssetUrl(chat.avatar_url, chat.serverUrl)}
              isFirst={index === 0}
              online={chatList.isChatOnline(chat)}
            />
          </motion.button>
        ))}
        </LayoutGroup>
      ) : (
        <div className="empty-state">
          <div className="empty-state__icon" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/>
            </svg>
          </div>
          <p className="empty-state__title">{t('welcome_title')}</p>
          <p className="empty-state__body">{t('no_conversations_subtitle')}</p>
          <button
            className="primary-action empty-state__action"
            type="button"
            onClick={() => chatList.setNewChatMode('direct')}
          >
            {t('new_message')}
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
                {isGroup ? t('view_group_info') : t('view_profile')}
              </button>
              <button type="button" onClick={handleMarkAsRead}>
                <CheckCheckSmallIcon style={{ color: '#888' }} />
                {t('mark_as_read')}
              </button>
              <button type="button" disabled>
                <MuteSmallIcon style={{ color: '#888' }} />
                {t('mute_notifications')}
              </button>
              <button type="button" disabled>
                <PinSmallIcon style={{ color: '#888' }} />
                {t('pin_chat')}
              </button>
              {isGroup ? (
                <>
                  <div className="msg-context-menu__sep" />
                  <button type="button" className="msg-context-menu__danger" disabled>
                    <SignOutSmallIcon style={{ color: '#FF4444' }} />
                    {t('leave_group')}
                  </button>
                </>
              ) : (
                <>
                  <button type="button" disabled>
                    <ArchiveSmallIcon style={{ color: '#888' }} />
                    {t('archive')}
                  </button>
                  <div className="msg-context-menu__sep" />
                  <button type="button" className="msg-context-menu__danger" disabled>
                    <DeleteSmallTrashIcon style={{ color: '#FF5500' }} />
                    {t('delete_chat')}
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
