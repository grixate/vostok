import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from 'react'
import { t } from '../../lib/i18n.ts'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { SearchIcon } from '../../icons/index.tsx'
import { peerColor } from '../../utils/avatar-colors.ts'
import { listUsers, createGroupChat, createChannel } from '../../lib/api.ts'
import { qualifyChatId } from '../../lib/multi-server.ts'
import { mergeChat } from '../../utils/chat-helpers.ts'
import type { useChatList } from '../../hooks/useChatList.ts'

type NewMessagePanelProps = {
  chatList: ReturnType<typeof useChatList>
}

function ContactRow({
  username,
  subtitle,
  highlighted,
  selected,
  onClick
}: {
  username: string
  subtitle?: string
  highlighted: boolean
  selected?: boolean
  onClick: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (highlighted && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' })
    }
  }, [highlighted])

  return (
    <button
      ref={ref}
      type="button"
      className={`new-message-contact${highlighted ? ' new-message-contact--highlighted' : ''}`}
      onClick={onClick}
      aria-selected={highlighted}
      aria-label={t('start_chat_with', username)}
    >
      <span
        className="new-message-contact__avatar"
        style={{ background: peerColor(username) }}
        aria-hidden="true"
      >
        {username[0]?.toUpperCase() ?? '?'}
      </span>
      <span className="new-message-contact__username">{username}</span>
      <span className="new-message-contact__handle">
        {selected ? 'Selected' : (subtitle ?? `@${username}`)}
      </span>
    </button>
  )
}

