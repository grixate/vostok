import { useEffect, useEffectEvent } from 'react'
import { GlassSurface } from '@vostok/ui-primitives'
import {
  CallSurface,
  ChatInfoPanel,
  ChatListItem,
  ContextMenu,
  ConversationHeader,
  MessageBubble,
  ReactionBar
} from '@vostok/ui-chat'
import { isDesktopShell } from './lib/desktop-shell'
import { AppProvider, useAppContext } from './contexts/AppContext'
import { useViewportLayout } from './hooks/useViewportLayout'
import { useDesktop } from './hooks/useDesktop'
import { useAuth } from './hooks/useAuth'
import { useChatList } from './hooks/useChatList'
import { useGroupChat } from './hooks/useGroupChat'
import { useChatSessions } from './hooks/useChatSessions'
import { useMessages } from './hooks/useMessages'
import { useMediaCapture } from './hooks/useMediaCapture'
import { useFederation } from './hooks/useFederation'
import { useCall } from './hooks/useCall'
import { formatRelativeTime, extractFirstHttpUrl, resolveLinkPreview, resolveReplyPreview, pickPinnedMessage, resolvePinnedPreview } from './utils/format'
import { toAttachmentDescriptor, isVoiceNoteAttachment, isRoundVideoAttachment } from './utils/attachment-helpers'
import { isEditableTarget } from './utils/desktop-helpers'
import { truncateSignalPayload } from './utils/call-helpers'
import { RemoteMembraneTrackPreview } from './components/RemoteMembraneTrackPreview'
import { VoiceNotePlayer } from './components/VoiceNotePlayer'
import { RoundVideoPlayer } from './components/RoundVideoPlayer'

