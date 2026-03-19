import { useState, useEffect, useRef } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import type { ChatDeviceSession, ChatSummary, PrekeyDeviceBundle, RecipientDevice } from '../lib/api.ts'
import {
  bootstrapChatSessions,
  fetchUserPrekeys,
  listRecipientDevices,
  listSafetyNumbers,
  rekeyChatSessions,
  verifySafetyNumber
} from '../lib/api.ts'
import {
  prepareSessionBootstrap,
  pruneConsumedOneTimePrekeys,
  synchronizeChatSessions
} from '../lib/chat-session-vault.ts'
import { toLocalSessionDeviceMaterial } from '../utils/crypto-helpers.ts'
import { toSafetyNumberEntry } from '../utils/safety-helpers.ts'
import { persistStoredDevice } from '../utils/storage.ts'
import type { AuthView, SafetyNumberEntry, StoredDevice } from '../types.ts'

export function useChatSessions(
  view: AuthView,
  deferredActiveChatId: string | null,
  activeChatIdRef: React.RefObject<string | null>,
  chatItems: ChatSummary[]
) {
  const { storedDevice, setStoredDevice, loading, setLoading, setBanner } = useAppContext()
  const [chatSessions, setChatSessions] = useState<ChatDeviceSession[]>([])
  const [safetyNumbers, setSafetyNumbers] = useState<SafetyNumberEntry[]>([])
  const [verifyingSafetyDeviceId, setVerifyingSafetyDeviceId] = useState<string | null>(null)
  const [_remotePrekeyBundles, setRemotePrekeyBundles] = useState<PrekeyDeviceBundle[]>([])

  async function syncChatSessionsFromServer(
    chatId: string,
    knownRecipientDevices?: RecipientDevice[]
  ): Promise<ChatDeviceSession[]> {
    if (!storedDevice || activeChatIdRef.current !== chatId) {
      return []
    }

    const recipientDevices =
      knownRecipientDevices ??
      (await listRecipientDevices(storedDevice.sessionToken, chatId)).recipient_devices
    const bootstrapTargetDeviceIds = recipientDevices
      .filter((device) => {
        // Only bootstrap devices that don't already have a non-superseded session.
        // Checking `establishment_state` here is wrong: the initiator can encrypt
        // as soon as the session exists (epoch 0), but `establishment_state` stays
        // "pending" until the recipient confirms.  Re-bootstrapping a pending
        // session generates new ephemeral keys → the handshake hash changes →
        // synchronizeChatSessions sees a hash mismatch and advances the epoch to 1,
        // which the recipient can't decrypt because their root key is still at
        // epoch 0.
        const existingSession = chatSessions.find(
          (session) =>
            session.chat_id === chatId &&
            session.initiator_device_id === storedDevice.deviceId &&
            session.recipient_device_id === device.device_id &&
            session.session_state !== 'superseded'
        )

        return !existingSession
      })
      .map((device) => device.device_id)
    if (bootstrapTargetDeviceIds.length === 0) {
      console.info(
        `[syncChatSessions] All outbound sessions exist for chat ${chatId}. ` +
        `Calling bootstrap with empty keys to discover inbound sessions.`
      )
    } else {
      console.info(
        `[syncChatSessions] Bootstrapping ${bootstrapTargetDeviceIds.length} device(s) for chat ${chatId}: ${bootstrapTargetDeviceIds.join(', ')}. ` +
        `Existing sessions in state: ${chatSessions.filter((s) => s.chat_id === chatId).length}`
      )
    }

    // Always call the bootstrap endpoint — even when all outbound sessions exist.
    // The server returns both outbound AND inbound sessions (sessions where the
    // peer is the initiator and WE are the recipient).  Without calling the
    // endpoint, we never discover inbound sessions and can't decrypt messages
    // sent by the peer using their session keys.
    const initiatorEphemeralKeys = bootstrapTargetDeviceIds.length > 0
      ? await prepareSessionBootstrap(bootstrapTargetDeviceIds)
      : {}
    const response = await bootstrapChatSessions(storedDevice.sessionToken, chatId, {
      initiator_ephemeral_keys: initiatorEphemeralKeys
    })

    console.info(
      `[syncChatSessions] Bootstrap returned ${response.sessions.length} session(s) for chat ${chatId}. ` +
      `Local device=${storedDevice.deviceId}. Sessions: ${response.sessions.map(
        (s) => `${s.id}(init=${s.initiator_device_id},recip=${s.recipient_device_id},state=${s.session_state},est=${s.establishment_state},hasEph=${!!s.initiator_ephemeral_public_key})`
      ).join(', ')}`
    )

    const synchronizedIds = await synchronizeChatSessions(
      toLocalSessionDeviceMaterial(storedDevice),
      response.sessions
    )

    console.info(
      `[syncChatSessions] Synchronized ${synchronizedIds.length}/${response.sessions.length} session(s): ${synchronizedIds.join(', ')}`
    )

    const activeSessions = response.sessions.filter((session) => synchronizedIds.includes(session.id))
    const consumedOneTimePrekeys = pruneConsumedOneTimePrekeys(
      storedDevice.deviceId,
      response.sessions,
      storedDevice.oneTimePrekeys ?? []
    )

    if (consumedOneTimePrekeys.consumedPublicKeys.length > 0) {
      const nextStoredDevice: StoredDevice = {
        ...storedDevice,
        oneTimePrekeys: consumedOneTimePrekeys.nextOneTimePrekeys
      }

      persistStoredDevice(nextStoredDevice)

      if (activeChatIdRef.current === chatId) {
        setStoredDevice(nextStoredDevice)
      }
    }

    if (activeChatIdRef.current === chatId) {
      setChatSessions(activeSessions)
    }

    return activeSessions
  }

  async function _handleRekeyActiveChatSessions(activeChatId: string | null) {
    if (!storedDevice || !activeChatId) {
      setBanner({ tone: 'error', message: 'Select a chat before rekeying direct-chat sessions.' })
      return
    }

    setLoading(true)

    try {
      const recipientDevices = (await listRecipientDevices(storedDevice.sessionToken, activeChatId))
        .recipient_devices
      const initiatorEphemeralKeys = await prepareSessionBootstrap(
        recipientDevices.map((device) => device.device_id)
      )
      const response = await rekeyChatSessions(storedDevice.sessionToken, activeChatId, {
        initiator_ephemeral_keys: initiatorEphemeralKeys
      })
      const synchronizedIds = await synchronizeChatSessions(
        toLocalSessionDeviceMaterial(storedDevice),
        response.sessions
      )
      const updatedSessions = response.sessions.filter((session) => synchronizedIds.includes(session.id))
      const consumedOneTimePrekeys = pruneConsumedOneTimePrekeys(
        storedDevice.deviceId,
        response.sessions,
        storedDevice.oneTimePrekeys ?? []
      )
      const mergedSessions = [
        ...chatSessions.filter(
          (existing) =>
            !updatedSessions.some(
              (next) =>
                next.chat_id === existing.chat_id &&
                next.initiator_device_id === existing.initiator_device_id &&
                next.recipient_device_id === existing.recipient_device_id
            )
        ),
        ...updatedSessions
      ]

      if (consumedOneTimePrekeys.consumedPublicKeys.length > 0) {
        const nextStoredDevice: StoredDevice = {
          ...storedDevice,
          oneTimePrekeys: consumedOneTimePrekeys.nextOneTimePrekeys
        }

        persistStoredDevice(nextStoredDevice)

        if (activeChatIdRef.current === activeChatId) {
          setStoredDevice(nextStoredDevice)
        }
      }

      if (activeChatIdRef.current === activeChatId) {
        setChatSessions(mergedSessions)
      }

      setBanner({
        tone: 'success',
        message: `Rekeyed ${updatedSessions.length} direct-chat session ${
          updatedSessions.length === 1 ? 'record' : 'records'
        }.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rekey chat sessions.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  // Load remote prekeys
  useEffect(() => {
    if (!storedDevice || view !== 'chat') {
      setRemotePrekeyBundles([])
      return
    }

    const selectedChat = chatItems.find((chat) => chat.id === deferredActiveChatId) ?? chatItems[0] ?? null

    if (!selectedChat) {
      setRemotePrekeyBundles([])
      return
    }

    const targetUsername =
      selectedChat.participant_usernames.find((participant) => participant !== storedDevice.username) ??
      storedDevice.username
    const sessionToken = storedDevice.sessionToken

    let cancelled = false

    async function loadRemotePrekeys() {
      try {
        const response = await fetchUserPrekeys(sessionToken, targetUsername)

        if (!cancelled) {
          setRemotePrekeyBundles(response.devices)
        }
      } catch {
        if (!cancelled) {
          setRemotePrekeyBundles([])
        }
      }
    }

    void loadRemotePrekeys()

    return () => {
      cancelled = true
    }
  }, [chatItems, deferredActiveChatId, storedDevice, view])

  // Load safety numbers
  useEffect(() => {
    if (!storedDevice || !deferredActiveChatId || view !== 'chat') {
      setSafetyNumbers([])
      return
    }

    const sessionToken = storedDevice.sessionToken
    const chatId = deferredActiveChatId
    let cancelled = false

    async function loadSafetyNumbersForChat() {
      try {
        const response = await listSafetyNumbers(sessionToken, chatId)

        if (!cancelled) {
          setSafetyNumbers(response.safety_numbers.map(toSafetyNumberEntry))
        }
      } catch {
        if (!cancelled) {
          setSafetyNumbers([])
        }
      }
    }

    void loadSafetyNumbersForChat()

    return () => {
      cancelled = true
    }
  }, [deferredActiveChatId, storedDevice, view])

  async function handleVerifyPeerSafetyNumber(peerDeviceId: string, activeChatId: string | null) {
    if (!storedDevice || !activeChatId) {
      return
    }

    setVerifyingSafetyDeviceId(peerDeviceId)

    try {
      const response = await verifySafetyNumber(storedDevice.sessionToken, activeChatId, peerDeviceId)
      setSafetyNumbers((current) =>
        current.map((entry) =>
          entry.peerDeviceId === response.safety_number.peer_device_id
            ? toSafetyNumberEntry(response.safety_number)
            : entry
        )
      )
      setBanner({
        tone: 'success',
        message: `Verified safety number for ${response.safety_number.peer_device_name}.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to verify safety number.'
      setBanner({ tone: 'error', message })
    } finally {
      setVerifyingSafetyDeviceId(null)
    }
  }

  return {
    chatSessions,
    setChatSessions,
    safetyNumbers,
    verifyingSafetyDeviceId,
    syncChatSessionsFromServer,
    _handleRekeyActiveChatSessions,
    handleVerifyPeerSafetyNumber,
    setRemotePrekeyBundles,
    setSafetyNumbers
  }
}
