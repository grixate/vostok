import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { listUsers, type DirectoryUser } from '../../lib/api.ts'
import { peerColor } from '../../utils/avatar-colors.ts'
import { useProfilePhotos } from '../../hooks/useProfilePhotos.ts'
import { BackIcon, CopyIcon, ShieldIcon, ChatsIcon, PhoneIcon } from '../../icons/index.tsx'
import type { useChatList } from '../../hooks/useChatList.ts'

type MembersPaneProps = {
  chatList: ReturnType<typeof useChatList>
}

function formatLastSeen(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  const diffSec = Math.floor((Date.now() - then) / 1000)
  if (diffSec < 60) return 'just now'
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  if (diffSec < 172800) return 'yesterday'
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function formatJoinedAt(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

type MemberRowProps = {
  user: DirectoryUser
  online: boolean
  selected: boolean
  photoUrl?: string
  onClick: () => void
}

function MemberRow({ user, online, selected, photoUrl, onClick }: MemberRowProps) {
  const initial = user.username.slice(0, 1).toUpperCase()
  return (
    <button
      type="button"
      className={`members-pane__item${selected ? ' members-pane__item--selected' : ''}`}
      onClick={onClick}
    >
      <div
        className="members-pane__avatar"
        style={{ background: photoUrl ? 'none' : peerColor(user.username) }}
      >
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={user.username}
            style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
          />
        ) : (
          initial
        )}
      </div>
      <div className="members-pane__name-stack">
        <div className="members-pane__name-row">
          <span className="members-pane__name">{user.display_name || user.username}</span>
          {user.role === 'admin' && (
            <span className="members-pane__admin-shield" title="Admin">
              <ShieldIcon />
            </span>
          )}
        </div>
        {user.display_name && user.display_name !== user.username && (
          <span className="members-pane__subtitle">@{user.username}</span>
        )}
      </div>
      <div className="members-pane__trailing">
        {online ? (
          <span className="members-pane__presence-dot" aria-label="online" />
        ) : (
          <span className="members-pane__last-seen">{formatLastSeen(user.last_seen_at)}</span>
        )}
      </div>
    </button>
  )
}

type MemberProfileProps = {
  user: DirectoryUser
  online: boolean
  photoUrl?: string
  mutualGroups: { id: string; title: string }[]
  onBack: () => void
  onMessage: () => void
  onCopyHandle: () => void
}

