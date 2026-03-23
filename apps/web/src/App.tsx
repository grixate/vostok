import {
  useCallback,
  useDeferredValue,
  useEffect,
  useRef,
  useState
} from 'react'

import type { Banner, StoredDevice } from './types.ts'
import { readStoredDevice, readAuthSession } from './utils/storage.ts'
import { buildDesktopWindowTitle } from './utils/call-helpers.ts'

import { AppContext, useAppContext } from './contexts/AppContext.tsx'
import { ThemeContext } from './contexts/ThemeContext.tsx'
import { UIContext, useUIContext, type ContextMenuState, type Toast, type SidebarTab } from './contexts/UIContext.tsx'
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
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.ts'
import { useTheme } from './hooks/useTheme.ts'
import { useChatFolders } from './hooks/useChatFolders.ts'
import { useDrafts } from './hooks/useDrafts.ts'
import { useTypingIndicator } from './hooks/useTypingIndicator.ts'
import { usePresence } from './hooks/usePresence.ts'
import { useNotifications } from './hooks/useNotifications.ts'
import { useDeepLinks } from './hooks/useDeepLinks.ts'
import { useSettings } from './hooks/useSettings.ts'

import { LoginFlow } from './features/auth/LoginFlow.tsx'
import { Sidebar } from './features/sidebar/Sidebar.tsx'
import { ConversationPane } from './features/conversation/ConversationPane.tsx'
import { ContextMenuOverlay } from './features/overlays/ContextMenuOverlay.tsx'
import { ProfileOverlay } from './features/overlays/ProfileOverlay.tsx'
import { SettingsPane } from './features/settings/SettingsPane.tsx'
import { ToastStack } from './features/overlays/ToastStack.tsx'
import { ConnectionStatusBar } from './features/overlays/ConnectionStatusBar.tsx'
import { KeyboardShortcutsOverlay } from './features/overlays/KeyboardShortcutsOverlay.tsx'

