import {
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent
} from 'react'
import {
  ChatInfoPanel,
  ChatListItem,
  ConversationHeader,
  MessageBubble
} from '@vostok/ui-chat'

import type { Banner, StoredDevice } from './types.ts'
import { readStoredDevice } from './utils/storage.ts'
import { isEditableTarget } from './utils/desktop-helpers.ts'
import {
  extractFirstHttpUrl,
  formatRelativeTime,
  pickPinnedMessage,
  resolveLinkPreview,
  resolvePinnedPreview,
  resolveReplyPreview
} from './utils/format.ts'
import {
  toAttachmentDescriptor,
  isVoiceNoteAttachment,
  isRoundVideoAttachment
} from './utils/attachment-helpers.ts'
import { buildDesktopWindowTitle, pickDominantRemoteSpeakerEndpointId, pickFeaturedRemoteTrack } from './utils/call-helpers.ts'

import { AppContext } from './contexts/AppContext.tsx'
import { useAuth } from './hooks/useAuth.ts'
import { useViewportLayout } from './hooks/useViewportLayout.ts'
import { useDesktop } from './hooks/useDesktop.ts'
import { useChatList } from './hooks/useChatList.ts'
import { useGroupChat } from './hooks/useGroupChat.ts'
import { useChatSessions } from './hooks/useChatSessions.ts'
import { useMessages } from './hooks/useMessages.ts'
import { useMediaCapture } from './hooks/useMediaCapture.ts'
import { useFederation } from './hooks/useFederation.ts'
import { useCall } from './hooks/useCall.ts'

import { RemoteMembraneTrackPreview } from './components/RemoteMembraneTrackPreview.tsx'
import { VoiceNotePlayer } from './components/VoiceNotePlayer.tsx'
import { RoundVideoPlayer } from './components/RoundVideoPlayer.tsx'

import { isDesktopShell } from './lib/desktop-shell.ts'