function MemberProfile({ user, online, photoUrl, mutualGroups, onBack, onMessage, onCopyHandle }: MemberProfileProps) {
  const initial = user.username.slice(0, 1).toUpperCase()
  return (
    <div className="member-profile">
      <div className="member-profile__header">
        <button type="button" className="member-profile__back" onClick={onBack} aria-label="Back">
          <BackIcon />
        </button>
        <span className="member-profile__header-title">Profile</span>
      </div>
      <div className="member-profile__hero">
        <div
          className="member-profile__big-avatar"
          style={{ background: photoUrl ? 'none' : peerColor(user.username) }}
        >
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={user.username}
              style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
            />
          ) : (
            initial
          )}
        </div>
        <div className="member-profile__name">
          {user.display_name || user.username}
          {user.role === 'admin' && (
            <span className="member-profile__admin-shield" title="Admin">
              <ShieldIcon />
            </span>
          )}
        </div>
        <div className="member-profile__handle-row">
          <span className="member-profile__handle">@{user.username}</span>
          <button
            type="button"
            className="member-profile__copy"
            onClick={onCopyHandle}
            aria-label="Copy handle"
          >
            <CopyIcon />
          </button>
        </div>
        <div className={`member-profile__presence${online ? ' member-profile__presence--online' : ''}`}>
          <span className="member-profile__presence-dot" />
          {online ? 'Online' : `Last seen ${formatLastSeen(user.last_seen_at)}`}
        </div>
      </div>
      <div className="member-profile__actions">
        <button type="button" className="member-profile__action-primary" onClick={onMessage}>
          <ChatsIcon />
          Message
        </button>
        <button type="button" className="member-profile__action-ghost" disabled>
          <PhoneIcon />
          Call
        </button>
      </div>
      <div className="member-profile__info">
        {user.bio && (
          <section className="member-profile__section">
            <h3 className="member-profile__label">About</h3>
            <p className="member-profile__bio">{user.bio}</p>
          </section>
        )}
        <section className="member-profile__section">
          <h3 className="member-profile__label">Member since</h3>
          <p className="member-profile__value">{formatJoinedAt(user.joined_at)}</p>
        </section>
        <section className="member-profile__section">
          <h3 className="member-profile__label">Mutual groups</h3>
          {mutualGroups.length === 0 ? (
            <p className="member-profile__value member-profile__value--muted">None yet</p>
          ) : (
            <ul className="member-profile__groups">
              {mutualGroups.map((g) => (
                <li key={g.id} className="member-profile__group">
                  <div
                    className="member-profile__group-avatar"
                    style={{ background: peerColor(g.title || g.id) }}
                  >
                    {(g.title || '#').slice(0, 1).toUpperCase()}
                  </div>
                  <span className="member-profile__group-name">{g.title || 'Untitled group'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

export function MembersPane({ chatList }: MembersPaneProps) {
  const { sessionToken } = useAppContext()
  const { setSidebarTab, showToast } = useUIContext()
  const [users, setUsers] = useState<DirectoryUser[]>([])
  const [filter, setFilter] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionToken) return
    listUsers(sessionToken)
      .then((res) => setUsers(res.users))
      .catch(() => {})
  }, [sessionToken])

  const filtered = useMemo(() => {
    if (!filter) return users
    const q = filter.toLowerCase()
    return users.filter(
      (u) =>
        u.username.toLowerCase().includes(q) ||
        (u.display_name && u.display_name.toLowerCase().includes(q))
    )
  }, [filter, users])

  const { online, offline } = useMemo(() => {
    const on: DirectoryUser[] = []
    const off: DirectoryUser[] = []
    for (const u of filtered) {
      if (chatList.isMemberOnline(u.id)) on.push(u)
      else off.push(u)
    }
    return { online: on, offline: off }
  }, [filtered, chatList])

  const memberIdsWithPhotos = useMemo(
    () => users.filter((u) => u.has_photo).map((u) => u.id),
    [users]
  )
  const memberPhotos = useProfilePhotos(memberIdsWithPhotos, chatList.activeServerUrl)

  const selectedUser = useMemo(
    () => (selectedId ? users.find((u) => u.id === selectedId) ?? null : null),
    [selectedId, users]
  )

  const mutualGroups = useMemo(() => {
    if (!selectedUser || !chatList.currentUserId) return []
    const me = chatList.currentUserId
    return chatList.chatItems
      .filter(
        (c) =>
          c.type === 'group' &&
          c.participant_user_ids?.includes(me) &&
          c.participant_user_ids?.includes(selectedUser.id)
      )
      .map((c) => ({ id: c.id, title: c.title }))
  }, [selectedUser, chatList.chatItems, chatList.currentUserId])

  function handleSelectMember(user: DirectoryUser) {
    setSelectedId(user.id)
  }

  function handleMessage(user: DirectoryUser) {
    chatList.startDirectChatWith(user.username)
    setSidebarTab('chats')
  }

  function handleCopyHandle(user: DirectoryUser) {
    const handle = `@${user.username}`
    if (navigator.clipboard) {
      navigator.clipboard.writeText(handle).catch(() => {})
    }
    showToast('Handle copied', 'success')
  }

  if (selectedUser) {
    return (
      <MemberProfile
        user={selectedUser}
        online={chatList.isMemberOnline(selectedUser.id)}
        photoUrl={memberPhotos.get(selectedUser.id)}
        mutualGroups={mutualGroups}
        onBack={() => setSelectedId(null)}
        onMessage={() => handleMessage(selectedUser)}
        onCopyHandle={() => handleCopyHandle(selectedUser)}
      />
    )
  }

  return (
    <div className="members-pane">
      <div className="members-pane__search">
        <input
          className="search-bar__input"
          type="search"
          placeholder="Search members"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          autoComplete="off"
        />
      </div>
      <div className="members-pane__list">
        {online.length > 0 && (
          <div className="members-pane__section-label">Online · {online.length}</div>
        )}
        {online.map((user) => (
          <MemberRow
            key={user.id}
            user={user}
            online
            selected={false}
            photoUrl={memberPhotos.get(user.id)}
            onClick={() => handleSelectMember(user)}
          />
        ))}
        {offline.length > 0 && (
          <div className="members-pane__section-label">Offline · {offline.length}</div>
        )}
        {offline.map((user) => (
          <MemberRow
            key={user.id}
            user={user}
            online={false}
            selected={false}
            photoUrl={memberPhotos.get(user.id)}
            onClick={() => handleSelectMember(user)}
          />
        ))}
        {filtered.length === 0 && (
          <div className="members-pane__empty">No members found</div>
        )}
      </div>
    </div>
  )
}
