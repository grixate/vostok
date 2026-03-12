import { useUIContext } from '../../contexts/UIContext.tsx'
import { SidebarHeader } from './SidebarHeader.tsx'
import { SidebarChatList } from './SidebarChatList.tsx'
import { BottomTabBar } from './BottomTabBar.tsx'
import { MembersPane } from './MembersPane.tsx'
import type { useDesktop } from '../../hooks/useDesktop.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import type { useChatFolders } from '../../hooks/useChatFolders.ts'
import type { ChatSummary } from '../../lib/api.ts'

type SidebarProps = {
  desktop: ReturnType<typeof useDesktop>
  chatList: ReturnType<typeof useChatList>
  activeChat: ChatSummary | null
  chatFolders: ReturnType<typeof useChatFolders>
  draftChatIds: Set<string>
}

export function Sidebar({ desktop, chatList, activeChat, chatFolders, draftChatIds }: SidebarProps) {
  const { sidebarTab, setSidebarTab, setSettingsOverlayOpen } = useUIContext()

  function handleTabChange(tab: typeof sidebarTab) {
    setSidebarTab(tab)
    setSettingsOverlayOpen(tab === 'settings')
  }

  return (
    <aside className="sidebar">
      {sidebarTab === 'chats' && (
        <>
          <SidebarHeader desktop={desktop} chatList={chatList} />
          <SidebarChatList chatList={chatList} activeChat={activeChat} draftChatIds={draftChatIds} chatFolders={chatFolders} />
        </>
      )}
      {sidebarTab === 'members' && (
        <>
          <div className="sidebar__header">
            <div className="sidebar__title-row">
              <span className="sidebar__title">Members</span>
            </div>
          </div>
          <MembersPane chatList={chatList} />
        </>
      )}
      {sidebarTab === 'settings' && (
        <div className="sidebar__header">
          <div className="sidebar__title-row">
            <span className="sidebar__title">Settings</span>
          </div>
        </div>
      )}
      <BottomTabBar activeTab={sidebarTab} onTabChange={handleTabChange} />
    </aside>
  )
}
