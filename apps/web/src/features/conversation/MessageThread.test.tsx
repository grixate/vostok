import { createElement, createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { MessageThread } from './MessageThread.tsx'
import { formatRelativeTime } from '../../utils/format.ts'

vi.mock('@vostok/ui-chat', () => ({
  MessageBubble: ({ timestamp, children }: { timestamp?: string; children?: unknown }) =>
    createElement(
      'div',
      { className: 'message-bubble-mock' },
      createElement('span', null, timestamp),
      children as never
    )
}))

vi.mock('../../contexts/AppContext.tsx', () => ({
  useAppContext: () => ({
    storedDevice: { username: 'me' }
  })
}))

vi.mock('../../contexts/UIContext.tsx', () => ({
  useUIContext: () => ({
    contextMenuMessage: null,
    setContextMenuMessage: vi.fn(),
    draftInputRef: createRef<HTMLTextAreaElement>()
  })
}))

vi.mock('../../hooks/useProfilePhotos.ts', () => ({
  useProfilePhotos: () => new Map<string, string>()
}))

describe('MessageThread edited timestamp label', () => {
  it('renders edited label as "edited · time"', () => {
    const sentAt = '2026-04-13T09:15:00.000Z'
    const expectedTime = formatRelativeTime(sentAt)
    const expectedMeta = `edited · ${expectedTime}`

    const markup = renderToStaticMarkup(
      <MessageThread
        messages={{
          messageItems: [
            {
              id: 'message-1',
              clientId: 'client-1',
              text: 'Edited message body',
              sentAt,
              editedAt: '2026-04-13T09:16:00.000Z',
              side: 'outgoing',
              senderUsername: 'me',
              decryptable: true
            }
          ],
          linkMetadataByUrl: {},
          hasMoreMessages: false,
          loadingOlder: false,
          loadOlderMessages: vi.fn(),
          handleReplyToMessage: vi.fn()
        } as never}
        media={{
          attachmentPlaybackUrls: {},
          handleDownloadAttachment: vi.fn()
        } as never}
        downloadManager={{
          getState: vi.fn(() => ({ status: 'idle' })),
          processAutoDownloads: vi.fn(),
          playbackUrls: {},
          download: vi.fn(),
          cancel: vi.fn()
        } as never}
        activeChat={{
          id: 'chat-1',
          type: 'direct',
          title: 'Alice',
          participant_usernames: ['me', 'alice'],
          participant_user_ids: ['device-me', 'device-alice'],
          is_self_chat: false,
          latest_message_at: null,
          message_count: 0
        }}
        chatType="direct"
      />
    )

    expect(markup).toContain(expectedMeta)
    expect(markup).not.toContain(`${expectedTime} edited`)
  })
})
