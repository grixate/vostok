/**
 * Device-to-device history sync hook.
 *
 * Handles the full sync protocol:
 * - Requester: request sync, receive chunks, insert into local IDB
 * - Provider: accept sync, stream chunks from local IDB
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import type { Channel } from 'phoenix'
import { useAppContext } from '../contexts/AppContext.tsx'
import {
  readCachedMessages,
  readCachedConversations,
  readCachedContacts,
  writeCachedMessages,
  writeCachedConversation,
  writeCachedContact,
} from '../lib/message-cache.ts'
import type { CachedMessage, CachedConversation, CachedContact } from '../lib/message-cache.ts'
import {
  chunkMessages,
  decodeSyncChunk,
  encodeSyncChunk,
} from '../lib/sync-codec.ts'
import type { SyncChunk, SyncProgress } from '../lib/sync-codec.ts'

export type SyncState =
  | 'idle'
  | 'requesting'      // Waiting for a provider to accept
  | 'syncing'          // Actively receiving/sending chunks
  | 'completed'
  | 'error'

export type SyncRole = 'requester' | 'provider' | null

export type PendingSyncRequest = {
  requestingDeviceId: string
  scope: string
}

export function useDeviceSync(userChannel: Channel | null) {
  const { storedDevice } = useAppContext()
  const [syncState, setSyncState] = useState<SyncState>('idle')
  const [syncRole, setSyncRole] = useState<SyncRole>(null)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const [pendingRequest, setPendingRequest] = useState<PendingSyncRequest | null>(null)
  const [error, setError] = useState<string | null>(null)

  const targetDeviceIdRef = useRef<string | null>(null)
  const sequenceRef = useRef(0)
  const currentDeviceId = storedDevice?.deviceId ?? null

  const handleReceivedChunk = useCallback(async (encodedChunk: string) => {
    try {
      const chunk = decodeSyncChunk(encodedChunk)
      sequenceRef.current = chunk.sequence

      switch (chunk.type) {
        case 'conversations': {
          const conversations = chunk.data as CachedConversation[]
          for (const conv of conversations) {
            await writeCachedConversation(conv)
          }
          setProgress({
            synced: conversations.length,
            total: 0,
            currentType: 'conversations',
          })
          break
        }

        case 'messages': {
          const messages = chunk.data as CachedMessage[]
          const chatId = chunk.chatId
          if (chatId && messages.length > 0) {
            // Merge with any existing cached messages
            const existing = await readCachedMessages(chatId)
            const existingIds = new Set(existing.map((m) => m.id))
            const newMessages = messages.filter((m) => !existingIds.has(m.id))
            if (newMessages.length > 0) {
              await writeCachedMessages(chatId, [...existing, ...newMessages])
            }
          }
          setProgress((prev) => ({
            synced: (prev?.synced ?? 0) + messages.length,
            total: prev?.total ?? 0,
            currentType: 'messages',
            currentConversation: chatId,
          }))
          break
        }

        case 'contacts': {
          const contacts = chunk.data as CachedContact[]
          for (const contact of contacts) {
            await writeCachedContact(contact)
          }
          setProgress((prev) => ({
            synced: (prev?.synced ?? 0) + contacts.length,
            total: prev?.total ?? 0,
            currentType: 'contacts',
          }))
          break
        }
      }
    } catch (err) {
      console.error('[DeviceSync] Failed to process chunk:', err)
    }
  }, [])

  const streamSyncData = useCallback(async (channel: Channel, targetDeviceId: string) => {
    let seq = 0

    // 1. Stream conversations
    const conversations = await readCachedConversations()
    if (conversations.length > 0) {
      const chunk: SyncChunk = {
        type: 'conversations',
        sequence: seq++,
        data: conversations,
        isLast: true,
      }
      channel.push('sync.data', {
        target_device_id: targetDeviceId,
        chunk: encodeSyncChunk(chunk),
      })
      setProgress({ synced: 0, total: conversations.length, currentType: 'conversations' })
    }

    // 2. Stream messages per conversation
    for (const conv of conversations) {
      const messages = await readCachedMessages(conv.id)
      if (messages.length === 0) continue

      const chunks = chunkMessages(conv.id, messages, seq)
      for (const chunk of chunks) {
        channel.push('sync.data', {
          target_device_id: targetDeviceId,
          chunk: encodeSyncChunk(chunk),
        })
        seq = chunk.sequence + 1

        setProgress({
          synced: seq,
          total: conversations.length,
          currentType: 'messages',
          currentConversation: conv.title ?? conv.id,
        })

        // Small delay to avoid flooding the channel
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
    }

    // 3. Stream contacts
    const contacts = await readCachedContacts()
    if (contacts.length > 0) {
      const chunk: SyncChunk = {
        type: 'contacts',
        sequence: seq++,
        data: contacts,
        isLast: true,
      }
      channel.push('sync.data', {
        target_device_id: targetDeviceId,
        chunk: encodeSyncChunk(chunk),
      })
    }

  }, [])

  // ── Listen for sync events on the user channel ──────────────────────

  useEffect(() => {
    if (!userChannel) return

    const syncRequestRef = userChannel.on('sync.request', (payload: unknown) => {
      const { requesting_device_id, scope } = payload as { requesting_device_id: string; scope: string }
      if (!currentDeviceId || requesting_device_id === currentDeviceId) {
        return
      }

      // Another device wants to sync — show prompt to user
      setPendingRequest({
        requestingDeviceId: requesting_device_id,
        scope,
      })
    })

    const syncAcceptedRef = userChannel.on('sync.accepted', (payload: unknown) => {
      const { provider_device_id, requesting_device_id } = payload as {
        provider_device_id: string
        requesting_device_id: string
      }

      if (!currentDeviceId || requesting_device_id !== currentDeviceId) {
        return
      }

      // Our sync request was accepted — start receiving
      if (syncState === 'requesting') {
        targetDeviceIdRef.current = provider_device_id
        setSyncState('syncing')
        setSyncRole('requester')
      }
    })

    const syncDataRef = userChannel.on('sync.data', (payload: unknown) => {
      const { chunk, from_device_id, target_device_id } = payload as {
        from_device_id: string
        target_device_id?: string
        chunk: string
      }

      if (currentDeviceId && target_device_id && target_device_id !== currentDeviceId) {
        return
      }

      if (targetDeviceIdRef.current && from_device_id !== targetDeviceIdRef.current) {
        return
      }

      handleReceivedChunk(chunk)
    })

    const syncCompleteRef = userChannel.on('sync.complete', (payload: unknown) => {
      const {
        requesting_device_id,
        provider_device_id,
      } = payload as {
        requesting_device_id?: string
        provider_device_id?: string
      }

      if (!currentDeviceId) {
        return
      }

      if (currentDeviceId !== requesting_device_id && currentDeviceId !== provider_device_id) {
        return
      }

      setSyncState('completed')
      setProgress(null)
    })

    return () => {
      userChannel.off('sync.request', syncRequestRef)
      userChannel.off('sync.accepted', syncAcceptedRef)
      userChannel.off('sync.data', syncDataRef)
      userChannel.off('sync.complete', syncCompleteRef)
    }
  }, [currentDeviceId, handleReceivedChunk, syncState, userChannel])

  // ── Requester: request sync from another device ─────────────────────

  const requestSync = useCallback((scope: 'full' | 'recent_30d' = 'full') => {
    if (!userChannel) return

    setSyncState('requesting')
    setSyncRole('requester')
    setError(null)
    setPendingRequest(null)
    targetDeviceIdRef.current = null

    userChannel.push('sync.request', { scope })
  }, [userChannel])

  // ── Provider: accept a sync request and start streaming ─────────────

  const acceptSync = useCallback(async (requestingDeviceId: string) => {
    if (!userChannel) return

    setSyncState('syncing')
    setSyncRole('provider')
    setError(null)
    targetDeviceIdRef.current = requestingDeviceId
    setPendingRequest(null)

    // Notify requester
    userChannel.push('sync.accept', { requesting_device_id: requestingDeviceId })

    // Start streaming data
    try {
      await streamSyncData(userChannel, requestingDeviceId)
      userChannel.push('sync.complete', { requesting_device_id: requestingDeviceId })
      setSyncState('completed')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed')
      setSyncState('error')
    }
  }, [streamSyncData, userChannel])

  // ── Dismiss a pending sync request ──────────────────────────────────

  const dismissRequest = useCallback(() => {
    setPendingRequest(null)
  }, [])

  const resetSync = useCallback(() => {
    setSyncState('idle')
    setSyncRole(null)
    setProgress(null)
    setError(null)
    setPendingRequest(null)
    targetDeviceIdRef.current = null
    sequenceRef.current = 0
  }, [])

  return {
    syncState,
    syncRole,
    progress,
    pendingRequest,
    error,
    requestSync,
    acceptSync,
    dismissRequest,
    resetSync,
  }
}
