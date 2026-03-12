import { ChatCircle, Users, GearSix } from '@phosphor-icons/react'
import type { Icon as PhosphorIcon } from '@phosphor-icons/react'
import type { SidebarTab } from '../../contexts/UIContext.tsx'

type BottomTabBarProps = {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
}

export function BottomTabBar({ activeTab, onTabChange }: BottomTabBarProps) {
  const tabs: { id: SidebarTab; label: string; Icon: PhosphorIcon }[] = [
    { id: 'chats', label: 'Chats', Icon: ChatCircle },
    { id: 'members', label: 'Members', Icon: Users },
    { id: 'settings', label: 'Settings', Icon: GearSix },
  ]

  return (
    <div className="sidebar__bottom-tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={`sidebar__tab-btn${activeTab === tab.id ? ' sidebar__tab-btn--active' : ''}`}
          type="button"
          onClick={() => onTabChange(tab.id)}
          aria-label={tab.label}
        >
          <tab.Icon size={24} weight={activeTab === tab.id ? 'fill' : 'regular'} className="sidebar__tab-icon" />
          <span className="sidebar__tab-label">{tab.label}</span>
        </button>
      ))}
    </div>
  )
}
