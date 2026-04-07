import {
  Suspense,
  useDeferredValue,
  useEffect,
  lazy,
  useRef,
  useState
} from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'

import type { AuthSession, Banner, ServerInfo, StoredDevice } from './types.ts'
import { buildDesktopWindowTitle } from './utils/call-helpers.ts'
import { setDefaultApiBaseUrl } from './lib/api.ts'
import { setDefaultRealtimeBaseUrl } from './lib/realtime.ts'
import { normalizeServerUrl } from './lib/multi-server.ts'
import {
  doesAuthSessionMatchServer,
  findServerForAuthSession,
  shouldShowOnboarding
} from './lib/auth-routing.ts'

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
import { useCall } from './hooks/useCall.ts'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.ts'
import { useTheme } from './hooks/useTheme.ts'

import { useDrafts } from './hooks/useDrafts.ts'
import { useTypingIndicator } from './hooks/useTypingIndicator.ts'
import { usePresence } from './hooks/usePresence.ts'
import { useNotifications } from './hooks/useNotifications.ts'
import { useDeepLinks } from './hooks/useDeepLinks.ts'
import { useSettings } from './hooks/useSettings.ts'
import { useServers } from './hooks/useServers.ts'
import { useDownloadManager } from './hooks/useDownloadManager.ts'

import { Sidebar } from './features/sidebar/Sidebar.tsx'
import { ConversationPane } from './features/conversation/ConversationPane.tsx'
import { ToastStack } from './features/overlays/ToastStack.tsx'
import { BackupReminderBanner } from './components/BackupReminderBanner.tsx'

const LoginFlow = lazy(async () => {
  const module = await import('./features/auth/LoginFlow.tsx')
  return { default: module.LoginFlow }
})

import { SettingsPane } from './features/settings/SettingsPane.tsx'
import { ContextMenuOverlay } from './features/overlays/ContextMenuOverlay.tsx'
import { ProfileOverlay } from './features/overlays/ProfileOverlay.tsx'
import { KeyboardShortcutsOverlay } from './features/overlays/KeyboardShortcutsOverlay.tsx'
import { IncomingCallOverlay } from './features/overlays/IncomingCallOverlay.tsx'

const mobilePanelVariants = {
  enter: (d: number) => ({ x: d < 0 ? '-100%' : '100%' }),
  center: { x: 0 },
  exit: (d: number) => ({ x: d > 0 ? '-100%' : '100%' }),
}

function storedDevicesEqual(left: StoredDevice | null, right: StoredDevice | null): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return JSON.stringify(left) === JSON.stringify(right)
}

function authSessionsEqual(left: AuthSession | null, right: AuthSession | null): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return JSON.stringify(left) === JSON.stringify(right)
}

function serverInfosEqual(left: ServerInfo | null, right: ServerInfo | null): boolean {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return false
  }

  return JSON.stringify(left) === JSON.stringify(right)
}

function App() {
  const existingChatActivityRef = useRef<(chatId: string) => void>(() => {})
  const servers = useServers(existingChatActivityRef)
  const [storedDevice, setStoredDevice] = useState<StoredDevice | null>(null)
  const [sessionToken, setSessionToken] = useState<string | null>(null)
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
  const [initialSettingsSection, setInitialSettingsSection] = useState<string | null>(null)

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
    initialSettingsSection, setInitialSettingsSection,
    attachPopoverOpen, setAttachPopoverOpen,
    shortcutsOpen, setShortcutsOpen,
    toasts, showToast,
    sidebarTab, setSidebarTab,
    chatSearchInputRef, chatFilterInputRef, directChatInputRef,
    groupTitleInputRef, draftInputRef, chatButtonRefs
  }

  return (
    <MotionConfig reducedMotion="user">
      <AppContext.Provider value={appContextValue}>
        <ThemeContext.Provider value={themeContextValue}>
          <UIContext.Provider value={uiContextValue}>
            <AppInner
              existingChatActivityRef={existingChatActivityRef}
              servers={servers}
            />
          </UIContext.Provider>
        </ThemeContext.Provider>
      </AppContext.Provider>
    </MotionConfig>
  )
}

