import type { HTMLAttributes } from 'react'
import { GlassSurface, IconButton, LabelPill, StatusDot, cx } from '@vostok/ui-primitives'

export type ChatListItemProps = {
  title: string
  preview: string
  timestamp: string
  unreadCount?: number
  pinned?: boolean
  muted?: boolean
  active?: boolean
}

export function ChatListItem({
  title,
  preview,
  timestamp,
  unreadCount,
  pinned,
  muted,
  active
}: ChatListItemProps) {
  return (
    <div className={cx('chat-list-item', active && 'chat-list-item--active')}>
      <div className="chat-list-item__avatar" aria-hidden="true">
        {title.slice(0, 1)}
      </div>
      <div className="chat-list-item__body">
        <div className="chat-list-item__topline">
          <strong>{title}</strong>
          <span>{timestamp}</span>
        </div>
        <div className="chat-list-item__meta">
          <span>{preview}</span>
          <div className="chat-list-item__flags">
            {pinned ? <span className="chat-list-item__flag">PIN</span> : null}
            {muted ? <span className="chat-list-item__flag">MUTE</span> : null}
            {unreadCount ? <span className="chat-list-item__badge">{unreadCount}</span> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

type ConversationHeaderProps = {
  title: string
  subtitle: string
  variant?: 'direct' | 'group' | 'channel'
}

export function ConversationHeader({
  title,
  subtitle,
  variant = 'direct'
}: ConversationHeaderProps) {
  const eyebrow = variant === 'channel' ? 'Broadcast' : undefined

  return (
    <div className="conversation-header">
      <IconButton label="Back" />
      <LabelPill className="conversation-header__center" eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <button className="conversation-header__avatar" type="button" aria-label={`${title} details`}>
        <StatusDot />
        <span>{title.slice(0, 1)}</span>
      </button>
    </div>
  )
}

type MessageBubbleProps = HTMLAttributes<HTMLDivElement> & {
  side?: 'incoming' | 'outgoing' | 'system'
  state?: 'sending' | 'delivered' | 'read' | 'failed'
}

export function MessageBubble({
  children,
  className,
  side = 'incoming',
  state = 'read',
  ...props
}: MessageBubbleProps) {
  return (
    <div className={cx('message-bubble', `message-bubble--${side}`, className)} {...props}>
      <div className="message-bubble__content">{children}</div>
      {side === 'system' ? null : <span className="message-bubble__state">{state}</span>}
    </div>
  )
}

type ComposerProps = {
  variant?: 'idle' | 'typing' | 'reply'
  placeholder?: string
}

export function Composer({ variant = 'idle', placeholder = 'Message' }: ComposerProps) {
  return (
    <div className={cx('composer', `composer--${variant}`)}>
      <IconButton className="composer__icon" label="Attach" />
      <GlassSurface className="composer__field">
        {variant === 'reply' ? (
          <div className="composer__reply">
            <span className="composer__reply-label">Replying to grisha</span>
            <span className="composer__reply-copy">Pinned draft summary</span>
          </div>
        ) : null}
        <div className="composer__input-row">
          <span className="composer__cursor" aria-hidden="true" />
          <span className="composer__placeholder">{placeholder}</span>
          <button className="composer__field-action" type="button">
            Tone
          </button>
        </div>
      </GlassSurface>
      <IconButton className="composer__icon" label={variant === 'typing' ? 'Send' : 'Mic'} />
    </div>
  )
}

type ReactionBarProps = {
  reactions: string[]
  onSelect?: (reaction: string) => void
}

export function ReactionBar({ reactions, onSelect }: ReactionBarProps) {
  return (
    <GlassSurface className="reaction-bar">
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
    </GlassSurface>
  )
}

type ContextMenuProps = {
  variant?: 'sender' | 'recipient'
  actions: string[]
}

export function ContextMenu({ variant = 'recipient', actions }: ContextMenuProps) {
  return (
    <GlassSurface className={cx('context-menu', `context-menu--${variant}`)}>
      {actions.map((action) => (
        <button key={action} className="context-menu__item" type="button">
          {action}
        </button>
      ))}
    </GlassSurface>
  )
}

type ChatInfoPanelProps = {
  title: string
  phone: string
  handle: string
}

export function ChatInfoPanel({ title, phone, handle }: ChatInfoPanelProps) {
  return (
    <GlassSurface className="chat-info-panel">
      <div className="chat-info-panel__avatar">{title.slice(0, 1)}</div>
      <strong className="chat-info-panel__title">{title}</strong>
      <span className="chat-info-panel__subtitle">{handle}</span>
      <div className="chat-info-panel__stats">
        <div>
          <span className="chat-info-panel__label">Phone</span>
          <span>{phone}</span>
        </div>
        <div>
          <span className="chat-info-panel__label">Media</span>
          <span>24 items</span>
        </div>
      </div>
    </GlassSurface>
  )
}

type CallSurfaceProps = {
  mode: 'incoming' | 'active' | 'minimized'
  flavor: 'voice' | 'video' | 'group'
}

export function CallSurface({ mode, flavor }: CallSurfaceProps) {
  return (
    <GlassSurface className="call-surface" tone="muted">
      <span className="call-surface__mode">{mode}</span>
      <strong>{flavor} call</strong>
      <span className="call-surface__copy">Shared contract ready for the RTC stage.</span>
    </GlassSurface>
  )
}