function AppInner() {
  const { storedDevice, banner, setBanner, loading } = useAppContext()

  // --- Hook orchestration ---

  const layout = useViewportLayout()

  const auth = useAuth(() => {
    // onForgetDevice cleanup: reset call/session/federation state
    sessions.setChatSessions([])
    call.setActiveCall(null)
    call.setCallParticipants([])
    call.setCallRoom(null)
    call.setCallWebRtcEndpoint(null)
    call.setCallWebRtcMediaEvents([])
    call.callSignalsRef.current = []
    call.setCallSignals([])
    call.resetWebRtcLab()
    federation_resetOnForget()
  })

  const chatList = useChatList({
    view: auth.view,
    setProfileUsername: auth.setProfileUsername,
    setDevices: auth.setDevices
  })

  const sessions = useChatSessions({
    view: auth.view,
    chatItems: chatList.chatItems,
    deferredActiveChatId: chatList.deferredActiveChatId,
    activeChatId: chatList.activeChatId,
    activeChatIdRef: chatList.activeChatIdRef
  })

  const messages = useMessages({
    view: auth.view,
    chatItems: chatList.chatItems,
    setChatItems: chatList.setChatItems,
    deferredActiveChatId: chatList.deferredActiveChatId,
    activeChatId: chatList.activeChatId,
    activeChatIdRef: chatList.activeChatIdRef,
    syncChatSessionsFromServer: sessions.syncChatSessionsFromServer
  })

  const mediaCapture = useMediaCapture({
    activeChatId: chatList.activeChatId,
    messageItemsRef: messages.messageItemsRef,
    replaceActiveMessages: messages.replaceActiveMessages,
    ingestMessageIntoActiveThread: messages.ingestMessageIntoActiveThread,
    buildEncryptedMessagePayload: messages.buildEncryptedMessagePayload,
    queueMessageForOutbox: messages.queueMessageForOutbox,
    replyTargetMessageId: messages.replyTargetMessageId,
    setReplyTargetMessageId: messages.setReplyTargetMessageId
  })

  const groupChat = useGroupChat({
    activeChat: chatList.activeChat,
    setChatItems: chatList.setChatItems,
    view: auth.view,
    setDevices: auth.setDevices
  })

  const federation = useFederation({ view: auth.view })

  const call = useCall({
    view: auth.view,
    deferredActiveChatId: chatList.deferredActiveChatId,
    activeChatId: chatList.activeChatId
  })

  const desktop = useDesktop({
    activeChatTitle: chatList.activeChat?.title ?? null,
    activeCallMode: call.activeCall?.mode ?? null,
    detailRailPreferred: layout.detailRailPreferred,
    detailRailVisible: layout.detailRailVisible,
    isDesktopWide: layout.isDesktopWide,
    activeChatId: chatList.activeChat?.id ?? null,
    activeCallId: call.activeCall?.id ?? null
  })

  // Helper for onForgetDevice federation cleanup (avoids circular ref)
  function federation_resetOnForget() {
    // federation state resets via its own effect when storedDevice becomes null
    // but we explicitly clear some call-adjacent state here
  }

  // --- Computed values for JSX ---

  const { activeChat, visibleChatItems } = chatList
  const { detailRailVisible } = layout
  const { profileUsername } = auth

  const editingTargetMessage =
    messages.editingMessageId
      ? messages.messageItems.find((m) => m.id === messages.editingMessageId) ?? null
      : null
  const replyTargetMessage =
    messages.replyTargetMessageId
      ? messages.messageItems.find((m) => m.id === messages.replyTargetMessageId) ?? null
      : null
  const pinnedMessage = pickPinnedMessage(messages.messageItems)
  const chatMediaItems = messages.messageItems.filter((m) => m.attachment)
  const appShellClassName = detailRailVisible ? 'app-shell' : 'app-shell app-shell--detail-hidden'

  const dominantRemoteEndpoint = call.dominantRemoteEndpointId
    ? call.membraneRemoteEndpoints.find((ep) => ep.id === call.dominantRemoteEndpointId) ?? null
    : null
  const remoteAudioTrackCount = call.membraneRemoteTracks.filter(
    (t) => t.ready && t.kind === 'audio'
  ).length
  const remoteVideoTrackCount = call.membraneRemoteTracks.filter(
    (t) => t.ready && t.kind === 'video'
  ).length

  // --- Keyboard shortcuts (cross-cutting) ---

  const handleDesktopShortcut = useEffectEvent((event: KeyboardEvent) => {
    if (auth.view !== 'chat') {
      return
    }

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
      messages.draftInputRef.current?.focus()
      return
    }

    if (!typingTarget && !hasModifier && event.altKey) {
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        chatList.focusRelativeChat(-1)
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        chatList.focusRelativeChat(1)
        return
      }
    }

    if (!hasModifier) {
      return
    }

    if ((event.key === '\\' || event.code === 'Backslash') && !event.shiftKey) {
      event.preventDefault()
      layout.setDetailRailPreferred((c) => !c)
      return
    }

    if (isDesktopShell() && event.shiftKey) {
      if (event.key.toLowerCase() === 'm') { event.preventDefault(); void desktop.handleMinimizeDesktopHostWindow(); return }
      if (event.code === 'Digit0') { event.preventDefault(); void desktop.handleResetDesktopHostWindowFrame(); return }
      if (event.key.toLowerCase() === 'p') { event.preventDefault(); void desktop.handleToggleDesktopAlwaysOnTop(); return }
      if (event.key.toLowerCase() === 'u') { event.preventDefault(); void desktop.handleToggleDesktopFullscreen(); return }
      if (event.key.toLowerCase() === 'd') { event.preventDefault(); void desktop.handleCopyDesktopDiagnostics(); return }
      if (event.key.toLowerCase() === 'w') { event.preventDefault(); void desktop.handleCloseDesktopHostWindow(); return }
      if (event.key === 'Enter') { event.preventDefault(); void desktop.handleToggleDesktopWindowMaximize(); return }
    }

    if (event.key.toLowerCase() === 'f' && event.shiftKey) {
      event.preventDefault()
      chatList.chatFilterInputRef.current?.focus()
      chatList.chatFilterInputRef.current?.select()
      return
    }

    if (event.key.toLowerCase() === 'k' && !event.shiftKey) {
      event.preventDefault()
      chatList.directChatInputRef.current?.focus()
      chatList.directChatInputRef.current?.select()
      return
    }

    if (event.key.toLowerCase() === 'g' && event.shiftKey) {
      event.preventDefault()
      chatList.groupTitleInputRef.current?.focus()
      chatList.groupTitleInputRef.current?.select()
      return
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      if (messages.draft.trim() !== '' && activeChat && !loading) {
        event.preventDefault()
        void messages.sendDraftMessage()
      }
      return
    }

    if (event.shiftKey && !loading && activeChat && !call.activeCall) {
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

  useEffect(() => {
    window.addEventListener('keydown', handleDesktopShortcut)
    return () => {
      window.removeEventListener('keydown', handleDesktopShortcut)
    }
  }, [])

  // --- Auth shell (onboarding) ---

  if (auth.view !== 'chat') {
    return (
      <div className="auth-shell">
        <section className="auth-shell__hero">
          <span className="sidebar__eyebrow">Vostok Stage 2</span>
          <h1>Identity and device bootstrap</h1>
          <p>
            This slice adds real registration, challenge-response authentication, and local device
            key storage in the browser.
          </p>
          <MessageBubble className="conversation-stage__hero" side="system">
            <strong className="hero-card__title">Private by default</strong>
            <span className="hero-card__copy">
              Your browser now generates local signing and encryption keys. The server stores only
              the public halves and later verifies challenge signatures during login.
            </span>
            <span className="hero-card__mark" aria-hidden="true">V</span>
          </MessageBubble>
        </section>
        <GlassSurface className="auth-card">
          <div className="auth-card__tabs">
            <button className={auth.view === 'register' ? 'auth-tab auth-tab--active' : 'auth-tab'} type="button" onClick={() => auth.setView('register')}>Register</button>
            <button className={auth.view === 'login' ? 'auth-tab auth-tab--active' : 'auth-tab'} type="button" onClick={() => auth.setView('login')}>Sign In</button>
            <button className={auth.view === 'link' ? 'auth-tab auth-tab--active' : 'auth-tab'} type="button" onClick={() => auth.setView('link')}>Link Device</button>
          </div>
          {banner ? <div className={`status-banner status-banner--${banner.tone}`}>{banner.message}</div> : null}
          {auth.view === 'welcome' || auth.view === 'register' ? (
            <form className="auth-form" onSubmit={auth.handleRegister}>
              <div className="auth-copy"><h2>Create your first device</h2><p>This flow creates a local device key, registers a username, and stores the issued session token in local browser storage.</p></div>
              <label className="auth-field"><span>Username</span><input autoComplete="username" disabled={loading} onChange={(e) => auth.setUsername(e.target.value)} placeholder="grigory" required value={auth.username} /></label>
              <label className="auth-field"><span>Device name</span><input disabled={loading} onChange={(e) => auth.setDeviceName(e.target.value)} placeholder="Safari on Mac" required value={auth.deviceName} /></label>
              <button className="primary-action" disabled={loading} type="submit">{loading ? 'Working\u2026' : 'Register This Device'}</button>
            </form>
          ) : null}
          {auth.view === 'login' ? (
            <div className="auth-form">
              <div className="auth-copy"><h2>Re-authenticate on this browser</h2><p>This uses the stored private key to sign a fresh server challenge and mint a new session token.</p></div>
              <div className="device-summary-card">{storedDevice ? (<><strong>{storedDevice.username}</strong><span>{storedDevice.deviceName}</span><span>Device ID: {storedDevice.deviceId}</span></>) : (<><strong>No local device found</strong><span>Register once on this browser before using sign-in.</span></>)}</div>
              <button className="primary-action" disabled={loading || !storedDevice} onClick={auth.handleReauthenticate} type="button">{loading ? 'Working\u2026' : 'Sign Challenge'}</button>
            </div>
          ) : null}
          {auth.view === 'link' ? (
            <div className="auth-form">
              <div className="auth-copy"><h2>Link a second device</h2><p>The full QR-based pairing flow lands in the next slice. This screen reserves the Stage 2 entry point so the UX is in place before the pairing transport is added.</p></div>
              <label className="auth-field"><span>Pairing code</span><input disabled placeholder="Coming next" value="" readOnly /></label>
              <button className="secondary-action" disabled type="button">Pairing Transport Pending</button>
            </div>
          ) : null}
        </GlassSurface>
      </div>
    )
  }

  // --- Main chat shell ---

  return (
    <div className={appShellClassName}>
      <aside className="sidebar">
        <div className="sidebar__header">
          <span className="sidebar__eyebrow">Vostok</span>
          {desktop.desktopShell ? (
            <div className={desktop.desktopWindowFocused === false ? 'desktop-titlebar desktop-titlebar--inactive' : 'desktop-titlebar'}>
              <div className="desktop-titlebar__meta" data-tauri-drag-region>
                <strong>{desktop.desktopRuntime?.appName ?? 'Vostok Desktop'}</strong>
                <span>{desktop.desktopRuntime ? `${desktop.desktopRuntime.platform}/${desktop.desktopRuntime.arch}` : 'Tauri desktop host'}</span>
              </div>
              <div className="desktop-titlebar__actions">
                <button aria-label={desktop.desktopWindowAlwaysOnTop ? 'Disable always on top' : 'Enable always on top'} className="vostok-icon-button desktop-titlebar__button" disabled={loading} onClick={desktop.handleToggleDesktopAlwaysOnTop} type="button"><span className="vostok-icon-button__glyph">{desktop.desktopWindowAlwaysOnTop ? 'P' : 'p'}</span></button>
                <button aria-label={desktop.desktopWindowFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'} className="vostok-icon-button desktop-titlebar__button" disabled={loading} onClick={desktop.handleToggleDesktopFullscreen} type="button"><span className="vostok-icon-button__glyph">{desktop.desktopWindowFullscreen ? 'U' : 'u'}</span></button>
                <button aria-label="Minimize desktop window" className="vostok-icon-button desktop-titlebar__button" disabled={loading} onClick={desktop.handleMinimizeDesktopHostWindow} type="button"><span className="vostok-icon-button__glyph">-</span></button>
                <button aria-label={desktop.desktopWindowMaximized ? 'Restore desktop window' : 'Maximize desktop window'} className="vostok-icon-button desktop-titlebar__button" disabled={loading} onClick={desktop.handleToggleDesktopWindowMaximize} type="button"><span className="vostok-icon-button__glyph">{desktop.desktopWindowMaximized ? 'R' : '+'}</span></button>
                <button aria-label="Close desktop window" className="vostok-icon-button desktop-titlebar__button" disabled={loading} onClick={desktop.handleCloseDesktopHostWindow} type="button"><span className="vostok-icon-button__glyph">x</span></button>
              </div>
            </div>
          ) : null}
          <h1>Chats</h1>
          <p>Stage 3 now uses authenticated direct chats and opaque encrypted message envelopes.</p>
        </div>
        <button aria-pressed={detailRailVisible} className="secondary-action detail-rail-toggle" onClick={() => layout.setDetailRailPreferred((c) => !c)} type="button">
          {detailRailVisible ? 'Hide Detail Rail' : layout.isDesktopWide ? 'Show Detail Rail' : 'Detail Rail Hidden on Narrow Window'}
        </button>
        <div className="new-chat-form">
          <label className="auth-field"><span>Filter chats</span><input disabled={loading} onChange={(e) => chatList.setChatFilter(e.target.value)} placeholder="Search by title" ref={chatList.chatFilterInputRef} value={chatList.chatFilter} /></label>
          {chatList.chatFilter.trim() !== '' ? (<button className="secondary-action" disabled={loading} onClick={() => chatList.setChatFilter('')} type="button">Clear Filter</button>) : null}
        </div>
        <form className="new-chat-form" onSubmit={chatList.handleCreateDirectChat}>
          <label className="auth-field"><span>Start direct chat</span><input disabled={loading} onChange={(e) => chatList.setNewChatUsername(e.target.value)} placeholder="username" ref={chatList.directChatInputRef} value={chatList.newChatUsername} /></label>
          <button className="secondary-action" disabled={loading || chatList.newChatUsername.trim() === ''} type="submit">Open Direct Chat</button>
        </form>
        <form className="new-chat-form" onSubmit={chatList.handleCreateGroupChat}>
          <label className="auth-field"><span>Create group</span><input disabled={loading} onChange={(e) => chatList.setNewGroupTitle(e.target.value)} placeholder="Operators" ref={chatList.groupTitleInputRef} value={chatList.newGroupTitle} /></label>
          <label className="auth-field"><span>Members (comma-separated)</span><input disabled={loading} onChange={(e) => chatList.setNewGroupMembers(e.target.value)} placeholder="alice,bob" value={chatList.newGroupMembers} /></label>
          <button className="secondary-action" disabled={loading || chatList.newGroupTitle.trim() === ''} type="submit">Open Group</button>
        </form>
        <div className="sidebar__list">
          {visibleChatItems.length > 0 ? (
            visibleChatItems.map((chat) => (
              <button key={chat.id} className="chat-list-button" onClick={() => chatList.setActiveChatId(chat.id)} ref={(el) => { chatList.chatButtonRefs.current[chat.id] = el }} type="button">
                <ChatListItem title={chat.title} preview={chat.message_count > 0 ? `${chat.message_count} encrypted ${chat.message_count === 1 ? 'message' : 'messages'}` : 'No messages yet'} timestamp={formatRelativeTime(chat.latest_message_at)} unreadCount={chat.message_count > 0 ? Math.min(chat.message_count, 9) : undefined} active={chat.id === activeChat?.id} pinned={chat.is_self_chat} />
              </button>
            ))
          ) : (
            <span className="settings-card__muted">No chats match the current filter.</span>
          )}
        </div>
      </aside>

      <main className="conversation-pane">
        {banner ? <div className={`status-banner status-banner--${banner.tone}`}>{banner.message}</div> : null}
        <ConversationHeader title={activeChat?.title ?? 'No active chat'} subtitle={activeChat ? activeChat.is_self_chat ? 'local encrypted cache available' : 'direct chat envelope transport' : 'create or select a direct chat'} />
        <section className="conversation-stage">
          {pinnedMessage && !pinnedMessage.deletedAt ? (
            <GlassSurface className="pinned-message-banner">
              <span className="sidebar__eyebrow">Pinned message</span>
              <strong>{resolvePinnedPreview(pinnedMessage)}</strong>
              <span>{formatRelativeTime(pinnedMessage.pinnedAt ?? pinnedMessage.sentAt)}</span>
            </GlassSurface>
          ) : null}
          {messages.messageItems.length === 0 ? (
            <MessageBubble className="conversation-stage__hero" side="system">
              <strong className="hero-card__title">No messages here yet...</strong>
              <span className="hero-card__copy">Stage 3 now supports recipient-targeted envelope wrapping for newly registered devices, with a legacy local-cache fallback for older browser-only messages.</span>
              <span className="hero-card__mark" aria-hidden="true">V</span>
            </MessageBubble>
          ) : (
            <div className="message-thread">
              {messages.messageItems.map((message) => {
                const linkUrl = extractFirstHttpUrl(message.text)
                const linkPreview = resolveLinkPreview(message.text, linkUrl ? messages.linkMetadataByUrl[linkUrl] : null)
                const attachmentDescriptor = message.attachment?.contentKeyBase64 && message.attachment.ivBase64 ? toAttachmentDescriptor(message.attachment) : null
                return (
                  <MessageBubble key={message.id} side={message.side}>
                    {message.replyToMessageId ? (<span className="message-thread__reply-preview">Replying to {resolveReplyPreview(messages.messageItems, message.replyToMessageId)}</span>) : null}
                    <strong>{message.text}</strong>
                    {linkPreview ? (<a className="message-thread__link-preview" href={linkPreview.href} rel="noreferrer" target="_blank"><span className="message-thread__link-domain">{linkPreview.hostname}</span><strong>{linkPreview.title}</strong><span>{linkPreview.description || linkPreview.href}</span></a>) : null}
                    {message.attachment?.thumbnailDataUrl ? (<img alt={message.attachment.fileName} className={isRoundVideoAttachment(message.attachment) ? 'message-thread__attachment-preview message-thread__attachment-preview--round' : 'message-thread__attachment-preview'} src={message.attachment.thumbnailDataUrl} />) : null}
                    {message.attachment?.waveform && message.attachment.waveform.length > 0 && message.attachment && isVoiceNoteAttachment(message.attachment) ? (<span className="message-thread__waveform" aria-label="Voice note waveform">{message.attachment.waveform.map((level, index) => (<span className="message-thread__waveform-bar" key={`${message.id}-waveform-${index}`} style={{ height: `${Math.max(18, Math.round(level * 100))}%` }} />))}</span>) : null}
                    {attachmentDescriptor && message.attachment && isVoiceNoteAttachment(message.attachment) ? (<VoiceNotePlayer attachment={attachmentDescriptor} onResolveMediaUrl={messages.ensureAttachmentPlaybackUrl} />) : null}
                    {attachmentDescriptor && message.attachment && isRoundVideoAttachment(message.attachment) ? (<RoundVideoPlayer attachment={attachmentDescriptor} onResolveMediaUrl={messages.ensureAttachmentPlaybackUrl} />) : null}
                    {attachmentDescriptor ? (<button className="secondary-action" onClick={() => messages.handleDownloadAttachment(attachmentDescriptor)} type="button">Download {attachmentDescriptor.fileName}</button>) : null}
                    {message.reactions && message.reactions.length > 0 ? (<span className="message-thread__reactions">{message.reactions.map((r) => `${r.reactionKey} ${r.count}${r.reacted ? '*' : ''}`).join(' \u2022 ')}</span>) : null}
                    {message.side !== 'system' ? (
                      <div className="message-thread__actions">
                        {!message.deletedAt ? (<button className="secondary-action" disabled={loading} onClick={() => messages.handleReplyToMessage(message)} type="button">Reply</button>) : null}
                        {message.side === 'outgoing' && !message.attachment && !message.deletedAt ? (<button className="secondary-action" disabled={loading} onClick={() => messages.handleStartEditingMessage(message)} type="button">Edit</button>) : null}
                        {message.side === 'outgoing' && !message.deletedAt ? (<button className="secondary-action" disabled={loading} onClick={() => messages.handleDeleteExistingMessage(message)} type="button">Delete</button>) : null}
                        {!message.id.startsWith('optimistic-') && !message.deletedAt ? (<button className="secondary-action" disabled={loading} onClick={() => messages.handleToggleMessagePin(message)} type="button">{message.pinnedAt ? 'Unpin' : 'Pin'}</button>) : null}
                      </div>
                    ) : null}
                    <span className="message-thread__meta">{formatRelativeTime(message.sentAt)}{message.pinnedAt ? ' \u2022 pinned' : ''}{message.editedAt ? ' \u2022 edited' : ''}{message.deletedAt ? ' \u2022 deleted' : ''}{message.decryptable ? ' \u2022 decryptable on this device' : ' \u2022 opaque on this device'}</span>
                  </MessageBubble>
                )
              })}
            </div>
          )}
          <div className="floating-stack">
            <ReactionBar reactions={['ACK', 'OK', 'PLAN', 'SHIP']} onSelect={messages.handleQuickReaction} />
            <ContextMenu actions={['Reply', 'Forward (next)', 'Pin active message', 'Delete for me', 'Delete for all']} />
          </div>
        </section>

        <form className="live-composer" onSubmit={messages.handleSendMessage}>
          <input hidden onChange={mediaCapture.handleAttachmentPick} ref={mediaCapture.fileInputRef} type="file" />
          <button className="vostok-icon-button" type="button" aria-label="Attach" disabled={loading || !activeChat} onClick={() => mediaCapture.fileInputRef.current?.click()}><span className="vostok-icon-button__glyph">A</span></button>
          <button className="vostok-icon-button" type="button" aria-label={mediaCapture.voiceNoteRecording ? 'Stop voice note recording' : 'Record voice note'} disabled={loading || !activeChat} onClick={() => void mediaCapture.handleVoiceNoteToggle()}><span className="vostok-icon-button__glyph">{mediaCapture.voiceNoteRecording ? 'S' : 'M'}</span></button>
          <button className="vostok-icon-button" type="button" aria-label={mediaCapture.roundVideoRecording ? 'Stop round video recording' : 'Record round video'} disabled={loading || !activeChat} onClick={() => void mediaCapture.handleRoundVideoToggle()}><span className="vostok-icon-button__glyph">{mediaCapture.roundVideoRecording ? 'S' : 'V'}</span></button>
          <GlassSurface className="live-composer__field">
            {messages.replyTargetMessageId ? (
              <div className="live-composer__reply">
                <div className="live-composer__reply-copy"><strong>{messages.editingMessageId ? 'Editing reply' : 'Replying'}</strong><span>{replyTargetMessage ? replyTargetMessage.text : 'Earlier message'}</span></div>
                <button className="vostok-icon-button live-composer__reply-clear" disabled={loading} onClick={() => messages.setReplyTargetMessageId(null)} type="button"><span className="vostok-icon-button__glyph">x</span></button>
              </div>
            ) : null}
            {messages.editingMessageId && !messages.replyTargetMessageId ? (
              <div className="live-composer__reply">
                <div className="live-composer__reply-copy"><strong>Editing message</strong><span>{editingTargetMessage ? editingTargetMessage.text : 'Outgoing message'}</span></div>
                <button className="vostok-icon-button live-composer__reply-clear" disabled={loading} onClick={() => { messages.setEditingMessageId(null); messages.setDraft('') }} type="button"><span className="vostok-icon-button__glyph">x</span></button>
              </div>
            ) : null}
            <textarea className="live-composer__input" disabled={loading || !activeChat} onChange={(e) => messages.setDraft(e.target.value)} placeholder={activeChat ? messages.editingMessageId ? 'Edit the encrypted envelope\u2026' : 'Write an encrypted envelope\u2026' : 'Create a chat first'} ref={messages.draftInputRef} rows={1} value={messages.draft} />
          </GlassSurface>
          <button className="primary-action live-composer__send" disabled={loading || !activeChat || messages.draft.trim() === ''} type="submit">{messages.editingMessageId ? 'Save' : 'Send'}</button>
        </form>
      </main>

      <aside className={detailRailVisible ? 'detail-rail' : 'detail-rail detail-rail--hidden'}>
        <ChatInfoPanel title={profileUsername ?? storedDevice?.username ?? 'Dinosaur'} phone="+7 999 555 01 10" handle={`@${profileUsername ?? storedDevice?.username ?? 'dinosaur'}`} />
        <GlassSurface className="settings-card">
          <div className="settings-card__header"><span className="sidebar__eyebrow">Media</span><h3>Chat gallery</h3></div>
          {chatMediaItems.length > 0 ? (
            <div className="chat-media-gallery">
              {chatMediaItems.slice(-6).reverse().map((message) => (
                <button key={message.id} className="chat-media-gallery__item" disabled={!message.attachment} onClick={() => { if (message.attachment) { void messages.handleDownloadAttachment(toAttachmentDescriptor(message.attachment)) } }} type="button">
                  {message.attachment?.thumbnailDataUrl ? (<img alt={message.attachment.fileName} className={message.attachment && isRoundVideoAttachment(message.attachment) ? 'chat-media-gallery__image chat-media-gallery__image--round' : 'chat-media-gallery__image'} src={message.attachment.thumbnailDataUrl} />) : (<span className="chat-media-gallery__fallback">{message.attachment?.fileName}</span>)}
                </button>
              ))}
            </div>
          ) : (<span className="settings-card__muted">No attachments in the current chat yet.</span>)}
        </GlassSurface>
        {activeChat?.type === 'group' ? (
          <GlassSurface className="settings-card">
            <div className="settings-card__header"><span className="sidebar__eyebrow">Group</span><h3>Admin controls</h3></div>
            <form className="new-chat-form" onSubmit={groupChat.handleRenameActiveGroupChat}>
              <label className="auth-field"><span>Group title</span><input disabled={loading} onChange={(e) => groupChat.setGroupRenameTitle(e.target.value)} placeholder="Operators" value={groupChat.groupRenameTitle} /></label>
              <button className="secondary-action" disabled={loading || groupChat.groupRenameTitle.trim() === '' || groupChat.groupRenameTitle === activeChat.title} type="submit">Save Group Title</button>
            </form>
            <div className="device-summary-card"><strong>Members</strong>{groupChat.groupMembers.length > 0 ? groupChat.groupMembers.map((member) => (<span key={member.user_id}>{member.username} &bull; {member.role}{member.username === profileUsername ? ' \u2022 you' : ''}</span>)) : (<span>Loading members\u2026</span>)}</div>
            <div className="settings-card__actions">
              {groupChat.groupMembers.map((member) => {
                const isSelf = member.username === profileUsername
                return (
                  <div key={member.user_id} className="settings-card__row">
                    <div className="settings-card__row-main"><strong>{member.username}</strong><span>{member.role}{isSelf ? ' \u2022 you' : ''}</span></div>
                    {!isSelf ? (
                      <div className="settings-card__row-actions">
                        <button className="secondary-action" disabled={loading || member.role === 'admin'} onClick={() => void groupChat.handleUpdateActiveGroupMemberRole(member, 'admin')} type="button">Promote</button>
                        <button className="secondary-action" disabled={loading || member.role === 'member'} onClick={() => void groupChat.handleUpdateActiveGroupMemberRole(member, 'member')} type="button">Demote</button>
                        <button className="danger-action" disabled={loading} onClick={() => void groupChat.handleRemoveActiveGroupMember(member)} type="button">Remove</button>
                      </div>
                    ) : (<span className="settings-card__muted">Self-management stays manual for now.</span>)}
                  </div>
                )
              })}
            </div>
            <div className="settings-card__actions"><button className="secondary-action" disabled={loading || !groupChat.activeGroupChatId} onClick={() => void groupChat.handleRotateGroupSenderKey()} type="button">Rotate Sender Key</button></div>
            <div className="settings-card__list">
              {groupChat.groupSenderKeys.length === 0 ? (<span className="settings-card__muted">No inbound Sender Keys are currently queued for this device.</span>) : (groupChat.groupSenderKeys.slice(0, 4).map((senderKey) => (<div className="settings-card__row" key={senderKey.id}><div className="settings-card__row-main"><strong>{senderKey.key_id}</strong><span>{senderKey.algorithm} &bull; {senderKey.status}</span><span>{formatRelativeTime(senderKey.updated_at ?? senderKey.inserted_at)}</span></div></div>)))}
            </div>
          </GlassSurface>
        ) : null}
        <GlassSurface className="settings-card">
          <div className="settings-card__header"><span className="sidebar__eyebrow">Settings</span><h3>Current device</h3></div>
          <div className="device-summary-card">
            <strong>{storedDevice?.deviceName ?? 'This browser'}</strong>
            <span>{storedDevice?.username ?? 'anonymous'}</span>
            <span>Session expires: {storedDevice?.sessionExpiresAt ?? 'not set'}</span>
            <span>Published prekeys: {storedDevice?.signedPrekeyPublicKeyBase64 ? 'signed prekey present' : 'signed prekey missing'}{` \u2022 ${storedDevice?.oneTimePrekeys?.length ?? 0} local one-time prekeys cached`}</span>
            <span>Offline outbox: {messages.outboxPendingCount} pending message{messages.outboxPendingCount === 1 ? '' : 's'}</span>
          </div>
          <div className="settings-card__list">
            {auth.devices.length === 0 ? (<span className="settings-card__muted">No linked devices found yet.</span>) : (auth.devices.map((device) => (
              <div className="settings-card__row" key={device.id}>
                <div className="settings-card__row-main"><strong>{device.device_name}</strong><span>{device.is_current ? 'current device' : 'linked device'}{device.revoked_at ? ` \u2022 revoked ${formatRelativeTime(device.revoked_at)}` : ''}</span><span>{device.one_time_prekey_count} active one-time prekey{device.one_time_prekey_count === 1 ? '' : 's'}</span></div>
                {!device.is_current && !device.revoked_at ? (<div className="settings-card__row-actions"><button className="danger-action" disabled={loading} onClick={() => void groupChat.handleRevokeLinkedDevice(device.id)} type="button">Revoke</button></div>) : null}
              </div>
            )))}
          </div>
          <div className="settings-card__actions">
            <button className="primary-action" disabled={loading} onClick={auth.handleReauthenticate} type="button">Refresh Session</button>
            <button className="secondary-action" disabled={loading} onClick={auth.handleRotatePrekeys} type="button">Rotate Prekeys</button>
            <button className="secondary-action" onClick={() => auth.setView('link')} type="button">Link Another Device</button>
            <button className="danger-action" onClick={auth.handleForgetDevice} type="button">Forget Local Device</button>
          </div>
        </GlassSurface>
        <GlassSurface className="settings-card">
          <div className="settings-card__header"><span className="sidebar__eyebrow">Desktop</span><h3>Host bridge</h3></div>
          <div className="device-summary-card">
            <strong>{isDesktopShell() ? 'Tauri desktop host detected' : 'Browser session'}</strong>
            <span>{desktop.desktopRuntime ? `${desktop.desktopRuntime.appName} ${desktop.desktopRuntime.appVersion} \u2022 ${desktop.desktopRuntime.platform}/${desktop.desktopRuntime.arch}` : isDesktopShell() ? 'Runtime metadata available after the desktop host responds.' : 'Desktop bridge commands are hidden until this UI runs inside the desktop wrapper.'}</span>
            <span>Native title: {desktop.desktopWindowTitle}</span>
            <span>{desktop.desktopRuntime ? desktop.desktopRuntime.debug ? 'Desktop host is running in debug mode.' : 'Desktop host is running in release mode.' : 'No desktop runtime metadata loaded yet.'}</span>
            <span>{desktop.desktopWindowMaximized === null ? 'Window state has not been toggled in this session yet.' : desktop.desktopWindowMaximized ? 'Window is currently maximized.' : 'Window is currently restored.'}</span>
            <span>{desktop.desktopWindowFocused === null ? 'Window focus state is not known yet.' : desktop.desktopWindowFocused ? 'Window is currently focused.' : 'Window is currently unfocused.'}</span>
            <span>{desktop.desktopWindowAlwaysOnTop === null ? 'Always-on-top state is not known yet.' : desktop.desktopWindowAlwaysOnTop ? 'Window is pinned above other windows.' : 'Window follows normal stacking order.'}</span>
            <span>Always-on-top preference is remembered across desktop launches.</span>
            <span>{desktop.desktopWindowFullscreen === null ? 'Fullscreen state is not known yet.' : desktop.desktopWindowFullscreen ? 'Window is currently fullscreen.' : 'Window is currently windowed.'}</span>
            <span>{desktop.desktopWindowGeometry ? `Window frame ${desktop.desktopWindowGeometry.width}\u00d7${desktop.desktopWindowGeometry.height} at ${desktop.desktopWindowGeometry.x}, ${desktop.desktopWindowGeometry.y}` : 'Window frame has not been captured yet.'}</span>
          </div>
          <div className="settings-card__actions">
            <button className="secondary-action" disabled={loading} onClick={desktop.handleRefreshDesktopRuntime} type="button">Refresh Host Info</button>
            <button className="secondary-action" disabled={loading} onClick={desktop.handleCopyDesktopDiagnostics} type="button">Copy Diagnostics</button>
            <button className="secondary-action" disabled={loading} onClick={desktop.handleToggleDesktopAlwaysOnTop} type="button">{desktop.desktopWindowAlwaysOnTop ? 'Disable Always On Top' : 'Enable Always On Top'}</button>
            <button className="secondary-action" disabled={loading} onClick={desktop.handleToggleDesktopFullscreen} type="button">{desktop.desktopWindowFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}</button>
            <button className="secondary-action" disabled={loading} onClick={desktop.handleToggleDesktopWindowMaximize} type="button">{desktop.desktopWindowMaximized ? 'Restore Window' : 'Toggle Maximize'}</button>
            <button className="secondary-action" disabled={loading} onClick={desktop.handleResetDesktopHostWindowFrame} type="button">Reset Window Frame</button>
            <button className="secondary-action" disabled={loading} onClick={desktop.handleMinimizeDesktopHostWindow} type="button">Minimize Window</button>
          </div>
        </GlassSurface>
        <GlassSurface className="settings-card">
          <div className="settings-card__header"><span className="sidebar__eyebrow">Stage 8</span><h3>Desktop shortcuts</h3></div>
          <div className="settings-card__list">
            <div className="settings-card__row"><div className="settings-card__row-main"><strong>Compose</strong><span>`/` focuses the active chat composer.</span></div></div>
            <div className="settings-card__row"><div className="settings-card__row-main"><strong>Move between chats</strong><span>`Alt+ArrowUp/Down` selects the previous or next chat.</span></div></div>
            <div className="settings-card__row"><div className="settings-card__row-main"><strong>Filter chats</strong><span>`Cmd/Ctrl+Shift+F` focuses the chat filter field.</span></div></div>
            <div className="settings-card__row"><div className="settings-card__row-main"><strong>Toggle detail rail</strong><span>`Cmd/Ctrl+\` switches between two-column and three-column desktop layout.</span></div></div>
            <div className="settings-card__row"><div className="settings-card__row-main"><strong>Layout memory</strong><span>{layout.isDesktopWide ? `The saved desktop preference is currently ${layout.detailRailPreferred ? 'expanded' : 'collapsed'}.` : 'Your saved desktop rail preference is preserved while narrow windows force focus mode.'}</span></div></div>
            <div className="settings-card__row"><div className="settings-card__row-main"><strong>Desktop host controls</strong><span>`Cmd/Ctrl+Shift+P` always on top &bull; `Cmd/Ctrl+Shift+U` fullscreen &bull; `Cmd/Ctrl+Shift+D` diagnostics &bull; `Cmd/Ctrl+Shift+M` minimize &bull; `Cmd/Ctrl+Shift+Enter` maximize/restore &bull; `Cmd/Ctrl+Shift+W` close</span></div></div>
            <div className="settings-card__row"><div className="settings-card__row-main"><strong>Reset window frame</strong><span>`Cmd/Ctrl+Shift+0` restores the default centered desktop frame.</span></div></div>
            <div className="settings-card__row"><div className="settings-card__row-main"><strong>Diagnostics</strong><span>The host card can copy runtime, window, and layout diagnostics to the clipboard, or use `Cmd/Ctrl+Shift+D`.</span></div></div>
            <div className="settings-card__row"><div className="settings-card__row-main"><strong>Quick actions</strong><span>`Cmd/Ctrl+K` direct chat &bull; `Cmd/Ctrl+Shift+G` group title</span></div></div>
            <div className="settings-card__row"><div className="settings-card__row-main"><strong>Send and call</strong><span>`Cmd/Ctrl+Enter` send &bull; `Cmd/Ctrl+Shift+A/V` voice or video call</span></div></div>
            <div className="settings-card__row"><div className="settings-card__row-main"><strong>Reset focus</strong><span>`Escape` clears the banner and blurs the active field.</span></div></div>
          </div>
        </GlassSurface>
        <GlassSurface className="settings-card">
          <div className="settings-card__header"><span className="sidebar__eyebrow">Stage 3</span><h3>Messaging slice</h3></div>
          <div className="device-summary-card">
            <strong>{activeChat?.title ?? 'No chat selected'}</strong>
            <span>{activeChat ? `${activeChat.message_count} server envelopes` : 'Open a direct chat'}</span>
            <span>{activeChat?.is_self_chat ? 'Self-chat can use recipient-wrapped envelopes when this device has an encryption key.' : 'Cross-user transport now advances a local per-device ratchet from HKDF-derived session roots, explicit initiator ephemeral bootstrap, ratchet version tags, epoch transitions on re-handshake, and local DH steps when peer ratchet keys change; the full Signal-grade ratchet is still next.'}</span>
            <span>{activeChat ? `${sessions.remotePrekeyBundles.length} published prekey ${sessions.remotePrekeyBundles.length === 1 ? 'bundle' : 'bundles'} visible for this chat` : 'Select a chat to inspect published prekeys'}</span>
            <span>{activeChat ? `${sessions.chatSessions.length} cached direct-chat session ${sessions.chatSessions.length === 1 ? 'record' : 'records'} ready for this chat \u2022 ${sessions.chatSessions.filter((s) => s.session_state === 'active' && s.establishment_state === 'established').length} established \u2022 ${sessions.chatSessions.filter((s) => s.session_state === 'active' && s.establishment_state === 'pending_first_message').length} pending first message \u2022 ${sessions.chatSessions.filter((s) => s.session_state === 'superseded').length} superseded` : 'Select a chat to bootstrap direct-chat sessions'}</span>
          </div>
          <div className="device-summary-card__actions"><button className="secondary-action" disabled={loading || !activeChat} onClick={sessions.handleRekeyActiveChatSessions} type="button">Rekey Active Sessions</button></div>
          <div className="settings-card__list">
            {sessions.safetyNumbers.length === 0 ? (<span className="settings-card__muted">No remote safety numbers available for the current chat.</span>) : (sessions.safetyNumbers.map((entry) => (
              <div className="settings-card__row" key={entry.peerDeviceId}>
                <div className="settings-card__row-main"><strong>{entry.label}</strong><span>{entry.fingerprint}</span><span>{entry.verified ? `verified ${formatRelativeTime(entry.verifiedAt)}` : 'not verified'}</span></div>
                <div className="settings-card__row-actions">{!entry.verified ? (<button className="mini-action" disabled={sessions.verifyingSafetyDeviceId === entry.peerDeviceId || loading} onClick={() => void sessions.handleVerifyPeerSafetyNumber(entry.peerDeviceId)} type="button">Verify</button>) : (<span className="settings-card__muted">Verified</span>)}</div>
              </div>
            )))}
          </div>
        </GlassSurface>
        <GlassSurface className="settings-card">
          <div className="settings-card__header"><span className="sidebar__eyebrow">Stage 6</span><h3>Admin surface</h3></div>
          <div className="device-summary-card">
            <strong>Local operator overview</strong>
            <span>{federation.adminOverview ? `${federation.adminOverview.users} users \u2022 ${federation.adminOverview.chats} chats \u2022 ${federation.adminOverview.media_uploads} uploads` : 'Admin overview unavailable'}</span>
            <span>{federation.adminOverview ? `${federation.adminOverview.federation_peers} federation peers \u2022 ${federation.adminOverview.pending_federation_peers} pending \u2022 ${federation.adminOverview.queued_federation_deliveries ?? 0} queued deliveries` : 'Federation stats unavailable'}</span>
          </div>
          <form className="new-chat-form" onSubmit={federation.handleCreateFederationPeer}>
            <label className="auth-field"><span>Peer domain</span><input disabled={loading} onChange={(e) => federation.setFederationDomain(e.target.value)} placeholder="chat.remote.example" value={federation.federationDomain} /></label>
            <label className="auth-field"><span>Display name</span><input disabled={loading} onChange={(e) => federation.setFederationDisplayName(e.target.value)} placeholder="Remote Example" value={federation.federationDisplayName} /></label>
            <button className="secondary-action" disabled={loading || federation.federationDomain.trim() === ''} type="submit">Add Federation Peer</button>
          </form>
          <div className="settings-card__list">
            {federation.federationInviteToken ? (<div className="settings-card__row"><div className="settings-card__row-main"><strong>Latest invite token</strong><span>{federation.federationInviteToken}</span></div></div>) : null}
            {federation.federationPeers.length === 0 ? (<span className="settings-card__muted">No federation peers configured yet.</span>) : (federation.federationPeers.slice(0, 3).map((peer) => (
              <div className="settings-card__row" key={peer.id}>
                <div className="settings-card__row-main"><strong>{peer.display_name || peer.domain}</strong><span>{peer.status} &bull; {peer.trust_state}{peer.last_seen_at ? ` \u2022 seen ${formatRelativeTime(peer.last_seen_at)}` : ''}</span></div>
                <div className="settings-card__row-actions">
                  <button className="mini-action" disabled={loading} onClick={() => void federation.handleCreateFederationPeerInvite(peer.id)} type="button">Invite</button>
                  <button className="mini-action" disabled={loading} onClick={() => federation.handleUpdateFederationPeerStatus(peer.id, peer.status === 'active' ? 'disabled' : 'active')} type="button">{peer.status === 'active' ? 'Disable' : 'Activate'}</button>
                  <button className="mini-action" disabled={loading} onClick={() => federation.handleHeartbeatFederationPeer(peer.id)} type="button">Ping</button>
                  <button className="mini-action" disabled={loading} onClick={() => void federation.handleQueueFederationDelivery(peer.id)} type="button">Queue Relay</button>
                </div>
              </div>
            )))}
          </div>
          <div className="settings-card__list">
            {federation.federationDeliveries.length === 0 ? (<span className="settings-card__muted">No federation deliveries queued yet.</span>) : (federation.federationDeliveries.slice(0, 3).map((delivery) => (
              <div className="settings-card__row" key={delivery.id}>
                <div className="settings-card__row-main"><strong>{delivery.event_type}</strong><span>{delivery.status} &bull; {delivery.attempt_count} attempt{delivery.attempt_count === 1 ? '' : 's'}</span></div>
                <div className="settings-card__row-actions">
                  <span className="settings-card__muted">{formatRelativeTime(delivery.updated_at ?? delivery.inserted_at)}</span>
                  {delivery.status !== 'delivered' ? (<button className="mini-action" disabled={loading} onClick={() => void federation.handleAttemptFederationDelivery(delivery.id)} type="button">Mark Delivered</button>) : null}
                </div>
              </div>
            )))}
          </div>
        </GlassSurface>
        <GlassSurface className="settings-card">
          <div className="settings-card__header"><span className="sidebar__eyebrow">Stage 7</span><h3>Call bootstrap</h3></div>
          <div className="device-summary-card">
            <strong>{call.activeCall ? `${call.activeCall.mode} call active` : federation.turnCredentials ? 'TURN credentials ready' : 'TURN credentials unavailable'}</strong>
            <span>{federation.turnCredentials ? `Expires ${formatRelativeTime(federation.turnCredentials.expires_at)}` : 'Refresh to fetch a short-lived credential set.'}</span>
            <span>{call.activeCall ? `Started ${formatRelativeTime(call.activeCall.started_at)}` : federation.turnCredentials ? `${federation.turnCredentials.uris.length} relay URI${federation.turnCredentials.uris.length === 1 ? '' : 's'} issued` : 'No active TURN lease'}</span>
            <span>{call.activeCall ? call.callRoom ? `${call.callRoom.participant_count} participant${call.callRoom.participant_count === 1 ? '' : 's'} in ${call.callRoom.backend}` : 'Membrane room is active and ready for join state' : 'A Membrane room spins up when a call becomes active'}</span>
            <span>{call.activeCall ? call.callWebRtcEndpoint ? call.callWebRtcEndpoint.exists ? `Membrane endpoint ${call.callWebRtcEndpoint.endpoint_id} ready \u2022 ${call.callWebRtcEndpoint.pending_media_event_count} queued event${call.callWebRtcEndpoint.pending_media_event_count === 1 ? '' : 's'}` : 'Membrane WebRTC endpoint not provisioned for this device yet' : 'Membrane WebRTC endpoint state not loaded yet' : 'Endpoint state appears after a call becomes active'}</span>
            <span>{call.activeCall ? `${call.callKeys.length} inbound call key distribution${call.callKeys.length === 1 ? '' : 's'} cached for this device` : 'Call key distributions appear after a call is active'}</span>
            <span>{call.membraneClientReady ? call.membraneClientConnected ? 'Native Membrane WebRTC client connected.' : 'Membrane client initialized and waiting for endpoint negotiation.' : 'Membrane browser client not initialized yet'}</span>
            <span>{call.membraneClientConnected ? `Membrane client connected as ${call.membraneClientEndpointId ?? 'pending'} \u2022 ${call.membraneRemoteEndpointCount} remote endpoint${call.membraneRemoteEndpointCount === 1 ? '' : 's'} \u2022 ${call.membraneRemoteTrackCount} remote track${call.membraneRemoteTrackCount === 1 ? '' : 's'}` : 'Connect the Membrane client after provisioning the endpoint.'}</span>
            <span>{call.membraneClientConnected ? `${call.membraneReadyTrackCount} ready native track${call.membraneReadyTrackCount === 1 ? '' : 's'} \u2022 ${call.membraneReadyAudioTrackCount} audio \u2022 ${call.membraneReadyVideoTrackCount} video` : 'Native remote track readiness appears after endpoint negotiation completes'}</span>
            <span>{call.membraneRemoteEndpointIds.length > 0 ? `Remote endpoint IDs: ${call.membraneRemoteEndpointIds.join(', ')}` : 'No remote Membrane endpoints announced yet'}</span>
            <span>{call.membraneRemoteTrackIds.length > 0 ? `Remote track IDs: ${call.membraneRemoteTrackIds.join(', ')}` : 'No remote Membrane tracks announced yet'}</span>
            <span>{call.localMediaMode === 'none' ? 'No local camera/microphone tracks attached' : `${call.localAudioTrackCount} local audio \u2022 ${call.localVideoTrackCount} local video`}</span>
            <span>{`${remoteAudioTrackCount} remote audio \u2022 ${remoteVideoTrackCount} remote video`}</span>
          </div>
          <div className="settings-card__actions">
            <button className="secondary-action" disabled={loading} onClick={federation.handleRefreshTurnCredentials} type="button">Refresh TURN Credentials</button>
            <button className="secondary-action" disabled={loading || !call.activeCall} onClick={call.handleProvisionMembraneWebRtcEndpoint} type="button">Provision Membrane Endpoint</button>
            <button className="secondary-action" disabled={loading || !call.activeCall} onClick={call.handleInitializeWebRtc} type="button">Initialize Native WebRTC</button>
            <button className="secondary-action" disabled={loading || !call.activeCall} onClick={() => call.handleAttachLocalMedia('audio')} type="button">Attach Microphone</button>
            <button className="secondary-action" disabled={loading || !call.activeCall} onClick={() => call.handleAttachLocalMedia('audio_video')} type="button">Attach Camera + Mic</button>
            <button className="secondary-action" disabled={loading || !activeChat} onClick={() => call.handleStartCall('voice')} type="button">Start Voice Call</button>
            <button className="secondary-action" disabled={loading || !activeChat} onClick={() => call.handleStartCall('video')} type="button">Start Video Call</button>
            <button className="secondary-action" disabled={loading || !call.activeCall} onClick={call.handlePingMembraneWebRtcEndpoint} type="button">Ping Membrane Endpoint</button>
            <button className="secondary-action" disabled={loading || !call.activeCall} onClick={call.handlePollMembraneWebRtcEndpoint} type="button">Poll Membrane Events</button>
            <button className="secondary-action" disabled={loading || !call.activeCall} onClick={call.handleJoinActiveCall} type="button">Join Membrane Room</button>
            <button className="secondary-action" disabled={loading || !call.activeCall} onClick={call.handleRotateCallKeyEpoch} type="button">Rotate Call Key Epoch</button>
            <button className="secondary-action" disabled={loading || !call.activeCall} onClick={call.handleLeaveActiveCall} type="button">Leave Room</button>
            <button className="secondary-action" disabled={loading || (!call.activeCall && call.localMediaMode === 'none')} onClick={call.handleReleaseLocalMedia} type="button">Release Local Media</button>
            <button className="danger-action" disabled={loading || !call.activeCall} onClick={call.handleEndCall} type="button">End Active Call</button>
          </div>
          <div className="settings-card__list">
            {call.callParticipants.length > 0 ? (call.callParticipants.map((participant) => (
              <div className="settings-card__row" key={participant.id}><div className="settings-card__row-main"><strong>{participant.device_id === storedDevice?.deviceId ? 'This device' : participant.device_id}</strong><span>{participant.status} &bull; {participant.track_kind}</span></div><span className="call-room-pill">{participant.left_at ? 'Left' : 'Live'}</span></div>
            ))) : federation.turnCredentials?.uris.length ? (federation.turnCredentials.uris.map((uri) => (
              <div className="settings-card__row" key={uri}><div className="settings-card__row-main"><strong>Relay</strong><span>{uri}</span></div></div>
            ))) : (<span className="settings-card__muted">No relay URIs loaded.</span>)}
          </div>
          <div className="settings-card__list">
            {call.callKeys.length > 0 ? (call.callKeys.slice(0, 4).map((distribution) => (
              <div className="settings-card__row" key={distribution.id}><div className="settings-card__row-main"><strong>Epoch {distribution.key_epoch}</strong><span>{distribution.algorithm} &bull; {distribution.status}</span><span>{distribution.owner_device_id === storedDevice?.deviceId ? 'owned by this device' : `owner ${distribution.owner_device_id}`}</span></div></div>
            ))) : (<span className="settings-card__muted">No call key distributions fetched yet.</span>)}
          </div>
          <div className="settings-card__list">
            {call.callSignals.length > 0 ? (call.callSignals.slice(-4).reverse().map((signal) => (
              <div className="settings-card__row" key={signal.id}><div className="settings-card__row-main"><strong>{signal.signal_type}</strong><span>{signal.from_device_id === storedDevice?.deviceId ? 'This device' : signal.from_device_id}{' \u2022 '}{formatRelativeTime(signal.inserted_at)}</span><span>{truncateSignalPayload(signal.payload)}</span></div></div>
            ))) : (<span className="settings-card__muted">No call signals recorded yet.</span>)}
          </div>
          <div className="settings-card__list">
            {call.featuredRemoteTrack ? (
              <div className="settings-card__row">
                <div className="settings-card__row-main">
                  <strong>{dominantRemoteEndpoint ? `Featured remote: ${dominantRemoteEndpoint.username ?? dominantRemoteEndpoint.deviceId ?? dominantRemoteEndpoint.id}` : 'Featured remote track'}</strong>
                  <span>{call.featuredRemoteTrack.kind ? `${call.featuredRemoteTrack.kind} track` : 'Unknown track'}{' \u2022 '}{call.featuredRemoteTrack.endpointId}{call.featuredRemoteTrack.source ? ` \u2022 ${call.featuredRemoteTrack.source}` : ''}</span>
                  <RemoteMembraneTrackPreview featured track={call.featuredRemoteTrack} />
                </div>
                <span className="call-room-pill">{call.dominantRemoteEndpointId ? 'Dominant' : 'Live'}</span>
              </div>
            ) : null}
            {call.membraneRemoteEndpoints.length > 0 ? (call.membraneRemoteEndpoints.slice(0, 4).map((endpoint) => (
              <div className="settings-card__row" key={`remote-endpoint-${endpoint.id}`}><div className="settings-card__row-main"><strong>{endpoint.username ? `${endpoint.username} (${endpoint.deviceId ?? endpoint.id})` : endpoint.deviceId ?? endpoint.id}</strong><span>{endpoint.type} &bull; {endpoint.trackIds.length} announced track{endpoint.trackIds.length === 1 ? '' : 's'}</span></div><span className="call-room-pill">{endpoint.id === call.dominantRemoteEndpointId ? 'Dominant' : 'Remote'}</span></div>
            ))) : null}
            {call.membraneRemoteTracks.length > 0 ? (call.membraneRemoteTracks.slice(0, 6).map((track) => (
              <div className="settings-card__row" key={`remote-track-${track.id}`}><div className="settings-card__row-main"><strong>{track.kind ? `${track.kind} track` : 'Unknown track'}</strong><span>{track.endpointId}{track.source ? ` \u2022 ${track.source}` : ''}</span>{track.voiceActivity ? (<span>Voice activity: {track.voiceActivity}</span>) : null}<span>{track.id}</span><RemoteMembraneTrackPreview track={track} /></div><span className="call-room-pill">{track.ready ? (track.voiceActivity === 'speech' ? 'Speaking' : 'Ready') : 'Negotiating'}</span></div>
            ))) : null}
            <div className="settings-card__row"><div className="settings-card__row-main"><strong>Membrane endpoint</strong><span>{call.callWebRtcEndpoint ? `${call.callWebRtcEndpoint.endpoint_id} \u2022 ${call.callWebRtcEndpoint.exists ? 'provisioned' : 'missing'}` : 'No per-device Membrane endpoint loaded'}</span><span>{call.callRoom ? `${call.callRoom.endpoint_count ?? 0} engine endpoints \u2022 ${call.callRoom.webrtc_endpoint_count ?? 0} WebRTC endpoint${(call.callRoom.webrtc_endpoint_count ?? 0) === 1 ? '' : 's'}` : 'Room metrics unavailable'}</span></div></div>
            {call.callWebRtcMediaEvents.length > 0 ? (call.callWebRtcMediaEvents.map((eventPayload, index) => (
              <div className="settings-card__row" key={`${index}-${eventPayload}`}><div className="settings-card__row-main"><strong>Membrane event</strong><span>{truncateSignalPayload(eventPayload)}</span></div></div>
            ))) : (<span className="settings-card__muted">No outbound Membrane endpoint events polled yet.</span>)}
          </div>
        </GlassSurface>
        <CallSurface mode={call.activeCall ? 'active' : 'minimized'} flavor={call.activeCall?.mode === 'video' ? 'video' : call.activeCall?.mode === 'group' ? 'group' : 'voice'} />
      </aside>
    </div>
  )
}

function App() {
  return (
    <AppProvider>
      <AppInner />
    </AppProvider>
  )
}

export default App
