import {
  ChatsIcon, ChatsFilledIcon,
  MembersIcon, MembersFilledIcon,
  SettingsIcon, SettingsFilledIcon,
} from '../../icons/index.tsx'
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
}

export function BottomTabBar({ activeTab, onTabChange }: BottomTabBarProps) {
  const tabs: TabDef[] = [
    { id: 'chats', label: 'Chats', Icon: ChatsIcon, IconActive: ChatsFilledIcon },
    { id: 'members', label: 'Members', Icon: MembersIcon, IconActive: MembersFilledIcon },
    { id: 'settings', label: 'Settings', Icon: SettingsIcon, IconActive: SettingsFilledIcon },
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
          </button>
        )
      })}
    </div>
  )
}
