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
  typingIndicator
}: ConversationPaneProps) {
  const [searchHighlight, setSearchHighlight] = useState<{ query: string; activeMessageId?: string } | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)

  const handleSearchHighlightChange = useCallback((highlight: { query: string; activeMessageId?: string } | null) => {
    setSearchHighlight(highlight)
  }, [])

  const handleClickTitle = useCallback(() => {
    setProfileOpen(true)
  }, [])

  const handleCloseProfile = useCallback(() => {
    setProfileOpen(false)
  }, [])

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
    <main className="conversation-pane">
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
      />
      <ComposerBar
        messages={messages}
        media={media}
        activeChat={activeChat}
        chatList={chatList}
        onDraftChange={drafts.handleDraftChange}
        onMessageSent={drafts.handleMessageSent}
      />
    </main>
  )
}
