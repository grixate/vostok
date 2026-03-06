import type { HTMLAttributes, ReactNode } from 'react'
import { cx } from '@vostok/ui-primitives'

/* ─── ChatListItem ────────────────────────────────────────────────────────── */

export type ChatListItemProps = {
  title: string
  preview: string
  timestamp: string
  unreadCount?: number
  pinned?: boolean
  muted?: boolean
  active?: boolean
  avatarColor?: string
  avatarInitial?: string
  online?: boolean
  isFirst?: boolean
}

export function ChatListItem({
  title,
  preview,
  timestamp,
  unreadCount,
  pinned,
  muted,
  active,
  avatarColor,
  avatarInitial,
  online,
  isFirst
}: ChatListItemProps) {
  return (
    <div
      className={cx(
        'chat-list-item',
        active && 'chat-list-item--active',
        pinned && !active && 'chat-list-item--pinned'
      )}
    >
      <div
        className="chat-list-item__avatar"
        style={{ background: avatarColor ?? 'linear-gradient(135deg, #007AFF, #5856D6)' }}
      >
        {avatarInitial ?? title.slice(0, 1)}
        {online && <div className="chat-list-item__online-dot" />}
      </div>
      <div className={cx('chat-list-item__body', isFirst && 'chat-list-item__body--first')}>
        <div className="chat-list-item__topline">
          <strong>{title}</strong>
          <span>{timestamp}</span>
        </div>
        <div className="chat-list-item__meta">
          <span>{preview}</span>
          <div className="chat-list-item__flags">
            {pinned && !unreadCount && (
              <span className="chat-list-item__flag" aria-label="Pinned">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M8.5 1.5L10.5 3.5L7 7L7 10L5 8L1.5 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  <path d="M4 4.5L7.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </span>
            )}
            {muted && (
              <span className="chat-list-item__flag" aria-label="Muted">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M6 1.5L9 4.5V7.5L6 10.5L3 7.5V4.5L6 1.5Z" stroke="currentColor" strokeWidth="1.2" />
                  <path d="M1.5 11L10.5 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                </svg>
              </span>
            )}
            {unreadCount ? (
              <span className={cx('chat-list-item__badge', muted && 'chat-list-item__badge--muted')}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── ConversationHeader ──────────────────────────────────────────────────── */

type ConversationHeaderProps = {
  title: string
  subtitle: string
  variant?: 'direct' | 'group' | 'channel'
  avatarColor?: string
  avatarInitial?: string
  online?: boolean
  onBack?: () => void
  actions?: ReactNode
}

export function ConversationHeader({
  title,
  subtitle,
  avatarColor,
  avatarInitial,
  online,
  actions
}: ConversationHeaderProps) {
  return (
    <div className="conversation-header">
      <div className="conversation-header__left">
        <button
          className="conversation-header__avatar"
          type="button"
          aria-label={`${title} details`}
          style={{ background: avatarColor ?? 'linear-gradient(135deg, #007AFF, #5856D6)' }}
        >
          {avatarInitial ?? title.slice(0, 1)}
        </button>
        <div className="conversation-header__info">
          <span className="conversation-header__name">{title}</span>
          <span className={cx('conversation-header__status', online && 'conversation-header__status--online')}>
            {subtitle}
          </span>
        </div>
      </div>
      {actions ? (
        <div className="conversation-header__actions">{actions}</div>
      ) : null}
    </div>
  )
}

/* ─── MessageBubble ───────────────────────────────────────────────────────── */

type MessageBubbleProps = HTMLAttributes<HTMLDivElement> & {
  side?: 'incoming' | 'outgoing' | 'system'
  state?: 'sending' | 'delivered' | 'read' | 'failed'
  timestamp?: string
}

export function MessageBubble({
  children,
  className,
  side = 'incoming',
  state = 'read',
  timestamp,
  ...props
}: MessageBubbleProps) {
  return (
    <div className={cx('message-bubble', `message-bubble--${side}`, className)} {...props}>
      <div className="message-bubble__content">
        {children}
        {side !== 'system' ? (
          <div className="message-bubble__state">
            {timestamp && <span>{timestamp}</span>}
            {side === 'outgoing' && state === 'read' && (
              <svg width="17" height="10" viewBox="0 0 17 10" fill="none" aria-hidden="true">
                <path d="M1 5L4.5 8.5L11 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 5L9.5 8.5L16 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {side === 'outgoing' && state === 'delivered' && (
              <svg width="11" height="10" viewBox="0 0 11 10" fill="none" aria-hidden="true">
                <path d="M1 5L4.5 8.5L10 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {state === 'sending' && <span>sending</span>}
            {state === 'failed' && <span style={{ color: '#FF3B30' }}>failed</span>}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* ─── Composer ────────────────────────────────────────────────────────────── */

type ComposerProps = {
  variant?: 'idle' | 'typing' | 'reply'
  placeholder?: string
  value?: string
  onChange?: (value: string) => void
  onSend?: () => void
  replyTo?: string
  onCancelReply?: () => void
  disabled?: boolean
  children?: ReactNode
}

export function Composer({
  variant = 'idle',
  placeholder = 'Message',
  value,
  onChange,
  onSend,
  replyTo,
  onCancelReply,
  disabled,
  children
}: ComposerProps) {
  const hasInput = (value ?? '').trim().length > 0

  return (
    <div className="live-composer">
      <button className="live-composer__btn" type="button" aria-label="Attach file" disabled={disabled}>
        <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
          <path d="M18 10L10.5 17.5C8.5 19.5 5.5 19.5 3.5 17.5C1.5 15.5 1.5 12.5 3.5 10.5L11 3C12.5 1.5 15 1.5 16.5 3C18 4.5 18 7 16.5 8.5L9 16C8 17 6.5 17 5.5 16C4.5 15 4.5 13.5 5.5 12.5L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      <div className="live-composer__field">
        {replyTo && variant === 'reply' ? (
          <div className="live-composer__reply">
            <div className="live-composer__reply-copy">
              <strong style={{ fontSize: 12, color: 'var(--accent)' }}>Reply</strong>
              <span>{replyTo}</span>
            </div>
            {onCancelReply && (
              <button className="live-composer__btn live-composer__reply-clear" type="button" onClick={onCancelReply} aria-label="Cancel reply">
                ✕
              </button>
            )}
          </div>
        ) : null}
        {children ?? (
          <input
            className="live-composer__input"
            value={value}
            onChange={(e) => onChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onSend?.()
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            aria-label="Type a message"
          />
        )}
        <button className="live-composer__btn" type="button" aria-label="Emoji">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="8.5" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="8" cy="9.5" r="1" fill="currentColor" />
            <circle cx="14" cy="9.5" r="1" fill="currentColor" />
            <path d="M7.5 13C8.5 15 13.5 15 14.5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {hasInput ? (
        <button className="live-composer__send" onClick={onSend} type="button" aria-label="Send" disabled={disabled}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M10 15V5M10 5L6 9M10 5L14 9" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      ) : (
        <button className="live-composer__btn" type="button" aria-label="Record voice message" disabled={disabled}>
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
            <rect x="8" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" />
            <path d="M4 11C4 14.866 7.134 18 11 18C14.866 18 18 14.866 18 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <path d="M11 18V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

/* ─── ReactionBar ─────────────────────────────────────────────────────────── */

type ReactionBarProps = {
  reactions: string[]
  onSelect?: (reaction: string) => void
}

export function ReactionBar({ reactions, onSelect }: ReactionBarProps) {
  return (
    <div className="reaction-bar">
      {reactions.map((reaction) => (
        <button
          key={reaction}
          className="reaction-bar__chip"
          type="button"
          onClick={() => onSelect?.(reaction)}
        >
          {reaction}
        </button>
      ))}
    </div>
  )
}

/* ─── ContextMenu ─────────────────────────────────────────────────────────── */

type ContextMenuProps = {
  variant?: 'sender' | 'recipient'
  actions: string[]
}

export function ContextMenu({ variant = 'recipient', actions }: ContextMenuProps) {
  return (
    <div className={cx('context-menu', `context-menu--${variant}`)}>
      {actions.map((action) => (
        <button key={action} className="context-menu__item" type="button">
          {action}
        </button>
      ))}
    </div>
  )
}

/* ─── ChatInfoPanel ───────────────────────────────────────────────────────── */

type ChatInfoPanelProps = {
  title: string
  phone: string
  handle: string
  avatarColor?: string
}

export function ChatInfoPanel({ title, phone, handle, avatarColor }: ChatInfoPanelProps) {
  return (
    <div className="chat-info-panel">
      <div
        className="chat-info-panel__avatar"
        style={{ background: avatarColor ?? 'linear-gradient(135deg, #007AFF, #5856D6)' }}
      >
        {title.slice(0, 1)}
      </div>
      <strong className="chat-info-panel__title">{title}</strong>
      <span className="chat-info-panel__subtitle">{handle}</span>
      <div className="chat-info-panel__stats">
        <div>
          <span className="chat-info-panel__label">Phone</span>
          <span>{phone}</span>
        </div>
        <div>
          <span className="chat-info-panel__label">Media</span>
          <span>0 items</span>
        </div>
      </div>
    </div>
  )
}

/* ─── CallSurface ─────────────────────────────────────────────────────────── */

type CallSurfaceProps = {
  mode: 'incoming' | 'active' | 'minimized'
  flavor: 'voice' | 'video' | 'group'
}

export function CallSurface({ mode, flavor }: CallSurfaceProps) {
  return (
    <div className="call-surface">
      <span className="call-surface__mode">{mode}</span>
      <strong>{flavor} call</strong>
      <span className="call-surface__copy">Connecting...</span>
    </div>
  )
}
