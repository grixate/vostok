import { Suspense, lazy } from 'react'
import { t } from '../../lib/i18n.ts'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { SidebarHeader } from './SidebarHeader.tsx'
import { SidebarChatList } from './SidebarChatList.tsx'
import { BottomTabBar } from './BottomTabBar.tsx'
import type { useDesktop } from '../../hooks/useDesktop.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import type { useCall } from '../../hooks/useCall.ts'
import type { MergedChatSummary } from '../../lib/multi-server.ts'

const MembersPane = lazy(async () => {
  const module = await import('./MembersPane.tsx')
  return { default: module.MembersPane }
})

const CallsTab = lazy(async () => {
  const module = await import('../calls/CallsTab.tsx')
  return { default: module.CallsTab }
})

type SidebarProps = {
  desktop: ReturnType<typeof useDesktop>
  chatList: ReturnType<typeof useChatList>
  activeChat: MergedChatSummary | null
  draftChatIds: Map<string, string>
  call: ReturnType<typeof useCall>
}

export function Sidebar({ desktop, chatList, activeChat, draftChatIds, call }: SidebarProps) {
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
          <SidebarChatList chatList={chatList} activeChat={activeChat} draftChatIds={draftChatIds} />
        </>
      )}
      {sidebarTab === 'calls' && (
        <Suspense
          fallback={
            <div className="empty-state" style={{ flex: 1 }}>
              <span className="message-thread__loading-spinner" />
            </div>
          }
        >
          <CallsTab call={call} />
        </Suspense>
      )}
      {sidebarTab === 'members' && (
        <>
          <div className="sidebar__header">
            <div className="sidebar__title-row">
              <span className="sidebar__title">{t('members')}</span>
            </div>
          </div>
          <Suspense
            fallback={
              <div className="empty-state" style={{ flex: 1 }}>
                <span className="message-thread__loading-spinner" />
              </div>
            }
          >
            <MembersPane chatList={chatList} />
          </Suspense>
        </>
      )}
      {sidebarTab === 'settings' && (
        <div className="sidebar__header">
          <div className="sidebar__title-row">
            <span className="sidebar__title">{t('settings')}</span>
          </div>
        </div>
      )}
      <BottomTabBar
        activeTab={sidebarTab}
        onTabChange={handleTabChange}
        chatUnreadCount={chatList.chatItems.reduce((sum, c) => sum + (c.is_self_chat ? 0 : (c.message_count ?? 0)), 0)}
      />
    </aside>
  )
}
