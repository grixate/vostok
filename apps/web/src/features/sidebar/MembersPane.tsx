import { useState, useEffect } from 'react'
import { useAppContext } from '../../contexts/AppContext.tsx'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { listUsers } from '../../lib/api.ts'
import { peerColor } from '../../utils/avatar-colors.ts'
import type { useChatList } from '../../hooks/useChatList.ts'

type MembersPaneProps = {
  chatList: ReturnType<typeof useChatList>
}

export function MembersPane({ chatList }: MembersPaneProps) {
  const { storedDevice } = useAppContext()
  const { setSidebarTab } = useUIContext()
  const [users, setUsers] = useState<{ id: string; username: string }[]>([])
  const [filter, setFilter] = useState('')

  useEffect(() => {
    if (!storedDevice) return
    listUsers(storedDevice.sessionToken).then((res) => setUsers(res.users)).catch(() => {})
  }, [storedDevice])

  const filtered = filter
    ? users.filter((u) => u.username.toLowerCase().includes(filter.toLowerCase()))
    : users

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
              style={{ background: peerColor(user.username) }}
            >
              {user.username.slice(0, 1).toUpperCase()}
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
