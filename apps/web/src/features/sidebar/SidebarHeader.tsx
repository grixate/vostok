import { t } from '../../lib/i18n.ts'
import { useUIContext } from '../../contexts/UIContext.tsx'
import { Tooltip } from '../../components/Tooltip.tsx'
import { NewMessagePanel } from './NewMessagePanel.tsx'
import { useConnectionStatus } from '../../hooks/useConnectionStatus.ts'
import type { useDesktop } from '../../hooks/useDesktop.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import {
  BackIcon,
  EditIcon,
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
  const dotColor = connectionStatus === 'connected' ? 'var(--green)' : 'var(--danger)'

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
              aria-label={t('minimize')}
              className="desktop-titlebar__button"
              onClick={desktop.handleMinimizeDesktopHostWindow}
              type="button"
            >
              <MinimizeIcon width={12} height={12} />
            </button>
            <button
              aria-label={desktop.desktopWindowMaximized ? t('restore_window') : t('maximize')}
              className="desktop-titlebar__button"
              onClick={desktop.handleToggleDesktopWindowMaximize}
              type="button"
            >
              {desktop.desktopWindowMaximized ? <RestoreIcon width={12} height={12} /> : <MaximizeIcon width={12} height={12} />}
            </button>
            <button
              aria-label={t('close')}
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
            aria-label={t('back')}
            onClick={() => { chatList.setNewMessageMode(false); chatList.setNewChatUsername('') }}
          >
            <BackIcon />
          </button>
          <span className="sidebar__title">{t('new_message')}</span>
        </div>
      ) : (
        <div className="sidebar__title-row">
          <div className="sidebar__title-group">
            <span className="sidebar__title">{t('messages')}</span>
            <span
              className="sidebar__status-dot"
              style={{ background: dotColor }}
              title={connectionStatus}
              aria-label={`Connection: ${connectionStatus}`}
            />
          </div>
          <Tooltip text={t('new_message')}>
            <button
              className="sidebar__compose-btn"
              type="button"
              aria-label={t('new_message')}
              onClick={() => { chatList.setNewMessageMode(true); chatList.setNewChatUsername('') }}
            >
              <EditIcon width={18} height={18} />
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
            placeholder={t('search')}
            ref={chatFilterInputRef}
            type="search"
            value={chatList.chatFilter}
            aria-label={t('search_chats')}
          />
        </label>
      )}
    </div>
  )
}