function App() {
  const [storedDevice, setStoredDevice] = useState<StoredDevice | null>(() => readStoredDevice())
  const [sessionToken, setSessionToken] = useState<string | null>(() => readAuthSession()?.accessToken ?? null)
  const [loading, setLoading] = useState(false)
  const [banner, setBanner] = useState<Banner | null>(null)
  const [contextMenuMessage, setContextMenuMessage] = useState<ContextMenuState | null>(null)
  const [chatSearchOpen, setChatSearchOpen] = useState(false)
  const [chatSearchQuery, setChatSearchQuery] = useState('')
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [profileOverlayOpen, setProfileOverlayOpen] = useState(false)
  const [settingsOverlayOpen, setSettingsOverlayOpen] = useState(false)
  const [attachPopoverOpen, setAttachPopoverOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chats')

  const chatSearchInputRef = useRef<HTMLInputElement | null>(null)
  const chatFilterInputRef = useRef<HTMLInputElement | null>(null)
  const directChatInputRef = useRef<HTMLInputElement | null>(null)
  const groupTitleInputRef = useRef<HTMLInputElement | null>(null)
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null)
  const chatButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  const appContextValue = { storedDevice, setStoredDevice, sessionToken, setSessionToken, banner, setBanner, loading, setLoading }
  const themeContextValue = useTheme()

  function showToast(message: string, tone: string = 'info') {
    const id = `toast-${Date.now()}-${Math.random()}`
    setToasts((prev) => [...prev, { id, message, tone }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }

  const uiContextValue = {
    contextMenuMessage, setContextMenuMessage,
    chatSearchOpen, setChatSearchOpen,
    chatSearchQuery, setChatSearchQuery,
    moreMenuOpen, setMoreMenuOpen,
    profileOverlayOpen, setProfileOverlayOpen,
    settingsOverlayOpen, setSettingsOverlayOpen,
    attachPopoverOpen, setAttachPopoverOpen,
    shortcutsOpen, setShortcutsOpen,
    toasts, showToast,
    sidebarTab, setSidebarTab,
    chatSearchInputRef, chatFilterInputRef, directChatInputRef,
    groupTitleInputRef, draftInputRef, chatButtonRefs
  }

  return (
    <AppContext.Provider value={appContextValue}>
      <ThemeContext.Provider value={themeContextValue}>
        <UIContext.Provider value={uiContextValue}>
          <AppInner />
        </UIContext.Provider>
      </ThemeContext.Provider>
    </AppContext.Provider>
  )
}

function AppInner() {
  const { settingsOverlayOpen, setSettingsOverlayOpen, setSidebarTab } = useUIContext()
  const { setSessionToken } = useAppContext()
  const [selectMessageId, setSelectMessageId] = useState<string | null>(null)
  const [mobilePanel, setMobilePanel] = useState<'sidebar' | 'conversation'>('sidebar')
  const auth = useAuth()
  const layout = useViewportLayout()
  const desktop = useDesktop()

  const appSettings = useSettings(auth.authSession?.accessToken ?? null)

  // Sync JWT access token into AppContext so all hooks can use it
  useEffect(() => {
    setSessionToken(auth.authSession?.accessToken ?? null)
  }, [auth.authSession?.accessToken, setSessionToken])

  // Ref-based callback so useChatList (called first) can notify useMessages
  // (called later) about chat:activity events on non-active, existing chats.
  const existingChatActivityRef = useRef<(chatId: string) => void>(() => {})
  const handleExistingChatActivity = useCallback((chatId: string) => {
    existingChatActivityRef.current(chatId)
  }, [])

  const chatList = useChatList(auth.view, {
    onExistingChatActivity: handleExistingChatActivity
  })
  const deferredActiveChatId = useDeferredValue(chatList.activeChatId)
  const activeChatIdRef = useRef<string | null>(deferredActiveChatId)

  useEffect(() => {
    activeChatIdRef.current = deferredActiveChatId
  }, [deferredActiveChatId])

  // In mobile mode, switch to conversation panel when user selects a chat
  // (skip the initial mount — only react to changes after first render)
  const initialMobileChatRef = useRef(true)
  useEffect(() => {
    if (initialMobileChatRef.current) {
      initialMobileChatRef.current = false
      return
    }
    if (layout.isMobile && chatList.activeChatId) {
      setMobilePanel('conversation')
    }
  }, [chatList.activeChatId, layout.isMobile])

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
    chatSessions.chatSessions,
    auth.profileUsername
  )
  // Wire the ref so chat:activity events on non-active chats trigger a
  // background preview decrypt (shows real text in sidebar instead of
  // "Encrypted message").
  existingChatActivityRef.current = messages.updateNonActiveChatPreview

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
  const chatFolders = useChatFolders()
  const drafts = useDrafts(deferredActiveChatId, messages.draft, messages.setDraft, messages.replyTargetMessageId)
  const typingIndicator = useTypingIndicator(activeChat, auth.authSession?.accessToken)
  const presence = usePresence(auth.authSession?.accessToken ?? null)

  // Platform integration: notifications and deep links
  const _notifications = useNotifications(
    auth.view === 'chat',
    messages.messageItems,
    chatList.chatItems,
    deferredActiveChatId
  )
  useDeepLinks(auth.view === 'chat', {
    setActiveChatId: chatList.setActiveChatId,
    setSettingsOverlayOpen
  })

  // Sync profile username into new chat username default
  useEffect(() => {
    const nextDefault = auth.profileUsername ?? ''
    chatList.setNewChatUsername((current) => (current === '' ? nextDefault : current))
  }, [auth.profileUsername])

  // Reset call state on forget device
  const originalForgetDevice = auth.handleForgetDevice
  auth.handleForgetDevice = async () => {
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

  const appShellClassName = 'app-shell'

  // Keyboard shortcuts
  useKeyboardShortcuts({
    auth,
    chatList,
    activeChat,
    layout,
    desktop,
    messages,
    call,
    desktopWindowTitle
  })

  const onboarding = auth.view !== 'chat'

  if (onboarding) {
    return <LoginFlow auth={auth} />
  }

  return (
    <div className={appShellClassName}>
      {settingsOverlayOpen ? (
        <SettingsPane
          auth={auth}
          chatSessions={chatSessions}
          chatList={chatList}
          onClose={() => { setSettingsOverlayOpen(false); setSidebarTab('chats') }}
        />
      ) : layout.isMobile ? (
        /* Mobile: single-panel — show sidebar OR conversation */
        mobilePanel === 'sidebar' ? (
          <Sidebar desktop={desktop} chatList={chatList} activeChat={activeChat} chatFolders={chatFolders} draftChatIds={drafts.draftChatIds} presence={presence} />
        ) : (
          <ConversationPane
            activeChat={activeChat}
            groupChat={groupChat}
            call={call}
            layout={layout}
            messages={messages}
            media={media}
            chatList={chatList}
            drafts={drafts}
            typingIndicator={typingIndicator}
            presence={presence}
            appSettings={appSettings}
            initialSelectedMessageId={selectMessageId}
            onBack={() => setMobilePanel('sidebar')}
          />
        )
      ) : (
        /* Desktop: side-by-side */
        <>
          <Sidebar desktop={desktop} chatList={chatList} activeChat={activeChat} chatFolders={chatFolders} draftChatIds={drafts.draftChatIds} presence={presence} />
          <ConversationPane
            activeChat={activeChat}
            groupChat={groupChat}
            call={call}
            layout={layout}
            messages={messages}
            media={media}
            chatList={chatList}
            drafts={drafts}
            typingIndicator={typingIndicator}
            presence={presence}
            appSettings={appSettings}
            initialSelectedMessageId={selectMessageId}
          />
        </>
      )}
      <ContextMenuOverlay messages={messages} chatList={chatList} onSelectMessage={(id) => { setSelectMessageId(id); requestAnimationFrame(() => setSelectMessageId(null)) }} />
      <ProfileOverlay auth={auth} />
      <KeyboardShortcutsOverlay />
      <ConnectionStatusBar />
      <ToastStack />
    </div>
  )
}

export default App