function App() {
  const [storedDevice, setStoredDevice] = useState<StoredDevice | null>(() => readStoredDevice())
  const [loading, setLoading] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [contextMenuMessage, setContextMenuMessage] = useState<{ message: import('./lib/message-cache.ts').CachedMessage; x: number; y: number } | null>(null)
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [chatSearchQuery, setChatSearchQuery] = useState('')
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [profileOverlayOpen, setProfileOverlayOpen] = useState(false)
  const [settingsOverlayOpen, setSettingsOverlayOpen] = useState(false)
  const [attachPopoverOpen, setAttachPopoverOpen] = useState(false)
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; tone: string }>>([])

  const chatSearchInputRef = useRef<HTMLInputElement | null>(null)
  const chatFilterInputRef = useRef<HTMLInputElement | null>(null)
  const directChatInputRef = useRef<HTMLInputElement | null>(null)
  const groupTitleInputRef = useRef<HTMLInputElement | null>(null)
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null)
  const chatButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const appContextValue = { storedDevice, setStoredDevice, banner, setBanner, loading, setLoading }

  function showToast(message: string, tone: string = 'info') {
    const id = `toast-${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev, { id, message, tone }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }

  return (
    <AppContext.Provider value={appContextValue}>
      <AppInner
        contextMenuMessage={contextMenuMessage}
        setContextMenuMessage={setContextMenuMessage}
        chatSearchOpen={chatSearchOpen}
        setChatSearchOpen={setChatSearchOpen}
        chatSearchQuery={chatSearchQuery}
        setChatSearchQuery={setChatSearchQuery}
        moreMenuOpen={moreMenuOpen}
        setMoreMenuOpen={setMoreMenuOpen}
        profileOverlayOpen={profileOverlayOpen}
        setProfileOverlayOpen={setProfileOverlayOpen}
        settingsOverlayOpen={settingsOverlayOpen}
        setSettingsOverlayOpen={setSettingsOverlayOpen}
        attachPopoverOpen={attachPopoverOpen}
        setAttachPopoverOpen={setAttachPopoverOpen}
        toasts={toasts}
        showToast={showToast}
        chatSearchInputRef={chatSearchInputRef}
        chatFilterInputRef={chatFilterInputRef}
        directChatInputRef={directChatInputRef}
        groupTitleInputRef={groupTitleInputRef}
        draftInputRef={draftInputRef}
        chatButtonRefs={chatButtonRefs}
      />
    </AppContext.Provider>
  )
}

function AppInner({
  contextMenuMessage,
  setContextMenuMessage,
  chatSearchOpen,
  setChatSearchOpen,
  chatSearchQuery,
  setChatSearchQuery,
  moreMenuOpen,
  setMoreMenuOpen,
  profileOverlayOpen,
  setProfileOverlayOpen,
  settingsOverlayOpen,
  setSettingsOverlayOpen,
  attachPopoverOpen,
  setAttachPopoverOpen,
  toasts,
  showToast,
  chatSearchInputRef,
  chatFilterInputRef,
  directChatInputRef,
  groupTitleInputRef,
  draftInputRef,
  chatButtonRefs
}: {
  contextMenuMessage: { message: import('./lib/message-cache.ts').CachedMessage; x: number; y: number } | null
  setContextMenuMessage: React.Dispatch<React.SetStateAction<{ message: import('./lib/message-cache.ts').CachedMessage; x: number; y: number } | null>>
  chatSearchOpen: boolean
  setChatSearchOpen: React.Dispatch<React.SetStateAction<boolean>>
  chatSearchQuery: string
  setChatSearchQuery: React.Dispatch<React.SetStateAction<string>>
  moreMenuOpen: boolean
  setMoreMenuOpen: React.Dispatch<React.SetStateAction<boolean>>
  profileOverlayOpen: boolean
  setProfileOverlayOpen: React.Dispatch<React.SetStateAction<boolean>>
  settingsOverlayOpen: boolean
  setSettingsOverlayOpen: React.Dispatch<React.SetStateAction<boolean>>
  attachPopoverOpen: boolean
  setAttachPopoverOpen: React.Dispatch<React.SetStateAction<boolean>>
  toasts: Array<{ id: string; message: string; tone: string }>
  showToast: (message: string, tone?: string) => void
  chatSearchInputRef: React.RefObject<HTMLInputElement | null>
  chatFilterInputRef: React.RefObject<HTMLInputElement | null>
  directChatInputRef: React.RefObject<HTMLInputElement | null>
  groupTitleInputRef: React.RefObject<HTMLInputElement | null>
  draftInputRef: React.RefObject<HTMLTextAreaElement | null>
  chatButtonRefs: React.RefObject<Record<string, HTMLButtonElement | null>>
}) {
  const auth = useAuth()
  const layout = useViewportLayout()
  const desktop = useDesktop()

  const chatList = useChatList(auth.view)
  const deferredActiveChatId = useDeferredValue(chatList.activeChatId)
  const activeChatIdRef = useRef<string | null>(deferredActiveChatId)

  useEffect(() => {
    activeChatIdRef.current = deferredActiveChatId
  }, [deferredActiveChatId])

  const activeChat =
    chatList.chatItems.find((chat) => chat.id === deferredActiveChatId) ?? chatList.chatItems[0] ?? null

  const groupChat = useGroupChat(auth.view, activeChat, auth.profileUsername, chatList.setChatItems)
  const chatSessions = useChatSessions(
    auth.view,
    deferredActiveChatId,
    activeChatIdRef,
    chatList.chatItems
  )
  const messages = useMessages(
    auth.view,
    deferredActiveChatId,
    activeChatIdRef,
    chatList.chatItems,
    chatList.setChatItems,
    chatSessions.syncChatSessionsFromServer,
    chatSessions.chatSessions
  )
  const media = useMediaCapture(
    chatList.activeChatId,
    messages.messageItemsRef,
    messages.replaceActiveMessages,
    messages.ingestMessageIntoActiveThread,
    messages.buildEncryptedMessagePayload as Parameters<typeof useMediaCapture>[4],
    messages.queueMessageForOutbox as Parameters<typeof useMediaCapture>[5],
    messages.replyTargetMessageId,
    messages.setReplyTargetMessageId
  )
  const federation = useFederation(auth.view)
  const call = useCall(auth.view, deferredActiveChatId, chatList.activeChatId)

  // Sync profile username into new chat username default
  useEffect(() => {
    const nextDefault = auth.profileUsername ?? ''
    chatList.setNewChatUsername((current) => (current === '' ? nextDefault : current))
  }, [auth.profileUsername])

  // Reset call state on forget device
  const originalForgetDevice = auth.handleForgetDevice
  auth.handleForgetDevice = () => {
    chatSessions.setChatSessions([])
    chatSessions.setRemotePrekeyBundles([])
    chatSessions.setSafetyNumbers([])
    federation.setAdminOverview(null)
    federation.setFederationPeers([])
    federation.setTurnCredentials(null)
    call.resetCallState()
    originalForgetDevice()
  }

  // Desktop window title sync
  const desktopWindowTitle = buildDesktopWindowTitle(activeChat?.title ?? null, call.activeCall?.mode ?? null)

  useEffect(() => {
    desktop.syncDesktopWindowTitle(desktopWindowTitle)
  }, [desktop.desktopShell, desktopWindowTitle])

  // Derived values
  const pinnedMessage = pickPinnedMessage(messages.messageItems)
  const chatMediaItems = messages.messageItems.filter((message) => message.attachment)
  const dominantRemoteEndpointId = pickDominantRemoteSpeakerEndpointId(call.membraneRemoteTracks)
  const featuredRemoteTrack = pickFeaturedRemoteTrack(call.membraneRemoteTracks, dominantRemoteEndpointId)
  const appShellClassName = layout.detailRailVisible ? 'app-shell' : 'app-shell app-shell--detail-hidden'

  // Keyboard shortcuts
  function focusRelativeChat(offset: number) {
    const navigableChats = chatList.visibleChatItems

    if (navigableChats.length === 0) {
      return
    }

    const currentIndex = activeChat
      ? navigableChats.findIndex((chat) => chat.id === activeChat.id)
      : 0
    const safeIndex = currentIndex >= 0 ? currentIndex : 0
    const nextIndex = (safeIndex + offset + navigableChats.length) % navigableChats.length
    const nextChat = navigableChats[nextIndex]

    chatList.setActiveChatId(nextChat.id)

    window.requestAnimationFrame(() => {
      chatButtonRefs.current[nextChat.id]?.focus()
    })
  }

  const handleDesktopShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (auth.view !== 'chat') {
      return
    }

    const { loading: isLoading, setBanner: setB } = { loading: false, setBanner: () => {} }
    void isLoading
    void setB

    const hasModifier = event.metaKey || event.ctrlKey
    const typingTarget = isEditableTarget(event.target)

    if (event.key === 'Escape') {
      setBanner(null)

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }

      return
    }

    if (!typingTarget && !hasModifier && event.key === '/' && activeChat) {
      event.preventDefault()
      draftInputRef.current?.focus()
      return
    }

    if (!typingTarget && !hasModifier && event.altKey) {
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        focusRelativeChat(-1)
        return
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        focusRelativeChat(1)
        return
      }
    }

    if (!hasModifier) {
      return
    }

    if ((event.key === '\\' || event.code === 'Backslash') && !event.shiftKey) {
      event.preventDefault()
      layout.setDetailRailPreferred((current) => !current)
      return
    }

    if (isDesktopShell() && event.shiftKey) {
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault()
        void desktop.handleMinimizeDesktopHostWindow()
        return
      }

      if (event.code === 'Digit0') {
        event.preventDefault()
        void desktop.handleResetDesktopHostWindowFrame()
        return
      }

      if (event.key.toLowerCase() === 'p') {
        event.preventDefault()
        void desktop.handleToggleDesktopAlwaysOnTop()
        return
      }

      if (event.key.toLowerCase() === 'u') {
        event.preventDefault()
        void desktop.handleToggleDesktopFullscreen()
        return
      }

      if (event.key.toLowerCase() === 'd') {
        event.preventDefault()
        void desktop.handleCopyDesktopDiagnostics({
          capturedAt: new Date().toISOString(),
          desktopShell: desktop.desktopShell,
          desktopRuntime: desktop.desktopRuntime,
          windowState: {
            maximized: desktop.desktopWindowMaximized,
            focused: desktop.desktopWindowFocused,
            alwaysOnTop: desktop.desktopWindowAlwaysOnTop,
            fullscreen: desktop.desktopWindowFullscreen
          },
          windowGeometry: desktop.desktopWindowGeometry,
          nativeTitle: desktopWindowTitle,
          layout: {
            detailRailPreferred: layout.detailRailPreferred,
            detailRailVisible: layout.detailRailVisible,
            isDesktopWide: layout.isDesktopWide
          },
          activeContext: {
            activeChatId: activeChat?.id ?? null,
            activeChatTitle: activeChat?.title ?? null,
            activeCallId: call.activeCall?.id ?? null,
            activeCallMode: call.activeCall?.mode ?? null
          }
        })
        return
      }

      if (event.key.toLowerCase() === 'w') {
        event.preventDefault()
        void desktop.handleCloseDesktopHostWindow()
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        void desktop.handleToggleDesktopWindowMaximize()
        return
      }
    }

    if (event.key.toLowerCase() === 'f' && event.shiftKey) {
      event.preventDefault()
      chatFilterInputRef.current?.focus()
      chatFilterInputRef.current?.select()
      return
    }

    if (event.key.toLowerCase() === 'k' && !event.shiftKey) {
      event.preventDefault()
      directChatInputRef.current?.focus()
      directChatInputRef.current?.select()
      return
    }

    if (event.key.toLowerCase() === 'g' && event.shiftKey) {
      event.preventDefault()
      groupTitleInputRef.current?.focus()
      groupTitleInputRef.current?.select()
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      if (messages.draft.trim() !== '' && activeChat && !appContextValue_loading) {
        event.preventDefault()
        void messages.sendDraftMessage(chatList.activeChatId)
      }

      return
    }

    if (event.shiftKey && !appContextValue_loading && activeChat && !call.activeCall) {
      if (event.key.toLowerCase() === 'a') {
        event.preventDefault()
        void call.handleStartCall('voice')
        return
      }

      if (event.key.toLowerCase() === 'v') {
        event.preventDefault()
        void call.handleStartCall('video')
      }
    }
  })

  // We need access to the context loading state in the shortcut handler
  // Since useEffectEvent captures the closure, we read from a ref
  const { storedDevice, loading: appContextValue_loading, setBanner } = { storedDevice: null as StoredDevice | null, loading: false, setBanner: (() => {}) as React.Dispatch<React.SetStateAction<Banner | null>> }
  void storedDevice

  useEffect(() => {
    window.addEventListener('keydown', handleDesktopShortcut)

    return () => {
      window.removeEventListener('keydown', handleDesktopShortcut)
    }
  }, [])

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    await messages.sendDraftMessage(chatList.activeChatId)
  }

  const onboarding = auth.view !== 'chat'

  if (onboarding) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-card__logo">
            <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
              <circle cx="28" cy="28" r="28" fill="var(--accent)" />
              <text x="28" y="34" textAnchor="middle" fill="white" fontSize="24" fontWeight="700">V</text>
            </svg>
          </div>
          <h1 className="auth-card__title">Vostok</h1>
          <p className="auth-card__subtitle">Secure messaging for everyone</p>

          <div className="auth-card__tabs">
            <button
              className={auth.view === 'register' || auth.view === 'welcome' ? 'auth-tab auth-tab--active' : 'auth-tab'}
              type="button"
              onClick={() => auth.setView('register')}
            >
              Register
            </button>
            <button
              className={auth.view === 'login' ? 'auth-tab auth-tab--active' : 'auth-tab'}
              type="button"
              onClick={() => auth.setView('login')}
            >
              Sign In
            </button>
            <button
              className={auth.view === 'link' ? 'auth-tab auth-tab--active' : 'auth-tab'}
              type="button"
              onClick={() => auth.setView('link')}
            >
              Link
            </button>
          </div>

          {/* Banner is accessed from context */}
          {auth.view === 'welcome' || auth.view === 'register' ? (
            <form className="auth-form" onSubmit={auth.handleRegister}>
              <label className="auth-field">
                <span>Username</span>
                <input
                  autoComplete="username"
                  onChange={(event) => auth.setUsername(event.target.value)}
                  placeholder="Choose a username"
                  required
                  value={auth.username}
                />
              </label>

              <label className="auth-field">
                <span>Device name</span>
                <input
                  onChange={(event) => auth.setDeviceName(event.target.value)}
                  placeholder="e.g. Safari on Mac"
                  required
                  value={auth.deviceName}
                />
              </label>

              <button className="primary-action" type="submit">
                Create Account
              </button>
            </form>
          ) : null}

          {auth.view === 'login' ? (
            <div className="auth-form">
              <button
                className="primary-action"
                onClick={auth.handleReauthenticate}
                type="button"
              >
                Sign In
              </button>
            </div>
          ) : null}

          {auth.view === 'link' ? (
            <div className="auth-form">
              <label className="auth-field">
                <span>Pairing code</span>
                <input disabled placeholder="Coming soon" value="" readOnly />
              </label>

              <button className="secondary-action" disabled type="button">
                Link Device
              </button>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return (
    <div className={appShellClassName}>
      <aside className="sidebar">
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
                  {'\u2212'}
                </button>
                <button
                  aria-label={desktop.desktopWindowMaximized ? 'Restore' : 'Maximize'}
                  className="desktop-titlebar__button"
                  onClick={desktop.handleToggleDesktopWindowMaximize}
                  type="button"
                >
                  {desktop.desktopWindowMaximized ? '\u2750' : '\u25A1'}
                </button>
                <button
                  aria-label="Close"
                  className="desktop-titlebar__button"
                  onClick={desktop.handleCloseDesktopHostWindow}
                  type="button"
                >
                  {'\u2715'}
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
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M12 4L5 10L12 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <span className="sidebar__title">New Message</span>
            </div>
          ) : (
            <div className="sidebar__title-row">
              <button
                className="sidebar__hamburger-btn"
                onClick={() => setProfileOverlayOpen((v) => !v)}
                type="button"
                aria-label="Menu"
              >
                <svg width="20" height="16" viewBox="0 0 20 16" fill="none" aria-hidden="true">
                  <path d="M1 2H19M1 8H19M1 14H19" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              <span className="sidebar__title">Chats</span>
              <button
                className="sidebar__compose-btn"
                type="button"
                aria-label="New message"
                onClick={() => { chatList.setNewMessageMode(true); chatList.setNewChatUsername('') }}
              >
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
                  <path d="M13 2L16 5L6 15H3V12L13 2Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
                  <path d="M11 4L14 7" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </button>
            </div>
          )}
          {chatList.newMessageMode ? (
            <form className="new-message-search" onSubmit={chatList.handleCreateDirectChat}>
              <span className="new-message-search__to">To:</span>
              <input
                autoFocus
                className="new-message-search__input"
                onChange={(event) => chatList.setNewChatUsername(event.target.value)}
                placeholder="Username\u2026"
                ref={directChatInputRef}
                value={chatList.newChatUsername}
                aria-label="Search or enter username"
              />
            </form>
          ) : (
            <label className="search-bar">
              <span className="search-bar__icon">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
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
        {chatList.newMessageMode ? (
          <div className="sidebar__list">
            {chatList.chatItems
              .filter((c) => !chatList.newChatUsername || c.title.toLowerCase().includes(chatList.newChatUsername.toLowerCase()))
              .map((chat) => (
                <button
                  key={chat.id}
                  className="chat-list-button"
                  type="button"
                  onClick={() => { chatList.setActiveChatId(chat.id); chatList.setNewMessageMode(false); chatList.setNewChatUsername('') }}
                >
                  <ChatListItem
                    title={chat.title}
                    preview={chat.is_self_chat ? 'Saved Messages' : chat.type === 'group' ? 'Group' : 'Direct message'}
                    timestamp=""
                    avatarColor={chat.is_self_chat ? '#007AFF' : chat.type === 'group' ? '#4CD964' : '#5856D6'}
                    avatarInitial={chat.is_self_chat ? '\uD83D\uDD16' : chat.title.slice(0, 1)}
                  />
                </button>
              ))}
            {chatList.newChatUsername.trim().length > 0 &&
              !chatList.chatItems.some((c) => c.title.toLowerCase() === chatList.newChatUsername.trim().toLowerCase()) ? (
              <button
                className="chat-list-button new-message-create"
                type="button"
                onClick={() => chatList.startDirectChatWith(chatList.newChatUsername.trim())}
              >
                <div
                  className="chat-list-item__avatar"
                  style={{ background: 'var(--accent)', flexShrink: 0 }}
                >
                  {chatList.newChatUsername.trim().slice(0, 1).toUpperCase()}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
                  <strong style={{ fontSize: 15 }}>{chatList.newChatUsername.trim()}</strong>
                  <span style={{ fontSize: 13, color: 'var(--label2)' }}>Start new chat</span>
                </div>
              </button>
            ) : null}
          </div>
        ) : (
          <div className="sidebar__list">
            {chatList.visibleChatItems.length > 0 ? (
              chatList.visibleChatItems.map((chat, index) => (
                <button
                  key={chat.id}
                  className="chat-list-button"
                  onClick={() => chatList.setActiveChatId(chat.id)}
                  ref={(element) => {
                    chatButtonRefs.current[chat.id] = element
                  }}
                  type="button"
                >
                  <ChatListItem
                    title={chat.title}
                    preview={
                      chat.message_count > 0
                        ? `${chat.message_count} encrypted ${chat.message_count === 1 ? 'message' : 'messages'}`
                        : 'No messages yet'
                    }
                    timestamp={formatRelativeTime(chat.latest_message_at)}
                    unreadCount={chat.message_count > 0 ? Math.min(chat.message_count, 9) : undefined}
                    active={chat.id === activeChat?.id}
                    pinned={chat.is_self_chat}
                    avatarColor={chat.is_self_chat ? '#007AFF' : chat.type === 'group' ? '#4CD964' : '#5856D6'}
                    avatarInitial={chat.is_self_chat ? '\uD83D\uDD16' : chat.title.slice(0, 1)}
                    isFirst={index === 0}
                  />
                </button>
              ))
            ) : (
              <div style={{ padding: '48px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>{'\uD83D\uDCAC'}</div>
                <p style={{ fontSize: 15, color: 'var(--label2)', margin: 0 }}>
                  No chats yet
                </p>
                <p style={{ fontSize: 13, color: 'var(--label3)', margin: '4px 0 0' }}>
                  Start a conversation above
                </p>
              </div>
            )}
          </div>
        )}
      </aside>

      <main className="conversation-pane">
        {activeChat ? (
        <ConversationHeader
          title={activeChat.title}
          subtitle={
            activeChat.is_self_chat
              ? 'Saved Messages'
              : activeChat.type === 'group'
                ? `${groupChat.groupMembers.length} members`
                : 'last seen recently'
          }
          avatarColor={activeChat.is_self_chat ? '#007AFF' : activeChat.type === 'group' ? '#4CD964' : '#5856D6'}
          avatarInitial={activeChat.is_self_chat ? '\uD83D\uDD16' : activeChat.title.slice(0, 1)}
          online={!activeChat.is_self_chat && activeChat.type !== 'group'}
          onClickInfo={() => layout.setDetailRailPreferred((v) => !v)}
          actions={(
            <>
              {!activeChat.is_self_chat ? (
                <button className="vostok-icon-button" type="button" aria-label="Voice call" onClick={() => call.handleStartCall('voice')}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M17 14.2V16.5C17 17 16.6 17.4 16.1 17.5C15.7 17.5 15.3 17.5 14.9 17.5C8.3 17.5 3 12.2 3 5.6C3 5.2 3 4.8 3.1 4.4C3.1 3.9 3.5 3.5 4 3.5H6.3C6.7 3.5 7.1 3.8 7.2 4.2C7.3 4.8 7.5 5.3 7.7 5.8C7.8 6.1 7.7 6.4 7.5 6.6L6.5 7.6C7.5 9.4 9.1 11 10.9 12L11.9 11C12.1 10.8 12.4 10.7 12.7 10.8C13.2 11 13.7 11.2 14.3 11.3C14.7 11.4 15 11.8 15 12.2V14.2H17Z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              ) : null}
              <button className="vostok-icon-button" type="button" aria-label="Search" onClick={() => { setChatSearchOpen((v) => !v); setChatSearchQuery('') }}>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="1.5"/><path d="M13 13L17 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
              <div className="dropdown-anchor">
                <button className="vostok-icon-button" type="button" aria-label="More options" onClick={() => setMoreMenuOpen((v) => !v)}>
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="5" r="1.5" fill="currentColor"/><circle cx="10" cy="10" r="1.5" fill="currentColor"/><circle cx="10" cy="15" r="1.5" fill="currentColor"/></svg>
                </button>
                {moreMenuOpen ? (
                  <div className="dropdown-menu" onClick={() => setMoreMenuOpen(false)}>
                    <button className="dropdown-menu__item" type="button" onClick={() => { setChatSearchOpen(true); setChatSearchQuery('') }}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3"/><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                      Search
                    </button>
                    {activeChat?.type === 'group' ? (
                      <button className="dropdown-menu__item" type="button" onClick={() => { /* edit group */ }}>
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11 2L14 5L5 14H2V11L11 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                        Edit
                      </button>
                    ) : null}
                    <button className="dropdown-menu__item" type="button" onClick={() => layout.setDetailRailPreferred((v) => !v)}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M8 5V8M8 10.5V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                      Info
                    </button>
                    <div className="dropdown-menu__sep" />
                    <button className="dropdown-menu__item dropdown-menu__item--danger" type="button">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.3"/><path d="M5.5 5.5L10.5 10.5M10.5 5.5L5.5 10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                      Delete Chat
                    </button>
                  </div>
                ) : null}
              </div>
            </>
          )}
        />
        ) : null}
        {chatSearchOpen ? (
          <div className="chat-search-bar">
            <button className="chat-search-bar__nav" type="button" aria-label="Previous result">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 10L8 6L12 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <button className="chat-search-bar__nav" type="button" aria-label="Next result">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <div className="chat-search-bar__field">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3"/><path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              <input
                className="chat-search-bar__input"
                placeholder="Search"
                ref={chatSearchInputRef}
                value={chatSearchQuery}
                onChange={(e) => setChatSearchQuery(e.target.value)}
                autoFocus
              />
              {chatSearchQuery ? (
                <button className="chat-search-bar__clear" type="button" onClick={() => setChatSearchQuery('')} aria-label="Clear">
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="6" fill="var(--label3)"/><path d="M5 5L9 9M9 5L5 9" stroke="white" strokeWidth="1.2" strokeLinecap="round"/></svg>
                </button>
              ) : null}
            </div>
            <button className="chat-search-bar__close" type="button" onClick={() => setChatSearchOpen(false)} aria-label="Close search">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
            </button>
          </div>
        ) : null}

        <section className="conversation-stage">
          {pinnedMessage && !pinnedMessage.deletedAt ? (
            <div className="pinned-message-banner">
              <strong>{resolvePinnedPreview(pinnedMessage)}</strong>
            </div>
          ) : null}
          {!activeChat ? null : messages.messageItems.length === 0 ? (
            <div className="conversation-stage__empty">
              <p style={{ fontSize: 15, color: 'var(--label2)', margin: 0 }}>No messages here yet</p>
              <p style={{ fontSize: 13, color: 'var(--label3)', margin: '4px 0 0' }}>Send the first message to start the conversation</p>
            </div>
          ) : (
            <div className="message-thread">
              {messages.messageItems.map((message) => {
                const linkUrl = extractFirstHttpUrl(message.text)
                const linkPreview = resolveLinkPreview(
                  message.text,
                  linkUrl ? messages.linkMetadataByUrl[linkUrl] : null
                )
                const attachmentDescriptor =
                  message.attachment?.contentKeyBase64 && message.attachment.ivBase64
                    ? toAttachmentDescriptor(message.attachment)
                    : null

                return (
                <MessageBubble
                  key={message.id}
                  side={message.side}
                  timestamp={formatRelativeTime(message.sentAt)}
                  onContextMenu={(e) => {
                    if (message.side !== 'system' && !message.deletedAt) {
                      e.preventDefault()
                      setContextMenuMessage({ message, x: e.clientX, y: e.clientY })
                    }
                  }}
                >
                  {message.replyToMessageId ? (
                    <span className="message-thread__reply-preview">
                      {resolveReplyPreview(messages.messageItems, message.replyToMessageId)}
                    </span>
                  ) : null}
                  <span>{message.text}</span>
                  {linkPreview ? (
                    <a
                      className="message-thread__link-preview"
                      href={linkPreview.href}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <span className="message-thread__link-domain">{linkPreview.hostname}</span>
                      <strong>{linkPreview.title}</strong>
                      <span>{linkPreview.description || linkPreview.href}</span>
                    </a>
                  ) : null}
                  {message.attachment?.thumbnailDataUrl ? (
                    <img
                      alt={message.attachment.fileName}
                      className={
                        isRoundVideoAttachment(message.attachment)
                          ? 'message-thread__attachment-preview message-thread__attachment-preview--round'
                          : 'message-thread__attachment-preview'
                      }
                      src={message.attachment.thumbnailDataUrl}
                    />
                  ) : null}
                  {message.attachment?.waveform && message.attachment.waveform.length > 0 && message.attachment &&
                  isVoiceNoteAttachment(message.attachment) ? (
                    <span className="message-thread__waveform" aria-label="Voice note waveform">
                      {message.attachment.waveform.map((level, index) => (
                        <span
                          className="message-thread__waveform-bar"
                          key={`${message.id}-waveform-${index}`}
                          style={{ height: `${Math.max(18, Math.round(level * 100))}%` }}
                        />
                      ))}
                    </span>
                  ) : null}
                  {attachmentDescriptor && message.attachment && isVoiceNoteAttachment(message.attachment) ? (
                    <VoiceNotePlayer
                      attachment={attachmentDescriptor}
                      onResolveMediaUrl={media.ensureAttachmentPlaybackUrl}
                    />
                  ) : null}
                  {attachmentDescriptor && message.attachment && isRoundVideoAttachment(message.attachment) ? (
                    <RoundVideoPlayer
                      attachment={attachmentDescriptor}
                      onResolveMediaUrl={media.ensureAttachmentPlaybackUrl}
                    />
                  ) : null}
                  {attachmentDescriptor ? (
                    <button
                      className="secondary-action"
                      onClick={() => media.handleDownloadAttachment(attachmentDescriptor)}
                      type="button"
                    >
                      Download {attachmentDescriptor.fileName}
                    </button>
                  ) : null}
                  {message.reactions && message.reactions.length > 0 ? (
                    <span className="message-thread__reactions">
                      {message.reactions
                        .map((reaction) => `${reaction.reactionKey} ${reaction.count}${reaction.reacted ? '*' : ''}`)
                        .join(' \u2022 ')}
                    </span>
                  ) : null}
                </MessageBubble>
                )
              })}
            </div>
          )}

        </section>

        {activeChat && !media.voiceNoteRecording ? (
          <form className="live-composer" onSubmit={handleSendMessage}>
            <input hidden onChange={media.handleAttachmentPick} ref={media.fileInputRef} type="file" />
            <div className="dropdown-anchor">
              <button className="live-composer__btn" type="button" aria-label="Attach file" onClick={() => setAttachPopoverOpen((v) => !v)}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><path d="M18 10L10.5 17.5C8.5 19.5 5.5 19.5 3.5 17.5C1.5 15.5 1.5 12.5 3.5 10.5L11 3C12.5 1.5 15 1.5 16.5 3C18 4.5 18 7 16.5 8.5L9 16C8 17 6.5 17 5.5 16C4.5 15 4.5 13.5 5.5 12.5L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
              {attachPopoverOpen ? (
                <div className="dropdown-menu dropdown-menu--bottom" onClick={() => setAttachPopoverOpen(false)}>
                  <button className="dropdown-menu__item" type="button" onClick={() => { media.fileInputRef.current?.setAttribute('accept', 'image/*,video/*'); media.fileInputRef.current?.click() }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/><circle cx="5.5" cy="5.5" r="1.5" fill="currentColor"/><path d="M2 11L5.5 7.5L8 10L10 8L14 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Photo or Video
                  </button>
                  <button className="dropdown-menu__item" type="button" onClick={() => { media.fileInputRef.current?.removeAttribute('accept'); media.fileInputRef.current?.click() }}>
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M9 2H4C3.4 2 3 2.4 3 3V13C3 13.6 3.4 14 4 14H12C12.6 14 13 13.6 13 13V6L9 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/><path d="M9 2V6H13" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                    File
                  </button>
                </div>
              ) : null}
            </div>
            <div className="live-composer__field">
              {messages.replyTargetMessageId ? (
                <div className="live-composer__reply">
                  <div className="live-composer__reply-copy">
                    <strong style={{ fontSize: 12, color: 'var(--accent)' }}>{messages.editingMessageId ? 'Editing' : 'Reply'}</strong>
                    <span>{messages.replyTargetMessage ? messages.replyTargetMessage.text : 'Earlier message'}</span>
                  </div>
                  <button className="live-composer__btn live-composer__reply-clear" type="button" onClick={() => messages.setReplyTargetMessageId(null)} aria-label="Cancel reply">{'\u2715'}</button>
                </div>
              ) : null}
              {messages.editingMessageId && !messages.replyTargetMessageId ? (
                <div className="live-composer__reply">
                  <div className="live-composer__reply-copy">
                    <strong style={{ fontSize: 12, color: 'var(--accent)' }}>Editing</strong>
                    <span>{messages.editingTargetMessage ? messages.editingTargetMessage.text : 'Outgoing message'}</span>
                  </div>
                  <button className="live-composer__btn live-composer__reply-clear" type="button" onClick={() => { messages.setEditingMessageId(null); messages.setDraft('') }} aria-label="Cancel edit">{'\u2715'}</button>
                </div>
              ) : null}
              <textarea
                className="live-composer__input"
                onChange={(event) => messages.setDraft(event.target.value)}
                placeholder={messages.editingMessageId ? 'Edit message\u2026' : 'Message'}
                ref={draftInputRef}
                rows={1}
                value={messages.draft}
              />
            </div>
            {messages.draft.trim().length > 0 ? (
              <button className="live-composer__send" type="submit" aria-label="Send">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 15V5M10 5L6 9M10 5L14 9" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
            ) : (
              <button className="live-composer__btn live-composer__mic" type="button" aria-label="Record voice message" onClick={() => void media.handleVoiceNoteToggle()}>
                <svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="8" y="2" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.5"/><path d="M4 11C4 14.866 7.134 18 11 18C14.866 18 18 14.866 18 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><path d="M11 18V21" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            )}
          </form>
        ) : null}
        {activeChat && media.voiceNoteRecording ? (
          <div className="voice-recorder">
            <div className="voice-recorder__indicator" />
            <span className="voice-recorder__duration">
              {String(Math.floor(media.voiceRecordingDuration / 60)).padStart(2, '0')}:{String(media.voiceRecordingDuration % 60).padStart(2, '0')}
            </span>
            <div className="voice-recorder__waves">
              {Array.from({ length: 24 }).map((_, i) => (
                <span key={i} className="voice-recorder__wave-bar" style={{ animationDelay: `${i * 0.05}s` }} />
              ))}
            </div>
            <button className="voice-recorder__cancel" type="button" onClick={() => { media.voiceNoteRecorderRef.current?.stop(); media.cleanupVoiceNoteCapture(); if (media.voiceRecordingTimerRef.current) { clearInterval(media.voiceRecordingTimerRef.current); media.voiceRecordingTimerRef.current = null } media.setVoiceRecordingDuration(0) }}>
              Cancel
            </button>
            <button className="voice-recorder__send" type="button" aria-label="Send voice note" onClick={() => void media.handleVoiceNoteToggle()}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 15V5M10 5L6 9M10 5L14 9" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
          </div>
        ) : null}
      </main>

      <aside className={layout.detailRailVisible ? 'detail-rail' : 'detail-rail detail-rail--hidden'}>
        <ChatInfoPanel
          title={activeChat?.title ?? auth.profileUsername ?? 'User'}
          handle={`@${activeChat?.title?.toLowerCase().replace(/\s+/g, '_') ?? auth.profileUsername ?? 'user'}`}
          avatarColor={activeChat?.is_self_chat ? '#007AFF' : activeChat?.type === 'group' ? '#4CD964' : '#5856D6'}
        />
        {chatMediaItems.length > 0 ? (
          <div className="settings-card">
            <div className="settings-card__header">
              <h3>Media</h3>
            </div>
            <div className="chat-media-gallery">
              {chatMediaItems.slice(-6).reverse().map((message) => (
                <button
                  key={message.id}
                  className="chat-media-gallery__item"
                  disabled={!message.attachment}
                  onClick={() => {
                    if (message.attachment) {
                      void media.handleDownloadAttachment(toAttachmentDescriptor(message.attachment))
                    }
                  }}
                  type="button"
                >
                  {message.attachment?.thumbnailDataUrl ? (
                    <img
                      alt={message.attachment.fileName}
                      className={
                        message.attachment && isRoundVideoAttachment(message.attachment)
                          ? 'chat-media-gallery__image chat-media-gallery__image--round'
                          : 'chat-media-gallery__image'
                      }
                      src={message.attachment.thumbnailDataUrl}
                    />
                  ) : (
                    <span className="chat-media-gallery__fallback">{message.attachment?.fileName}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {activeChat?.type === 'group' ? (
          <div className="settings-card">
            <div className="settings-card__header">
              <h3>Members</h3>
            </div>
            <div className="settings-card__list">
              {groupChat.groupMembers.length > 0 ? (
                groupChat.groupMembers.map((member) => (
                  <div key={member.user_id} className="settings-card__row">
                    <div className="settings-card__row-main">
                      <strong>{member.username}</strong>
                      <span>{member.role}{member.username === auth.profileUsername ? ' \u00b7 you' : ''}</span>
                    </div>
                    {member.username !== auth.profileUsername ? (
                      <div className="settings-card__row-actions">
                        <button className="mini-action" onClick={() => void groupChat.handleRemoveActiveGroupMember(member)} type="button">Remove</button>
                      </div>
                    ) : null}
                  </div>
                ))
              ) : (
                <span className="settings-card__muted">Loading members\u2026</span>
              )}
            </div>
          </div>
        ) : null}
        <div className="settings-card">
          <div className="settings-card__header">
            <h3>Settings</h3>
          </div>
          <div className="settings-card__actions">
            <button className="secondary-action" onClick={auth.handleReauthenticate} type="button">
              Refresh Session
            </button>
            <button className="secondary-action" onClick={() => auth.setView('link')} type="button">
              Link Another Device
            </button>
            <button className="danger-action" onClick={auth.handleForgetDevice} type="button">
              Sign Out
            </button>
          </div>
        </div>
        <div className="settings-card">
          <div className="settings-card__header">
            <h3>Encryption</h3>
          </div>
          {chatSessions.safetyNumbers.length > 0 ? (
            <div className="settings-card__list">
              {chatSessions.safetyNumbers.map((entry) => (
                <div className="settings-card__row" key={entry.peerDeviceId}>
                  <div className="settings-card__row-main">
                    <strong>{entry.label}</strong>
                    <span style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>{entry.fingerprint}</span>
                  </div>
                  <div className="settings-card__row-actions">
                    {!entry.verified ? (
                      <button className="mini-action" disabled={chatSessions.verifyingSafetyDeviceId === entry.peerDeviceId} onClick={() => void chatSessions.handleVerifyPeerSafetyNumber(entry.peerDeviceId, chatList.activeChatId)} type="button">Verify</button>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--green)' }}>Verified</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <span className="settings-card__muted">No safety numbers available</span>
          )}
        </div>
        {call.activeCall ? (
          <div className="settings-card">
            <div className="settings-card__header">
              <h3>Active Call</h3>
            </div>
            <div className="settings-card__actions">
              <button className="danger-action" onClick={call.handleEndCall} type="button">End Call</button>
            </div>
            {featuredRemoteTrack ? (
              <div style={{ padding: '0 16px 16px' }}>
                <RemoteMembraneTrackPreview featured track={featuredRemoteTrack} />
              </div>
            ) : null}
          </div>
        ) : null}
      </aside>

      {/* Right-click context menu on messages */}
      {contextMenuMessage ? (
        <>
          <div className="overlay-backdrop" onClick={() => setContextMenuMessage(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenuMessage(null) }} />
          <div className="msg-context-menu" style={{ top: contextMenuMessage.y, left: contextMenuMessage.x }}>
            <button type="button" onClick={() => { messages.handleReplyToMessage(contextMenuMessage.message); draftInputRef.current?.focus(); setContextMenuMessage(null) }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 4L2 8L6 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 8H10C12.2 8 14 9.8 14 12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
              Reply
            </button>
            {contextMenuMessage.message.side === 'outgoing' && !contextMenuMessage.message.attachment ? (
              <button type="button" onClick={() => { messages.handleStartEditingMessage(contextMenuMessage.message); draftInputRef.current?.focus(); setContextMenuMessage(null) }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M11 2L14 5L5 14H2V11L11 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                Edit
              </button>
            ) : null}
            {!contextMenuMessage.message.id.startsWith('optimistic-') ? (
              <button type="button" onClick={() => { messages.handleToggleMessagePin(contextMenuMessage.message, chatList.activeChatId); setContextMenuMessage(null) }}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M10 2L12.5 4.5L9 8V11L7 9L3 13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M5.5 5.5L9.5 9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                {contextMenuMessage.message.pinnedAt ? 'Unpin' : 'Pin'}
              </button>
            ) : null}
            <button type="button" onClick={() => { void navigator.clipboard.writeText(contextMenuMessage.message.text); setContextMenuMessage(null); showToast('Copied to clipboard') }}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3"/><path d="M11 5V3.5C11 2.7 10.3 2 9.5 2H3.5C2.7 2 2 2.7 2 3.5V9.5C2 10.3 2.7 11 3.5 11H5" stroke="currentColor" strokeWidth="1.3"/></svg>
              Copy
            </button>
            {contextMenuMessage.message.side === 'outgoing' ? (
              <>
                <div className="msg-context-menu__sep" />
                <button type="button" className="msg-context-menu__danger" onClick={() => { messages.handleDeleteExistingMessage(contextMenuMessage.message, chatList.activeChatId); setContextMenuMessage(null) }}>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 4H13M5.5 4V3C5.5 2.4 5.9 2 6.5 2H9.5C10.1 2 10.5 2.4 10.5 3V4M4.5 4V13C4.5 13.6 4.9 14 5.5 14H10.5C11.1 14 11.5 13.6 11.5 13V4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Delete
                </button>
              </>
            ) : null}
          </div>
        </>
      ) : null}

      {/* Profile / Settings overlay (burger menu) */}
      {profileOverlayOpen ? (
        <>
          <div className="overlay-backdrop" onClick={() => setProfileOverlayOpen(false)} />
          <div className="profile-overlay">
            <div className="profile-overlay__header">
              <div className="profile-overlay__avatar" style={{ background: '#5856D6' }}>
                {(auth.profileUsername ?? 'U').slice(0, 1)}
              </div>
              <div className="profile-overlay__info">
                <strong>{auth.profileUsername ?? 'User'}</strong>
                <span>@{auth.profileUsername ?? 'user'}</span>
              </div>
              <button className="profile-overlay__close" type="button" onClick={() => setProfileOverlayOpen(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>
            <div className="profile-overlay__actions">
              <button type="button" onClick={() => { setProfileOverlayOpen(false); setSettingsOverlayOpen(true) }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2L10.5 5.5L14 6L11.5 8.5L12 12L9 10.5L6 12L6.5 8.5L4 6L7.5 5.5L9 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
                Settings
              </button>
              <div className="profile-overlay__sep" />
              <button type="button" className="profile-overlay__danger" onClick={() => { setProfileOverlayOpen(false); auth.handleForgetDevice() }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M6 2H12M3 5H15M13 5L12.5 14C12.5 15.1 11.6 16 10.5 16H7.5C6.4 16 5.5 15.1 5.5 14L5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Sign Out
              </button>
            </div>
          </div>
        </>
      ) : null}

      {/* Settings overlay */}
      {settingsOverlayOpen ? (
        <>
          <div className="overlay-backdrop" onClick={() => setSettingsOverlayOpen(false)} />
          <div className="profile-overlay settings-overlay">
            <div className="profile-overlay__header">
              <span className="settings-overlay__title">Settings</span>
              <button className="profile-overlay__close" type="button" onClick={() => setSettingsOverlayOpen(false)} aria-label="Close">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 4L12 12M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              </button>
            </div>

            <div className="settings-overlay__section">
              <div className="settings-overlay__section-title">Session</div>
              <button className="settings-overlay__row" type="button" onClick={() => { setSettingsOverlayOpen(false); auth.handleReauthenticate() }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M2 9C2 5.1 5.1 2 9 2C12.9 2 16 5.1 16 9C16 12.9 12.9 16 9 16" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M2 9H5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                Refresh Session
              </button>
              <button className="settings-overlay__row" type="button" onClick={() => { setSettingsOverlayOpen(false); auth.setView('link') }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M7 4H4C3 4 2 5 2 6V14C2 15 3 16 4 16H12C13 16 14 15 14 14V11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/><path d="M10 2H16V8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M16 2L8 10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                Link Another Device
              </button>
            </div>

            {chatSessions.safetyNumbers.length > 0 ? (
              <div className="settings-overlay__section">
                <div className="settings-overlay__section-title">Encryption</div>
                {chatSessions.safetyNumbers.map((entry) => (
                  <div className="settings-overlay__row settings-overlay__row--info" key={entry.peerDeviceId}>
                    <div style={{ flex: 1 }}>
                      <strong style={{ fontSize: 13 }}>{entry.label}</strong>
                      <span style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', display: 'block', color: 'var(--label2)', marginTop: 2 }}>{entry.fingerprint}</span>
                    </div>
                    {!entry.verified ? (
                      <button className="mini-action" disabled={chatSessions.verifyingSafetyDeviceId === entry.peerDeviceId} onClick={() => void chatSessions.handleVerifyPeerSafetyNumber(entry.peerDeviceId, chatList.activeChatId)} type="button">Verify</button>
                    ) : (
                      <span style={{ fontSize: 12, color: '#34C759', fontWeight: 600 }}>{'\u2713'} Verified</span>
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="settings-overlay__section">
              <button className="settings-overlay__row settings-overlay__row--danger" type="button" onClick={() => { setSettingsOverlayOpen(false); auth.handleForgetDevice() }}>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M6 2H12M3 5H15M13 5L12.5 14C12.5 15.1 11.6 16 10.5 16H7.5C6.4 16 5.5 15.1 5.5 14L5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                Sign Out
              </button>
            </div>
          </div>
        </>
      ) : null}

      {/* iOS glass toast notifications */}
      {toasts.length > 0 ? (
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast toast--${toast.tone}`}>
              {toast.message}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default App
