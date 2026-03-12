import type { useChatFolders } from '../../hooks/useChatFolders.ts'
import type { ChatSummary } from '../../lib/api.ts'

type FolderBarProps = {
  chatFolders: ReturnType<typeof useChatFolders>
  chatItems: ChatSummary[]
}

export function FolderBar({ chatFolders, chatItems }: FolderBarProps) {
  return (
    <div className="folder-bar">
      {chatFolders.folders.map((folder) => {
        const isActive = folder.id === chatFolders.activeFolderId
        const unreadCount = chatFolders.getUnreadCountForFolder(folder.id, chatItems)

        return (
          <button
            key={folder.id}
            className={isActive ? 'folder-tab folder-tab--active' : 'folder-tab'}
            type="button"
            onClick={() => chatFolders.setActiveFolderId(folder.id)}
          >
            {folder.name}
            {unreadCount > 0 && !isActive ? (
              <span className="folder-tab__badge">{unreadCount}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
