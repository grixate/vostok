import { useState, useEffect, useMemo } from 'react'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { listUsers } from '../../lib/api.ts'
import { peerColor } from '../../utils/avatar-colors.ts'
import { useProfilePhotos } from '../../hooks/useProfilePhotos.ts'
import type { useChatList } from '../../hooks/useChatList.ts'

type MembersPaneProps = {
  chatList: ReturnType<typeof useChatList>
}

export function MembersPane({ chatList }: MembersPaneProps) {
  const { sessionToken } = useAppContext()
  const { setSidebarTab } = useUIContext()
  const [users, setUsers] = useState<{ id: string; username: string }[]>([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!sessionToken) return
    listUsers(sessionToken).then((res) => setUsers(res.users)).catch(() => {})
  }, [sessionToken])

  const filtered = filter
    ? users.filter((u) => u.username.toLowerCase().includes(filter.toLowerCase()))
    : users

  const memberIds = useMemo(() => users.map((u) => u.id), [users])
  const memberPhotos = useProfilePhotos(memberIds, chatList.activeServerUrl)

  function handleSelectUser(username: string) {
    chatList.startDirectChatWith(username)
    setSidebarTab('chats')
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
        {filtered.map((user) => (
          <button
            key={user.id}
            className="members-pane__item"
            type="button"
            onClick={() => handleSelectUser(user.username)}
          >
            <div
              className="members-pane__avatar"
              style={{ background: memberPhotos.get(user.id) ? 'none' : peerColor(user.username) }}
            >
              {memberPhotos.get(user.id)
                ? <img src={memberPhotos.get(user.id)} alt={user.username} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                : user.username.slice(0, 1).toUpperCase()}
            </div>
            <span className="members-pane__username">@{user.username}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <div style={{ padding: '32px 24px', textAlign: 'center', color: 'var(--label2)', fontSize: 14 }}>
            No members found
          </div>
        )}
      </div>
    </div>
  )
}
