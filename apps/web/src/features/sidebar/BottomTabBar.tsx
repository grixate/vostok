import {
  ChatsIcon,
  MembersIcon,
  SettingsIcon,
} from '../../icons/index.tsx'
import { t } from '../../lib/i18n.ts'
import type { SidebarTab } from '../../contexts/UIContext.tsx'

type TabDef = {
  id: SidebarTab
  label: string
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  IconActive: React.ComponentType<React.SVGProps<SVGSVGElement>>
}

type BottomTabBarProps = {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
  chatUnreadCount?: number
}

export function BottomTabBar({ activeTab, onTabChange, chatUnreadCount = 0 }: BottomTabBarProps) {
  const tabs: TabDef[] = [
    { id: 'chats', label: t('chats'), Icon: ChatsIcon, IconActive: ChatsIcon },
    { id: 'members', label: t('members'), Icon: MembersIcon, IconActive: MembersIcon },
    { id: 'settings', label: t('settings'), Icon: SettingsIcon, IconActive: SettingsIcon },
  ]

  return (
    <div className="sidebar__bottom-tab-bar">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id
        const IconComponent = isActive ? tab.IconActive : tab.Icon
        return (
          <button
            key={tab.id}
            className={`sidebar__tab-btn${isActive ? ' sidebar__tab-btn--active' : ''}`}
            type="button"
            onClick={() => onTabChange(tab.id)}
            aria-label={tab.label}
          >
            <IconComponent className="sidebar__tab-icon" />
            <span className="sidebar__tab-label">{tab.label}</span>
            {tab.id === 'chats' && chatUnreadCount > 0 && (
              <span className="sidebar__tab-badge">
                {chatUnreadCount > 99 ? '99+' : chatUnreadCount}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
