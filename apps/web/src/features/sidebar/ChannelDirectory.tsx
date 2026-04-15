import { useEffect, useMemo, useState } from 'react'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { joinChannel, listPublicChannels, type ChatSummary } from '../../lib/api.ts'
import { qualifyChatId } from '../../lib/multi-server.ts'
import { mergeChat } from '../../utils/chat-helpers.ts'
import { t } from '../../lib/i18n.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import { MegaphoneIcon } from '../../icons/index.tsx'

type ChannelDirectoryProps = {
  chatList: ReturnType<typeof useChatList>
}

export function ChannelDirectory({ chatList }: ChannelDirectoryProps) {
  const { sessionToken, setBanner, setLoading } = useAppContext()
  const { setSidebarTab } = useUIContext()
  const [channels, setChannels] = useState<ChatSummary[]>([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!sessionToken) {
      return
    }

    let cancelled = false

    listPublicChannels(sessionToken)
      .then((response) => {
        if (!cancelled) {
          setChannels(response.channels)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setChannels([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [sessionToken])

  const joinedRawIds = useMemo(
    () => new Set(chatList.chatItems.filter((chat) => chat.type === 'channel').map((chat) => chat.rawId)),
    [chatList.chatItems]
  )

  const visibleChannels = useMemo(() => {
    const normalized = filter.trim().toLowerCase()
    if (!normalized) {
      return channels
    }

    return channels.filter((channel) => {
      const haystacks = [channel.title, channel.description ?? '']
      return haystacks.some((value) => value.toLowerCase().includes(normalized))
    })
  }, [channels, filter])

  async function handleJoin(channel: ChatSummary) {
    if (!sessionToken || !chatList.activeServer) {
      return
    }

    setLoading(true)

    try {
      const response = await joinChannel(sessionToken, channel.id)
      const qualifiedId = qualifyChatId(chatList.activeServer.id, response.chat.id)
      const mergedChat = {
        ...response.chat,
        id: qualifiedId,
        rawId: response.chat.id,
        qualifiedId,
        serverId: chatList.activeServer.id,
        serverLabel: chatList.activeServer.label,
        serverColor: chatList.activeServer.color,
        serverUrl: chatList.activeServer.url
      }

      chatList.setChatItems((current) => mergeChat(current, mergedChat))
      chatList.setActiveChatId(qualifiedId)
      setSidebarTab('chats')
      setBanner({ tone: 'success', message: t('joined_channel', response.chat.title) })
    } catch (error) {
      setBanner({ tone: 'error', message: error instanceof Error ? error.message : t('failed_to_join_channel') })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="sidebar__list">
      <div className="sidebar__header">
        <div className="sidebar__title-row">
          <span className="sidebar__title">{t('channels')}</span>
        </div>
        <label className="search-bar">
          <input
            className="search-bar__input"
            placeholder={t('browse_channels')}
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
        </label>
      </div>

      {visibleChannels.length > 0 ? (
        <div className="channel-directory__list">
          {visibleChannels.map((channel) => {
            const joined = joinedRawIds.has(channel.id)
            return (
              <div key={channel.id} className="channel-directory__card">
                <div className="channel-directory__card-header">
                  <span className="channel-directory__card-icon" aria-hidden="true">
                    <MegaphoneIcon />
                  </span>
                  <h3 className="channel-directory__card-title">{channel.title}</h3>
                </div>
                {channel.description ? (
                  <p className="channel-directory__card-description">{channel.description}</p>
                ) : null}
                <p className="channel-directory__card-meta">
                  {t('n_subscribers', channel.member_count ?? 0)}
                </p>
                <div className="channel-directory__card-actions">
                  <button
                    className={joined ? 'secondary-action' : 'primary-action'}
                    type="button"
                    onClick={() => void handleJoin(channel)}
                    disabled={joined}
                  >
                    {joined ? t('joined') : t('join_channel')}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="empty-state empty-state--flex">
          <div className="empty-state__icon empty-state__icon--accent">
            <MegaphoneIcon />
          </div>
          <p className="empty-state__title">{t('channels')}</p>
          <p className="empty-state__body">{t('no_channels_found')}</p>
        </div>
      )}
    </div>
  )
}
