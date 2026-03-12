import type { SidebarTab } from '../../contexts/UIContext.tsx'

type BottomTabBarProps = {
  activeTab: SidebarTab
  onTabChange: (tab: SidebarTab) => void
}

export function BottomTabBar({ activeTab, onTabChange }: BottomTabBarProps) {
  const tabs: { id: SidebarTab; label: string; icon: string }[] = [
    { id: 'chats', label: 'Chats', icon: '💬' },
    { id: 'members', label: 'Members', icon: '👥' },
    { id: 'settings', label: 'Settings', icon: '⚙️' },
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
          <span className="sidebar__tab-icon">{tab.icon}</span>
          <span className="sidebar__tab-label">{tab.label}</span>
        </button>
      ))}
    </div>
  )
}