export function NewMessagePanel({ chatList }: NewMessagePanelProps) {
  const { sessionToken, setBanner, setLoading } = useAppContext()
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [allUsers, setAllUsers] = useState<{ id: string; username: string }[]>([])
  const [groupTitle, setGroupTitle] = useState(chatList.newGroupTitle)
  const [groupDescription, setGroupDescription] = useState('')
  const [channelTitle, setChannelTitle] = useState(chatList.newChannelTitle)
  const [channelDescription, setChannelDescription] = useState(chatList.newChannelDescription)
  const [channelComments, setChannelComments] = useState(true)
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    setQuery('')
    setHighlightedIndex(0)
  }, [chatList.newChatMode])

  useEffect(() => {
    if (!sessionToken) return
    listUsers(sessionToken).then((res) => setAllUsers(res.users)).catch(() => {})
  }, [sessionToken])

  const normalizedQuery = query.trim().toLowerCase()
  const suggestions = (() => {
    if (!normalizedQuery) {
      return allUsers
    }

    return allUsers.filter((user) => user.username.toLowerCase().includes(normalizedQuery))
  })()

  const showNewContactRow =
    chatList.newChatMode === 'direct' &&
    normalizedQuery.length > 0 &&
    !suggestions.some((s) => s.username.toLowerCase() === normalizedQuery)

  const totalRows = suggestions.length + (showNewContactRow ? 1 : 0)

  useEffect(() => {
    setHighlightedIndex(0)
  }, [query])

  const selectHighlighted = useCallback(() => {
    if (chatList.newChatMode !== 'direct') {
      return
    }

    if (highlightedIndex < suggestions.length) {
      void chatList.startDirectChatWith(suggestions[highlightedIndex].username)
    } else if (showNewContactRow && normalizedQuery) {
      void chatList.startDirectChatWith(normalizedQuery)
    }
  }, [chatList, highlightedIndex, normalizedQuery, showNewContactRow, suggestions])

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (chatList.newChatMode !== 'direct') {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex((i) => Math.min(i + 1, totalRows - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex((i) => Math.max(i - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      selectHighlighted()
    }
  }

  async function handleCreateGroup() {
    if (!sessionToken || !chatList.activeServer || groupTitle.trim() === '') {
      return
    }

    setLoading(true)

    try {
      const response = await createGroupChat(sessionToken, {
        title: groupTitle.trim(),
        description: groupDescription.trim() || undefined,
        members: selectedMembers
      })

      const mergedChat = {
        ...response.chat,
        id: qualifyChatId(chatList.activeServer.id, response.chat.id),
        rawId: response.chat.id,
        qualifiedId: qualifyChatId(chatList.activeServer.id, response.chat.id),
        serverId: chatList.activeServer.id,
        serverLabel: chatList.activeServer.label,
        serverColor: chatList.activeServer.color,
        serverUrl: chatList.activeServer.url
      }

      chatList.setChatItems((current) => mergeChat(current, mergedChat))
      chatList.setActiveChatId(mergedChat.id)
      chatList.setNewChatMode(null)
      setGroupTitle('')
      setGroupDescription('')
      setSelectedMembers([])
      setBanner({ tone: 'success', message: `Group ready: ${response.chat.title}` })
    } catch (error) {
      setBanner({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to create group.' })
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateChannel() {
    if (!sessionToken || !chatList.activeServer || channelTitle.trim() === '') {
      return
    }

    setLoading(true)

    try {
      const response = await createChannel(sessionToken, {
        title: channelTitle.trim(),
        description: channelDescription.trim() || undefined,
        allow_comments: channelComments
      })

      const mergedChat = {
        ...response.chat,
        id: qualifyChatId(chatList.activeServer.id, response.chat.id),
        rawId: response.chat.id,
        qualifiedId: qualifyChatId(chatList.activeServer.id, response.chat.id),
        serverId: chatList.activeServer.id,
        serverLabel: chatList.activeServer.label,
        serverColor: chatList.activeServer.color,
        serverUrl: chatList.activeServer.url
      }

      chatList.setChatItems((current) => mergeChat(current, mergedChat))
      chatList.setActiveChatId(mergedChat.id)
      chatList.setNewChatMode(null)
      setChannelTitle('')
      setChannelDescription('')
      setBanner({ tone: 'success', message: `Channel ready: ${response.chat.title}` })
    } catch (error) {
      setBanner({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to create channel.' })
    } finally {
      setLoading(false)
    }
  }

  function toggleMember(username: string) {
    setSelectedMembers((current) =>
      current.includes(username)
        ? current.filter((entry) => entry !== username)
        : [...current, username]
    )
  }

  if (chatList.newChatMode === 'group') {
    return (
      <div className="new-message-panel">
        <div className="new-message-panel__search-row">
          <input
            ref={inputRef}
            type="text"
            className="new-message-panel__input"
            placeholder="Group title"
            value={groupTitle}
            onChange={(event) => setGroupTitle(event.target.value)}
          />
        </div>
        <div className="new-message-panel__search-row">
          <input
            type="text"
            className="new-message-panel__input"
            placeholder="Description (optional)"
            value={groupDescription}
            onChange={(event) => setGroupDescription(event.target.value)}
          />
        </div>
        <div className="new-message-panel__search-row">
          <span className="new-message-panel__search-icon"><SearchIcon width={14} height={14} /></span>
          <input
            type="search"
            autoComplete="off"
            className="new-message-panel__input"
            placeholder={t('search_members')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {selectedMembers.length > 0 ? (
          <p className="new-message-panel__empty">{selectedMembers.join(', ')}</p>
        ) : null}
        <div className="new-message-panel__list">
          {suggestions.map((user) => (
            <ContactRow
              key={user.id}
              username={user.username}
              selected={selectedMembers.includes(user.username)}
              highlighted={false}
              onClick={() => toggleMember(user.username)}
            />
          ))}
        </div>
        <button className="primary-action empty-state__action" type="button" onClick={() => void handleCreateGroup()}>
          Create Group
        </button>
      </div>
    )
  }

  if (chatList.newChatMode === 'channel') {
    return (
      <div className="new-message-panel">
        <div className="new-message-panel__search-row">
          <input
            ref={inputRef}
            type="text"
            className="new-message-panel__input"
            placeholder={t('channel_title')}
            value={channelTitle}
            onChange={(event) => setChannelTitle(event.target.value)}
          />
        </div>
        <div className="new-message-panel__search-row">
          <input
            type="text"
            className="new-message-panel__input"
            placeholder={t('description')}
            value={channelDescription}
            onChange={(event) => setChannelDescription(event.target.value)}
          />
        </div>
        <label className="new-message-panel__checkbox">
          <input type="checkbox" checked={channelComments} onChange={(event) => setChannelComments(event.target.checked)} />
          <span>{t('allow_comments')}</span>
        </label>
        <button className="primary-action empty-state__action" type="button" onClick={() => void handleCreateChannel()}>
          {t('create_channel')}
        </button>
      </div>
    )
  }

  return (
    <div className="new-message-panel">
      <div className="new-message-panel__search-row">
        <span className="new-message-panel__to">{t('to')}</span>
        <span className="new-message-panel__search-icon"><SearchIcon width={14} height={14} /></span>
        <input
          ref={inputRef}
          type="search"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="new-message-panel__input"
          placeholder={t('search_members')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          aria-label={t('search_members')}
        />
      </div>

      <div className="new-message-panel__list" role="listbox" aria-label={t('members')}>
        {suggestions.length === 0 && !showNewContactRow && normalizedQuery && (
          <p className="new-message-panel__empty">{t('no_members_found')}</p>
        )}

        {suggestions.length === 0 && !normalizedQuery && (
          <p className="new-message-panel__empty">{t('type_to_search')}</p>
        )}

        {suggestions.map((contact, index) => (
          <ContactRow
            key={contact.username}
            username={contact.username}
            highlighted={highlightedIndex === index}
            onClick={() => void chatList.startDirectChatWith(contact.username)}
          />
        ))}

        {showNewContactRow ? (
          <button
            type="button"
            className={`new-message-contact new-message-contact--new${
              highlightedIndex === suggestions.length ? ' new-message-contact--highlighted' : ''
            }`}
            onClick={() => void chatList.startDirectChatWith(normalizedQuery)}
          >
            <span className="new-message-contact__avatar new-message-contact__avatar--new" aria-hidden="true">+</span>
            <span className="new-message-contact__username">{t('start_chat_with', query.trim())}</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
