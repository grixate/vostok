import { useState } from 'react'
import './telegram-shell.css'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Chat {
  id: number
  name: string
  preview: string
  time: string
  unread: number
  pinned: boolean
  muted: boolean
  verified: boolean
  online: boolean
  story: boolean
  storyNew?: boolean
  premium?: boolean
  sender?: string
  hasOpenButton?: boolean
  avatar: string | null
  avatarColor: string
  avatarInitial: string
}

interface Message {
  id: number
  from: 'me' | 'them'
  text: string
  time: string
  read: boolean
}

type TabId = 'contacts' | 'chats' | 'settings'
type FilterId = 'All' | 'Channels' | 'Bots'

// ─── Mock Data ────────────────────────────────────────────────────────────────

const CHATS: Chat[] = [
  {
    id: 1, name: 'Saved Messages', preview: 'Album', time: 'Fri',
    unread: 0, pinned: true, muted: false, verified: false,
    online: false, story: false,
    avatar: null, avatarColor: '#007AFF', avatarInitial: '🔖',
  },
  {
    id: 2, name: 'Mommy Duck', preview: 'Video Message', time: '1:32 PM',
    unread: 0, pinned: true, muted: false, verified: false,
    online: false, story: false,
    avatar: null, avatarColor: '#CB30E0', avatarInitial: '🌸',
  },
  {
    id: 3, name: 'Dad Duck', preview: 'Video', time: 'Sat',
    unread: 0, pinned: true, muted: false, verified: false,
    online: false, story: false,
    avatar: null, avatarColor: '#FF6B35', avatarInitial: '🦆',
  },
  {
    id: 4, name: 'TravelDuck Paris', preview: 'Album', time: '4:57 PM',
    unread: 3, pinned: false, muted: false, verified: false,
    online: false, story: false, premium: true,
    avatar: null, avatarColor: '#FFB800', avatarInitial: '✈️',
  },
  {
    id: 5, name: 'DuckNews Daily',
    preview: 'Apple has changed the animations and the Liquid Glass effect in iOS 26.2.',
    time: '1:48 PM',
    unread: 32, pinned: false, muted: true, verified: true,
    online: false, story: true, storyNew: false,
    avatar: null, avatarColor: '#00C770', avatarInitial: '📰',
  },
  {
    id: 6, name: 'Sister', preview: '💖 Sticker', time: '10:42 AM',
    unread: 0, pinned: false, muted: false, verified: false,
    online: true, story: true, storyNew: true, premium: true,
    avatar: null, avatarColor: '#FF6B9D', avatarInitial: '⭐',
  },
  {
    id: 7, name: 'New Year Party', preview: 'I think we need more people', time: '10:12 AM',
    unread: 8, pinned: false, muted: false, verified: false,
    online: false, story: false, sender: 'Cool Duck',
    avatar: null, avatarColor: '#4CD964', avatarInitial: '🎉',
  },
  {
    id: 8, name: 'Wallet', preview: 'Welcome to Crypto Wallet!', time: '9:38 AM',
    unread: 0, pinned: false, muted: false, verified: false,
    online: false, story: false, hasOpenButton: true,
    avatar: null, avatarColor: '#007AFF', avatarInitial: '💳',
  },
  {
    id: 9, name: 'Pavel Durov',
    preview: '🏆 Khabib gift auction on Telegram is live.',
    time: 'Sat',
    unread: 0, pinned: false, muted: false, verified: true,
    online: false, story: false, premium: true,
    avatar: null, avatarColor: '#5856D6', avatarInitial: '👑',
  },
  {
    id: 10, name: 'Sleepy Duck', preview: 'Are you sleeping?', time: 'Thu',
    unread: 0, pinned: false, muted: false, verified: false,
    online: false, story: false,
    avatar: null, avatarColor: '#8E8E93', avatarInitial: '😴',
  },
  {
    id: 11, name: 'Telegram',
    preview: 'New login. Dear Crazy Duck, we detected a login into your account from a new device',
    time: 'Wed',
    unread: 0, pinned: false, muted: false, verified: true,
    online: false, story: false,
    avatar: null, avatarColor: '#007AFF', avatarInitial: '✈️',
  },
]

