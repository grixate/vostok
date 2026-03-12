import { useUIContext } from '../../contexts/UIContext.tsx'
import { Tooltip } from '../../components/Tooltip.tsx'
import { NewMessagePanel } from './NewMessagePanel.tsx'
import { useConnectionStatus } from '../../hooks/useConnectionStatus.ts'
import type { useDesktop } from '../../hooks/useDesktop.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import {
  BackIcon,
  ComposeIcon,
  SearchIcon,
  MinimizeIcon,
  MaximizeIcon,
  RestoreIcon,
  CloseWindowIcon,
} from '../../icons/index.tsx'

type SidebarHeaderProps = {
  desktop: ReturnType<typeof useDesktop>
  chatList: ReturnType<typeof useChatList>
}

export function SidebarHeader({ desktop, chatList }: SidebarHeaderProps) {
  const { chatFilterInputRef } = useUIContext()
  const connectionStatus = useConnectionStatus()
  const dotColor = { connected: '#34C759', connecting: '#FF9500', disconnected: '#8E8E93', error: '#FF3B30' }[connectionStatus]

  return (
    <div className="sidebar__header">
      {desktop.desktopShell ? (
        <div
          className={
            desktop.desktopWindowFocused === false
              ? 'desktop-titlebar desktop-titlebar--inactive'
              : 'desktop-titlebar'
          }
        >
          <div className="desktop-titlebar__meta" data-tauri-drag-region>
            <strong>{desktop.desktopRuntime?.appName ?? 'Vostok'}</strong>
          </div>
          <div className="desktop-titlebar__actions">
            <button
              aria-label="Minimize"
              className="desktop-titlebar__button"
              onClick={desktop.handleMinimizeDesktopHostWindow}
              type="button"
            >
              <MinimizeIcon width={12} height={12} />
            </button>
            <button
              aria-label={desktop.desktopWindowMaximized ? 'Restore' : 'Maximize'}
              className="desktop-titlebar__button"
              onClick={desktop.handleToggleDesktopWindowMaximize}
              type="button"
            >
              {desktop.desktopWindowMaximized ? <RestoreIcon width={12} height={12} /> : <MaximizeIcon width={12} height={12} />}
            </button>
            <button
              aria-label="Close"
              className="desktop-titlebar__button"
              onClick={desktop.handleCloseDesktopHostWindow}
              type="button"
            >
              <CloseWindowIcon width={12} height={12} />
            </button>
          </div>
        </div>
      ) : null}
      {chatList.newMessageMode ? (
        <div className="sidebar__title-row">
          <button
            className="sidebar__back-btn"
            type="button"
            aria-label="Back"
            onClick={() => { chatList.setNewMessageMode(false); chatList.setNewChatUsername('') }}
          >
            <BackIcon />
          </button>
          <span className="sidebar__title">New Message</span>
        </div>
      ) : (
        <div className="sidebar__title-row">
          <span
            style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, flexShrink: 0, display: 'inline-block' }}
            title={connectionStatus}
            aria-label={`Connection: ${connectionStatus}`}
          />
          <span className="sidebar__title">Chats</span>
          <Tooltip text="New message">
            <button
              className="sidebar__compose-btn"
              type="button"
              aria-label="New message"
              onClick={() => { chatList.setNewMessageMode(true); chatList.setNewChatUsername('') }}
            >
              <ComposeIcon width={18} height={18} />
            </button>
          </Tooltip>
        </div>
      )}
      {chatList.newMessageMode ? (
        <NewMessagePanel chatList={chatList} />
      ) : (
        <label className="search-bar">
          <span className="search-bar__icon">
            <SearchIcon width={16} height={16} />
          </span>
          <input
            className="search-bar__input"
            onChange={(event) => chatList.setChatFilter(event.target.value)}
            placeholder="Search"
            ref={chatFilterInputRef}
            type="search"
            value={chatList.chatFilter}
            aria-label="Search chats"
          />
        </label>
      )}
    </div>
  )
}