function AppInner({
  servers,
  existingChatActivityRef
}: {
  servers: ReturnType<typeof useServers>
  existingChatActivityRef: React.RefObject<(chatId: string) => void>
}) {
  const {
    contextMenuMessage,
    profileOverlayOpen,
    settingsOverlayOpen,
    shortcutsOpen,
    setSettingsOverlayOpen,
    setSidebarTab
  } = useUIContext()
  const { storedDevice, sessionToken, setStoredDevice, setSessionToken } = useAppContext()
  const [selectMessageId, setSelectMessageId] = useState<string | null>(null)
  const [mobilePanel, setMobilePanelRaw] = useState<'sidebar' | 'conversation'>('sidebar')
  const mobileDirRef = useRef<1 | -1>(1)
  const mobileTransitingRef = useRef(false)
  const setMobilePanel = (panel: 'sidebar' | 'conversation') => {
    if (mobileTransitingRef.current) return
    mobileDirRef.current = panel === 'conversation' ? 1 : -1
    mobileTransitingRef.current = true
    setMobilePanelRaw(panel)
    setTimeout(() => { mobileTransitingRef.current = false }, 300)
  }
  const {
    servers: serverRecords,
    activeServer,
    activeServerScope,
    addServer,
    attachAuthSession,
    updateServer,
    logoutServer,
    hasAuthenticatedServer
  } = servers
  const auth = useAuth(activeServer?.url ?? window.location.origin)
  const layout = useViewportLayout()
  const desktop = useDesktop()
  const authMatchesActiveServer = doesAuthSessionMatchServer(
    auth.authSessionServerUrl,
    activeServer?.url ?? null
  )
  // In same-origin (legacy) mode with no multi-server config, skip the
  // multi-server onboarding and go straight to the auth flow.
  const isLegacyMode = servers.servers.length === 0
  const onboarding = isLegacyMode
    ? !auth.authSession
    : shouldShowOnboarding(hasAuthenticatedServer, !!auth.authSession, authMatchesActiveServer)
  const appView = onboarding ? auth.view : 'chat'
  const fallbackAuthToken = authMatchesActiveServer ? auth.authSession?.accessToken ?? null : null
  const currentProfileUsername =
    activeServer?.auth?.user.username ??
    (authMatchesActiveServer ? auth.profileUsername : null)

  const appSettings = useSettings(fallbackAuthToken)

  useEffect(() => {
    const authServerUrl = auth.authSessionServerUrl ? normalizeServerUrl(auth.authSessionServerUrl) : null
    const matchingServer = findServerForAuthSession(serverRecords, auth.authSessionServerUrl)

    if (!auth.authSession || !authServerUrl) {
      return
    }

    if (matchingServer) {
      if (
        authSessionsEqual(matchingServer.auth, auth.authSession) &&
        serverInfosEqual(matchingServer.serverInfo, auth.serverInfo)
      ) {
        return
      }

      attachAuthSession(matchingServer.id, auth.authSession, auth.serverInfo)
      return
    }

    const created = addServer(
      authServerUrl,
      auth.serverInfo?.name ?? 'My Server',
      'var(--accent)'
    )
    attachAuthSession(created.id, auth.authSession, auth.serverInfo)
  }, [
    auth.authSession,
    auth.authSessionServerUrl,
    auth.serverInfo,
    serverRecords,
    addServer,
    attachAuthSession
  ])

  // Sync the active server scope into AppContext and the legacy default
  // API/realtime clients so existing hooks target the selected server.
  useEffect(() => {
    const fallbackBaseUrl = activeServer?.url ?? window.location.origin

    if (!activeServerScope) {
      setDefaultApiBaseUrl(fallbackBaseUrl)
      setDefaultRealtimeBaseUrl(fallbackBaseUrl)

      setSessionToken((prev) => prev === fallbackAuthToken ? prev : fallbackAuthToken)
      setStoredDevice((prev) => prev === null ? prev : null)

      return
    }

    setDefaultApiBaseUrl(activeServerScope.server.url)
    setDefaultRealtimeBaseUrl(activeServerScope.server.url)

    setSessionToken((prev) => prev === activeServerScope.token ? prev : activeServerScope.token)

    const nextStoredDevice = activeServerScope.device ?? null
    setStoredDevice((prev) => storedDevicesEqual(prev, nextStoredDevice) ? prev : nextStoredDevice)

    // storedDevice and sessionToken are excluded from deps — they are only
    // written here via functional updaters that check current state internally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeServer?.url,
    activeServerScope,
    fallbackAuthToken,
    setSessionToken,
    setStoredDevice
  ])

  // Keep the persisted server record in sync with runtime device changes
  // (prekey consumption, device bootstrap).  We use a ref to avoid a dep
  // cycle: effect-253 syncs server→context and this syncs context→server.
  const storedDeviceRef = useRef(storedDevice)
  storedDeviceRef.current = storedDevice

  const activeServerRef = useRef(activeServer)
  activeServerRef.current = activeServer

  useEffect(() => {
    const device = storedDeviceRef.current
    const server = activeServerRef.current

    if (!server || device == null) return
    if (storedDevicesEqual(server.device ?? null, device)) return

    updateServer(server.id, { device })
  }, [storedDevice, updateServer])

  const chatList = useChatList(appView, servers)
  const deferredActiveChatId = useDeferredValue(chatList.activeChatId)
  const activeChatIdRef = useRef<string | null>(deferredActiveChatId)

  useEffect(() => {
    activeChatIdRef.current = deferredActiveChatId
  }, [deferredActiveChatId])

  function setActiveChatId(valueOrUpdater: string | null | ((current: string | null) => string | null)) {
    chatList.setActiveChatId((current) => {
      const next = typeof valueOrUpdater === 'function' ? valueOrUpdater(current) : valueOrUpdater
      if (layout.isMobile && next) {
        setMobilePanel('conversation')
      }
      return next
    })
  }

  const setNewChatUsername = chatList.setNewChatUsername
  const chatListView = {
    ...chatList,
    setActiveChatId,
    setNewChatUsername
  }

  const activeChat =
    chatList.chatItems.find((chat) => chat.id === deferredActiveChatId) ?? chatList.chatItems[0] ?? null

  const groupChat = useGroupChat(
    appView,
    activeChat,
    auth.profileUsername,
    chatList.setChatItems,
    activeServer
      ? {
          id: activeServer.id,
          label: activeServer.label,
          color: activeServer.color,
          url: activeServer.url
        }
      : null
  )
  const chatSessions = useChatSessions(
    appView,
    deferredActiveChatId,
    activeChatIdRef,
    chatList.chatItems
  )
  const messages = useMessages(
    appView,
    deferredActiveChatId,
    activeChatIdRef,
    chatList.chatItems,
    chatList.setChatItems,
    chatSessions.syncChatSessionsFromServer,
    chatSessions.chatSessions,
    currentProfileUsername
  )
  // Wire the ref so chat:activity events on non-active chats trigger a
  // background preview decrypt (shows real text in sidebar instead of
  // "Encrypted message").
  useEffect(() => {
    existingChatActivityRef.current = messages.updateNonActiveChatPreview
  }, [messages.updateNonActiveChatPreview])

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
  const downloadManager = useDownloadManager(
    appSettings.settings.auto_download,
    activeServerScope?.token ?? fallbackAuthToken,
    activeServer?.url ?? window.location.origin,
  )
  const call = useCall(appView, deferredActiveChatId, chatList.activeChatId, chatList.chatItems)

  const drafts = useDrafts(deferredActiveChatId, messages.draft, messages.setDraft, messages.replyTargetMessageId)
  const typingIndicator = useTypingIndicator(activeChat, activeServerScope?.token ?? fallbackAuthToken)
  const presence = usePresence(activeServerScope?.token ?? fallbackAuthToken)

  // Platform integration: notifications and deep links
  useNotifications(
    appView === 'chat',
    messages.messageItems,
    chatList.chatItems,
    deferredActiveChatId,
    appSettings.settings
  )
  useDeepLinks(appView === 'chat', {
    setActiveChatId,
    setSettingsOverlayOpen,
    normalizeChatId(chatId) {
      if (chatId.includes('::')) {
        return chatId
      }

      const matches = chatList.chatItems.filter((chat) => chat.rawId === chatId)
      if (matches.length === 1) {
        return matches[0].id
      }

      if (matches.length === 0 && serverRecords.length === 1 && serverRecords[0]) {
        return `${serverRecords[0].id}::${chatId}`
      }

      return matches[0]?.id ?? chatId
    }
  })

  // Sync profile username into new chat username default
  useEffect(() => {
    const nextDefault = currentProfileUsername ?? ''
    setNewChatUsername((current) => (current === '' ? nextDefault : current))
  }, [currentProfileUsername, setNewChatUsername])

  // Reset call state on forget device
  async function handleForgetDevice() {
    chatSessions.setChatSessions([])
    chatSessions.setRemotePrekeyBundles([])
    chatSessions.setSafetyNumbers([])
    call.resetCallState()
    const currentOrigin = normalizeServerUrl(window.location.origin)
    const isCurrentOriginServer =
      activeServer && normalizeServerUrl(activeServer.url) === currentOrigin

    if (activeServer) {
      logoutServer(activeServer.id)
    }

    setStoredDevice(null)

    if (isCurrentOriginServer) {
      await auth.handleForgetDevice()
      return
    }

    setSessionToken(null)
  }
  const authView = {
    ...auth,
    view: appView,
    authSession: activeServer?.auth ?? (authMatchesActiveServer ? auth.authSession : null),
    serverInfo: activeServer?.serverInfo ?? auth.serverInfo,
    profileUsername: currentProfileUsername,
    username: currentProfileUsername ?? '',
    handleForgetDevice
  }

  // Desktop window title sync
  const desktopWindowTitle = buildDesktopWindowTitle(activeChat?.title ?? null, call.activeCall?.mode ?? null)
  const syncDesktopWindowTitle = desktop.syncDesktopWindowTitle

  useEffect(() => {
    syncDesktopWindowTitle(desktopWindowTitle)
  }, [desktopWindowTitle, syncDesktopWindowTitle])

  const appShellClassName = 'app-shell'

  // Keyboard shortcuts
  useKeyboardShortcuts({
    auth: authView,
    chatList: chatListView,
    activeChat,
    layout,
    desktop,
    messages,
    call,
    desktopWindowTitle
  })

  if (onboarding) {
    return (
      <Suspense
        fallback={
          <div className="auth-shell">
            <span className="auth-spinner" />
          </div>
        }
      >
          <LoginFlow auth={authView} servers={servers} />
      </Suspense>
    )
  }

  return (
    <div className={appShellClassName}>
      {settingsOverlayOpen ? (
        <SettingsPane
          auth={authView}
          chatSessions={chatSessions}
          chatList={chatListView}
          servers={servers}
          settingsHook={appSettings}
          onClose={() => { setSettingsOverlayOpen(false); setSidebarTab('chats') }}
        />
      ) : layout.isMobile ? (
        /* Mobile: animated panel slide */
        <AnimatePresence initial={false} mode="popLayout" custom={mobileDirRef.current}>
          {mobilePanel === 'sidebar' ? (
            <motion.div
              key="sidebar"
              custom={mobileDirRef.current}
              variants={mobilePanelVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'tween', duration: 0.25, ease: [0.2, 0, 0, 1] }}
              style={{ width: '100%', height: '100%' }}
            >
              <Sidebar desktop={desktop} chatList={chatListView} activeChat={activeChat} draftChatIds={drafts.draftChatIds} call={call} />
            </motion.div>
          ) : (
            <motion.div
              key="conversation"
              custom={mobileDirRef.current}
              variants={mobilePanelVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'tween', duration: 0.25, ease: [0.2, 0, 0, 1] }}
              style={{ width: '100%', height: '100%' }}
            >
              <ConversationPane
                activeChat={activeChat}
                groupChat={groupChat}
                call={call}
                messages={messages}
                media={media}
                downloadManager={downloadManager}
                chatList={chatListView}
                drafts={drafts}
                typingIndicator={typingIndicator}
                presence={presence}
                appSettings={appSettings}
                initialSelectedMessageId={selectMessageId}
                onBack={() => setMobilePanel('sidebar')}
              />
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        /* Desktop: side-by-side */
        <>
          <Sidebar desktop={desktop} chatList={chatListView} activeChat={activeChat} draftChatIds={drafts.draftChatIds} call={call} />
          <ConversationPane
            activeChat={activeChat}
            groupChat={groupChat}
            call={call}
            messages={messages}
            media={media}
            downloadManager={downloadManager}
            chatList={chatListView}
            drafts={drafts}
            typingIndicator={typingIndicator}
            presence={presence}
            appSettings={appSettings}
            initialSelectedMessageId={selectMessageId}
          />
        </>
      )}
      {contextMenuMessage ? (
        <ContextMenuOverlay
          messages={messages}
          chatList={chatListView}
          onSelectMessage={(id) => {
            setSelectMessageId(id)
            requestAnimationFrame(() => setSelectMessageId(null))
          }}
        />
      ) : null}
      {profileOverlayOpen ? <ProfileOverlay auth={authView} /> : null}
      {shortcutsOpen ? <KeyboardShortcutsOverlay /> : null}

      <IncomingCallOverlay call={call} onAccepted={() => {
        if (call.activeCallChatId) {
          setActiveChatId(call.activeCallChatId)
        }
      }} />
      <BackupReminderBanner />
      <ToastStack />
    </div>
  )
}

export default App