const CHAT_MESSAGES: Record<number, Message[]> = {
  1: [
    { id: 1, from: 'them', text: 'would you like to participate in this project?', time: '9:41 AM', read: true },
    { id: 2, from: 'me', text: 'Wow, of course I want to!', time: '9:41 AM', read: true },
    { id: 3, from: 'them', text: 'Great! Let me send you the details 🎉', time: '9:42 AM', read: false },
  ],
}

const DEFAULT_MESSAGES: Message[] = [
  { id: 1, from: 'them', text: 'Hey there! 👋', time: '9:00 AM', read: true },
  { id: 2, from: 'me', text: 'Hi! How are you?', time: '9:01 AM', read: true },
  { id: 3, from: 'them', text: 'Doing great, thanks for asking!', time: '9:02 AM', read: true },
]

// Figma: filter tabs show unread counts inside ("Channels 3")
const FILTER_COUNTS: Partial<Record<FilterId, number>> = {
  Channels: CHATS.filter((c) => c.verified).length,
}

function getMessages(chatId: number): Message[] {
  return CHAT_MESSAGES[chatId] ?? DEFAULT_MESSAGES
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ComposeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M13 2L16 5L6 15H3V12L13 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M11 4L14 7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M8.5 1.5L10.5 3.5L7 7L7 10L5 8L1.5 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path d="M4 4.5L7.5 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function VerifiedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="6.5" fill="#007AFF" />
      <path d="M4 7L6 9L10 5" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function MutedIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 1.5L9 4.5V7.5L6 10.5L3 7.5V4.5L6 1.5Z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 11L10.5 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

function SendIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 15V5M10 5L6 9M10 5L14 9" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function AttachIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <path d="M18 10L10.5 17.5C8.5 19.5 5.5 19.5 3.5 17.5C1.5 15.5 1.5 12.5 3.5 10.5L11 3C12.5 1.5 15 1.5 16.5 3C18 4.5 18 7 16.5 8.5L9 16C8 17 6.5 17 5.5 16C4.5 15 4.5 13.5 5.5 12.5L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function EmojiIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="8.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="9.5" r="1" fill="currentColor" />
      <circle cx="14" cy="9.5" r="1" fill="currentColor" />
      <path d="M7.5 13C8.5 15 13.5 15 14.5 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function MicIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
      <rect x="8" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 11C4 14.866 7.134 18 11 18C14.866 18 18 14.866 18 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M11 18V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function MoreIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="5" cy="10" r="1.5" fill="currentColor" />
      <circle cx="10" cy="10" r="1.5" fill="currentColor" />
      <circle cx="15" cy="10" r="1.5" fill="currentColor" />
    </svg>
  )
}

function CallIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3.5 3.5C3.5 3.5 5 2.5 6 4L7.5 7C7.5 7 8 8 7 9L6 10C6 10 7 12 8.5 13.5C10 15 12 16 12 16L13 15C14 14 15 14.5 15 14.5L17.5 15.5C19 16 18.5 17.5 18.5 17.5C18.5 17.5 17 19 15.5 18.5C14 18 10.5 16.5 8 14C5.5 11.5 4 8 3.5 6.5C3 5 4.5 3.5 4.5 3.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function VideoIcon() {
  return (
    <svg width="22" height="18" viewBox="0 0 22 18" fill="none" aria-hidden="true">
      <rect x="1" y="2.5" width="14" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M15 7L21 3.5V14.5L15 11" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

function CheckReadIcon() {
  return (
    <svg width="17" height="10" viewBox="0 0 17 10" fill="none" aria-hidden="true">
      <path d="M1 5L4.5 8.5L11 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 5L9.5 8.5L16 1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function ContactsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 20C4 16.686 7.582 14 12 14C16.418 14 20 16.686 20 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ChatsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 4H20C21.1 4 22 4.9 22 6V16C22 17.1 21.1 18 20 18H8L4 22V6C4 4.9 4.9 4 6 4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 2V5M12 19V22M2 12H5M19 12H22M4.22 4.22L6.34 6.34M17.66 17.66L19.78 19.78M4.22 19.78L6.34 17.66M17.66 6.34L19.78 4.22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

interface AvatarProps {
  chat: Chat
  size?: number
}

function Avatar({ chat, size = 54 }: AvatarProps) {
  const isGroup = chat.id === 7
  const fontSize = Math.round(size * 0.38)

  return (
    <div className="tgs-avatar" style={{ width: size, height: size }}>
      {chat.story && (
        <div className={cx('tgs-story-ring', chat.storyNew ? 'tgs-story-ring--new' : 'tgs-story-ring--seen')} />
      )}
      <div
        className={cx(
          'tgs-avatar-face',
          isGroup ? 'tgs-avatar-square' : 'tgs-avatar-round',
          chat.story ? 'tgs-avatar-face--ring' : undefined,
        )}
        style={{ background: chat.avatarColor, fontSize }}
      >
        {chat.avatarInitial}
      </div>
      {chat.online && <div className="tgs-online-dot" />}
    </div>
  )
}

// ─── Unread Badge ─────────────────────────────────────────────────────────────

interface UnreadBadgeProps {
  count: number
  muted: boolean
}

function UnreadBadge({ count, muted }: UnreadBadgeProps) {
  if (!count) return null
  return (
    <div className={cx('tgs-badge', muted ? 'tgs-badge--muted' : 'tgs-badge--active')}>
      {count > 99 ? '99+' : count}
    </div>
  )
}

// ─── Chat Row ─────────────────────────────────────────────────────────────────

interface ChatRowProps {
  chat: Chat
  selected: boolean
  isFirst: boolean
  onClick: () => void
}

function ChatRow({ chat, selected, isFirst, onClick }: ChatRowProps) {
  return (
    <div
      className={cx(
        'tgs-chat-row',
        selected ? 'tgs-chat-row--selected' : undefined,
        chat.pinned && !selected ? 'tgs-chat-row--pinned' : undefined,
      )}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick() }}
    >
      <div className="tgs-chat-row-avatar">
        <Avatar chat={chat} size={62} /> {/* Figma: avatar in chat list = 62px */}
      </div>

      <div className={cx('tgs-chat-row-body', isFirst ? 'tgs-chat-row-body--first' : undefined)}>
        {/* Title row */}
        <div className="tgs-chat-row-title-row">
          <span className="tgs-chat-row-name">{chat.name}</span>
          <div className="tgs-chat-row-name-meta">
            {chat.verified && <VerifiedIcon />}
            {chat.muted && <span className="tgs-chat-row-muted-icon"><MutedIcon /></span>}
            {chat.premium && <div className="tgs-premium-badge">★</div>}
          </div>
          <span className="tgs-chat-row-time">{chat.time}</span>
        </div>

        {/* Preview row */}
        <div className="tgs-chat-row-preview-row">
          <div className="tgs-chat-row-preview-text">
            {chat.sender && <span className="tgs-chat-row-sender">{chat.sender}: </span>}
            <span className="tgs-chat-row-preview">{chat.preview}</span>
          </div>
          <div className="tgs-chat-row-trailing">
            {chat.pinned && !chat.unread && (
              <span className="tgs-pin-icon"><PinIcon /></span>
            )}
            {chat.hasOpenButton && (
              <div className="tgs-open-btn">OPEN</div>
            )}
            {!chat.hasOpenButton && (
              <UnreadBadge count={chat.unread} muted={chat.muted} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Message Bubble ───────────────────────────────────────────────────────────

interface MsgBubbleProps {
  msg: Message
}

function MsgBubble({ msg }: MsgBubbleProps) {
  const isMe = msg.from === 'me'
  return (
    <div className={cx('tgs-msg-row', isMe ? 'tgs-msg-row--me' : 'tgs-msg-row--them')}>
      <div className={cx('tgs-msg-bubble', isMe ? 'tgs-msg-bubble--me' : 'tgs-msg-bubble--them')}>
        <p className="tgs-msg-text">{msg.text}</p>
        <div className="tgs-msg-meta">
          <span className={cx('tgs-msg-time', isMe ? 'tgs-msg-time--me' : 'tgs-msg-time--them')}>
            {msg.time}
          </span>
          {isMe && (
            <span className="tgs-msg-check">
              <CheckReadIcon />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sidebar Panel ────────────────────────────────────────────────────────────

interface SidebarPanelProps {
  activeTab: TabId
  onTabChange: (tab: TabId) => void
}

const SIDEBAR_TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'contacts', label: 'Contacts', icon: <ContactsIcon /> },
  { id: 'chats', label: 'Chats', icon: <ChatsIcon /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon /> },
]

function SidebarPanel({ activeTab, onTabChange }: SidebarPanelProps) {
  return (
    <aside className="tgs-sidebar">
      <div className="tgs-sidebar-user">
        <div className="tgs-sidebar-user-avatar">🦆</div>
      </div>

      <div className="tgs-sidebar-spacer" />

      <nav className="tgs-sidebar-nav">
        {SIDEBAR_TABS.map((tab) => (
          <button
            key={tab.id}
            className={cx('tgs-sidebar-tab', activeTab === tab.id ? 'tgs-sidebar-tab--active' : undefined)}
            onClick={() => onTabChange(tab.id)}
            aria-label={tab.label}
            aria-current={activeTab === tab.id ? 'page' : undefined}
          >
            <span className="tgs-sidebar-tab-icon">{tab.icon}</span>
            <span className="tgs-sidebar-tab-label">{tab.label}</span>
          </button>
        ))}
      </nav>

      <button className="tgs-sidebar-search-btn" aria-label="Search">
        <SearchIcon />
      </button>
    </aside>
  )
}

// ─── Chat List Panel ──────────────────────────────────────────────────────────

interface ChatListPanelProps {
  selectedChat: Chat | null
  onSelectChat: (chat: Chat) => void
}

const FILTERS: FilterId[] = ['All', 'Channels', 'Bots']

function filterChats(chats: Chat[], filter: FilterId): Chat[] {
  if (filter === 'Channels') return chats.filter((c) => c.verified)
  if (filter === 'Bots') return chats.filter((c) => c.hasOpenButton)
  return chats
}

function ChatListPanel({ selectedChat, onSelectChat }: ChatListPanelProps) {
  const [filter, setFilter] = useState<FilterId>('All')
  const [search, setSearch] = useState('')

  const pinnedChats = filterChats(
    CHATS.filter((c) => c.pinned && c.name.toLowerCase().includes(search.toLowerCase())),
    filter,
  )
  const regularChats = filterChats(
    CHATS.filter((c) => !c.pinned && c.name.toLowerCase().includes(search.toLowerCase())),
    filter,
  )

  return (
    <div className="tgs-panel">
      {/* Header */}
      <div className="tgs-panel-header">
        <div className="tgs-panel-title-row">
          <button className="tgs-panel-edit-btn">Edit</button>
          <span className="tgs-panel-title">Chats</span>
          <button className="tgs-panel-compose-btn" aria-label="New message">
            <ComposeIcon />
          </button>
        </div>

        {/* Search */}
        <label className="tgs-search-bar">
          <span className="tgs-search-bar-icon"><SearchIcon /></span>
          <input
            className="tgs-search-bar-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search"
            type="search"
            aria-label="Search chats"
          />
        </label>

        {/* Filter tabs — Figma shows count badge inside inactive tabs */}
        <div className="tgs-filter-bar" role="tablist" aria-label="Chat filters">
          {FILTERS.map((f) => {
            const count = FILTER_COUNTS[f]
            return (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                className={cx('tgs-filter-btn', filter === f ? 'tgs-filter-btn--active' : undefined)}
                onClick={() => setFilter(f)}
              >
                {f}
                {count != null && filter !== f && (
                  <span className="tgs-filter-btn-count">{count}</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Chat list */}
      <div className="tgs-chat-list-scroll">
        {pinnedChats.length > 0 && (
          <section className="tgs-pinned-section">
            {pinnedChats.map((chat, i) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                selected={selectedChat?.id === chat.id}
                isFirst={i === 0}
                onClick={() => onSelectChat(chat)}
              />
            ))}
          </section>
        )}

        {regularChats.map((chat, i) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            selected={selectedChat?.id === chat.id}
            isFirst={i === 0 && pinnedChats.length === 0}
            onClick={() => onSelectChat(chat)}
          />
        ))}
      </div>
    </div>
  )
}

// ─── Conversation Panel ───────────────────────────────────────────────────────

interface ConversationPanelProps {
  chat: Chat | null
}

function ConversationPanel({ chat }: ConversationPanelProps) {
  const [input, setInput] = useState('')

  if (!chat) {
    return (
      <div className="tgs-conv-empty">
        <span className="tgs-conv-empty-icon">💬</span>
        <p className="tgs-conv-empty-text">Select a chat to start messaging</p>
      </div>
    )
  }

  const messages = getMessages(chat.id)
  const hasInput = input.trim().length > 0

  function handleSend() {
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="tgs-conv">
      {/* Header */}
      <div className="tgs-conv-header">
        <div className="tgs-conv-header-left">
          <Avatar chat={chat} size={36} />
          <div className="tgs-conv-header-info">
            <div className="tgs-conv-header-name-row">
              <span className="tgs-conv-header-name">{chat.name}</span>
              {chat.verified && <VerifiedIcon />}
            </div>
            <span className={cx('tgs-conv-header-status', chat.online ? 'tgs-conv-header-status--online' : undefined)}>
              {chat.online ? 'online' : 'last seen recently'}
            </span>
          </div>
        </div>

        <div className="tgs-conv-header-actions">
          <button className="tgs-conv-header-btn" aria-label="Voice call">
            <CallIcon />
          </button>
          <button className="tgs-conv-header-btn" aria-label="Video call">
            <VideoIcon />
          </button>
          <button className="tgs-conv-header-btn" aria-label="More options">
            <MoreIcon />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="tgs-conv-messages">
        <div className="tgs-date-sep">
          <span className="tgs-date-sep-label">Today</span>
        </div>
        {messages.map((msg) => (
          <MsgBubble key={msg.id} msg={msg} />
        ))}
      </div>

      {/* Input bar */}
      <div className="tgs-input-bar">
        <button className="tgs-input-bar-btn" aria-label="Attach file">
          <AttachIcon />
        </button>

        <div className="tgs-input-bar-field">
          <input
            className="tgs-input-bar-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message"
            aria-label="Type a message"
          />
          <button className="tgs-input-bar-btn" aria-label="Emoji">
            <EmojiIcon />
          </button>
        </div>

        {hasInput ? (
          <button className="tgs-input-bar-send" onClick={handleSend} aria-label="Send">
            <SendIcon />
          </button>
        ) : (
          <button className="tgs-input-bar-btn" aria-label="Record voice message">
            <MicIcon />
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Main Shell ───────────────────────────────────────────────────────────────

export default function TelegramShell() {
  const [selectedChat, setSelectedChat] = useState<Chat>(CHATS[3])
  const [activeTab, setActiveTab] = useState<TabId>('chats')

  return (
    <div className="tgs-shell">
      <SidebarPanel activeTab={activeTab} onTabChange={setActiveTab} />
      <ChatListPanel selectedChat={selectedChat} onSelectChat={setSelectedChat} />
      <ConversationPanel chat={selectedChat} />
    </div>
  )
}
