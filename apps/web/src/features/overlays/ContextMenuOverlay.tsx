import { useEffect, useRef, useState, useCallback } from 'react'
import { useUIContext } from '../../contexts/UIContext.tsx'
import type { useMessages } from '../../hooks/useMessages.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import {
  ReplySmallIcon,
  EditSmallIcon,
  PinSmallIcon,
  CopySmallIcon,
  DeleteSmallTrashIcon,
} from '../../icons/index.tsx'

type ContextMenuOverlayProps = {
  messages: ReturnType<typeof useMessages>
  chatList: ReturnType<typeof useChatList>
}

type MenuItem = {
  key: string
  label: string
  icon: React.ReactNode
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  action: () => void
}

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥']

export function ContextMenuOverlay({ messages, chatList }: ContextMenuOverlayProps) {
  const {
    contextMenuMessage,
    setContextMenuMessage,
    showToast,
    draftInputRef
  } = useUIContext()

  const [focusedIndex, setFocusedIndex] = useState(-1)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  const close = useCallback(() => {
    setContextMenuMessage(null)
    setFocusedIndex(-1)
  }, [setContextMenuMessage])

  // Build menu items list
  const menuItems: MenuItem[] = []
  if (contextMenuMessage) {
    const msg = contextMenuMessage.message

    menuItems.push({
      key: 'reply',
      label: 'Reply',
      icon: <ReplySmallIcon />,
      action: () => { messages.handleReplyToMessage(msg); draftInputRef.current?.focus(); close() }
    })

    if (msg.side === 'outgoing' && !msg.attachment) {
      menuItems.push({
        key: 'edit',
        label: 'Edit',
        icon: <EditSmallIcon />,
        action: () => { messages.handleStartEditingMessage(msg); draftInputRef.current?.focus(); close() }
      })
    }

    if (!msg.id.startsWith('optimistic-')) {
      menuItems.push({
        key: 'pin',
        label: msg.pinnedAt ? 'Unpin' : 'Pin',
        icon: <PinSmallIcon />,
        action: () => { messages.handleToggleMessagePin(msg, chatList.activeChatId); close() }
      })
    }

    menuItems.push({
      key: 'copy',
      label: 'Copy',
      icon: <CopySmallIcon />,
      action: () => { void navigator.clipboard.writeText(msg.text); close(); showToast('Copied to clipboard') }
    })

    menuItems.push({
      key: 'forward',
      label: 'Forward',
      icon: <ReplySmallIcon />,
      disabled: true,
      action: () => {}
    })

    menuItems.push({
      key: 'select',
      label: 'Select',
      icon: <CopySmallIcon />,
      disabled: true,
      action: () => {}
    })

    if (msg.side === 'outgoing') {
      menuItems.push({
        key: 'delete',
        label: 'Delete',
        icon: <DeleteSmallTrashIcon />,
        danger: true,
        separator: true,
        action: () => { messages.handleDeleteExistingMessage(msg, chatList.activeChatId); close() }
      })
    }
  }

  // Viewport overflow detection — account for reaction strip height (~52px)
  useEffect(() => {
    if (!contextMenuMessage) {
      setPosition(null)
      setFocusedIndex(-1)
      return
    }

    const frame = requestAnimationFrame(() => {
      const menu = menuRef.current
      if (!menu) {
        setPosition({ top: contextMenuMessage.y, left: contextMenuMessage.x })
        return
      }

      const rect = menu.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let top = contextMenuMessage.y
      let left = contextMenuMessage.x

      if (top + rect.height > viewportHeight) {
        top = Math.max(4, contextMenuMessage.y - rect.height)
      }

      if (left + rect.width > viewportWidth) {
        left = Math.max(4, contextMenuMessage.x - rect.width)
      }

      setPosition({ top, left })
    })

    return () => cancelAnimationFrame(frame)
  }, [contextMenuMessage])

  // Keyboard navigation
  useEffect(() => {
    if (!contextMenuMessage) return

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setFocusedIndex((prev) => {
          const next = prev + 1
          return next >= menuItems.length ? 0 : next
        })
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setFocusedIndex((prev) => {
          const next = prev - 1
          return next < 0 ? menuItems.length - 1 : next
        })
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        if (focusedIndex >= 0 && focusedIndex < menuItems.length) {
          const item = menuItems[focusedIndex]
          if (!item.disabled) {
            item.action()
          }
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [contextMenuMessage, focusedIndex, menuItems.length])

  if (!contextMenuMessage) {
    return null
  }

  const displayPosition = position ?? { top: contextMenuMessage.y, left: contextMenuMessage.x }
  const msg = contextMenuMessage.message

  return (
    <>
      {/* Transparent click-away — no blur, just dismiss */}
      <div
        style={{ position: 'fixed', inset: 0, zIndex: 200 }}
        onClick={close}
        onContextMenu={(e) => { e.preventDefault(); close() }}
      />
      <div
        className="msg-context-menu"
        ref={menuRef}
        style={{
          top: displayPosition.top,
          left: displayPosition.left,
          visibility: position ? 'visible' : 'hidden'
        }}
      >
        {/* Quick reactions strip */}
        <div className="msg-context-menu__reactions">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="msg-context-menu__reaction-btn"
              onClick={() => {
                if (!msg.id.startsWith('optimistic-')) {
                  messages.handleToggleReaction(msg.id, chatList.activeChatId, emoji)
                }
                close()
              }}
              title={emoji}
            >
              {emoji}
            </button>
          ))}
        </div>
        <div className="msg-context-menu__sep" />
        {menuItems.map((item, index) => (
          <span key={item.key}>
            {item.separator ? <div className="msg-context-menu__sep" /> : null}
            <button
              type="button"
              className={[
                item.danger ? 'msg-context-menu__danger' : '',
                index === focusedIndex ? 'msg-context-menu__item--focused' : '',
                item.disabled ? 'msg-context-menu__item--disabled' : ''
              ].filter(Boolean).join(' ') || undefined}
              disabled={item.disabled}
              onClick={item.action}
              onMouseEnter={() => setFocusedIndex(index)}
            >
              {item.icon}
              {item.label}
            </button>
          </span>
        ))}
      </div>
    </>
  )
}
