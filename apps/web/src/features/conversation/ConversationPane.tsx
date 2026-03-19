import { useState, useCallback } from 'react'
import { ConversationHeader } from './ConversationHeader.tsx'
import { ChatSearchBar } from './ChatSearchBar.tsx'
import { MessageThread } from './MessageThread.tsx'
import { ComposerBar } from './ComposerBar.tsx'
import { ChatProfilePane } from './ChatProfilePane.tsx'
import type { useGroupChat } from '../../hooks/useGroupChat.ts'
import type { useCall } from '../../hooks/useCall.ts'
import type { useViewportLayout } from '../../hooks/useViewportLayout.ts'
import type { useMessages } from '../../hooks/useMessages.ts'
import type { useMediaCapture } from '../../hooks/useMediaCapture.ts'
import type { useChatList } from '../../hooks/useChatList.ts'
import type { useDrafts } from '../../hooks/useDrafts.ts'
import type { useTypingIndicator } from '../../hooks/useTypingIndicator.ts'
import type { ChatSummary } from '../../lib/api.ts'

type ConversationPaneProps = {
  activeChat: ChatSummary | null
  groupChat: ReturnType<typeof useGroupChat>
  call: ReturnType<typeof useCall>
  layout: ReturnType<typeof useViewportLayout>
  messages: ReturnType<typeof useMessages>
  media: ReturnType<typeof useMediaCapture>
  chatList: ReturnType<typeof useChatList>
  drafts: ReturnType<typeof useDrafts>
  typingIndicator: ReturnType<typeof useTypingIndicator>
  initialSelectedMessageId?: string | null
}

export function ConversationPane({
  activeChat,
  groupChat,
  call,
  layout,
  messages,
  media,
  chatList,
  drafts,
  typingIndicator,
  initialSelectedMessageId
}: ConversationPaneProps) {
  const [searchHighlight, setSearchHighlight] = useState<{ query: string; activeMessageId?: string } | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const handleSearchHighlightChange = useCallback((highlight: { query: string; activeMessageId?: string } | null) => {
    setSearchHighlight(highlight)
  }, [])

  const handleClickTitle = useCallback(() => {
    setProfileOpen(true)
  }, [])

  const handleCloseProfile = useCallback(() => {
    setProfileOpen(false)
  }, [])

  // ─── Drag-and-drop file upload ─────────────────────────────────────────────
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      setDragOver(true)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only clear if actually leaving the pane (not entering a child)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (e.clientX <= rect.left || e.clientX >= rect.right || e.clientY <= rect.top || e.clientY >= rect.bottom) {
      setDragOver(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const files = e.dataTransfer.files
    if (files.length > 0 && media.fileInputRef.current) {
      // Create a synthetic change event by assigning files
      const dt = new DataTransfer()
      for (let i = 0; i < files.length; i++) {
        dt.items.add(files[i])
      }
      media.fileInputRef.current.files = dt.files
      media.fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }, [media.fileInputRef])

  if (activeChat && profileOpen) {
    return (
      <main className="conversation-pane">
        <ChatProfilePane
          activeChat={activeChat}
          groupChat={groupChat}
          onClose={handleCloseProfile}
        />
      </main>
    )
  }

  return (
    <main
      className="conversation-pane"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ConversationHeader
        activeChat={activeChat}
        groupChat={groupChat}
        call={call}
        layout={layout}
        typingUsers={typingIndicator.typingUsers}
        onClickTitle={handleClickTitle}
      />
      <ChatSearchBar
        messageItems={messages.messageItems}
        onSearchHighlightChange={handleSearchHighlightChange}
      />
      <MessageThread
        messages={messages}
        media={media}
        activeChat={activeChat}
        searchHighlight={searchHighlight}
        initialSelectedMessageId={initialSelectedMessageId}
      />
      <ComposerBar
        messages={messages}
        media={media}
        activeChat={activeChat}
        chatList={chatList}
        onDraftChange={drafts.handleDraftChange}
        onMessageSent={drafts.handleMessageSent}
      />
      {dragOver ? (
        <div className="drag-drop-overlay">
          <div className="drag-drop-overlay__zone">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4M12 4L8 8M12 4L16 8" />
              <path d="M20 21H4" />
              <path d="M20 16V21" />
              <path d="M4 16V21" />
            </svg>
            <span>Drop files to send</span>
          </div>
        </div>
      ) : null}
    </main>
  )
}
