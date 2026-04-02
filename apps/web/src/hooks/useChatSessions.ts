import { useState, useEffect } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import type { ChatDeviceSession, PrekeyDeviceBundle, RecipientDevice } from '../lib/api.ts'
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
import { getRawChatId, type MergedChatSummary } from '../lib/multi-server.ts'
import type { AuthView, SafetyNumberEntry, StoredDevice } from '../types.ts'

export function useChatSessions(
  view: AuthView,
  deferredActiveChatId: string | null,
  activeChatIdRef: React.RefObject<string | null>,
  chatItems: MergedChatSummary[]
) {
  const { sessionToken, storedDevice, setStoredDevice, setLoading, setBanner } = useAppContext()
  const [chatSessions, setChatSessions] = useState<ChatDeviceSession[]>([])
  const [safetyNumbers, setSafetyNumbers] = useState<SafetyNumberEntry[]>([])
  const [verifyingSafetyDeviceId, setVerifyingSafetyDeviceId] = useState<string | null>(null)
  const [, setRemotePrekeyBundles] = useState<PrekeyDeviceBundle[]>([])
  const selectedChat = chatItems.find((chat) => chat.id === deferredActiveChatId) ?? chatItems[0] ?? null
  const remotePrekeyUsername =
    selectedChat && storedDevice
      ? (selectedChat.participant_usernames.find((participant) => participant !== storedDevice.username) ??
          storedDevice.username)
      : null

  async function syncChatSessionsFromServer(
    chatId: string,
    knownRecipientDevices?: RecipientDevice[]
  ): Promise<ChatDeviceSession[]> {
    const rawChatId = getRawChatId(chatId)

    if (!rawChatId) {
      return []
    }

    if (!sessionToken || !storedDevice || activeChatIdRef.current !== chatId) {
      return []
    }

    const recipientDevices =
      knownRecipientDevices ??
      (await listRecipientDevices(sessionToken, rawChatId)).recipient_devices
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
            session.chat_id === rawChatId &&
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
        `Existing sessions in state: ${chatSessions.filter((s) => s.chat_id === rawChatId).length}`
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
    const response = await bootstrapChatSessions(sessionToken, rawChatId, {
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
    const rawActiveChatId = getRawChatId(activeChatId)

    if (!sessionToken || !storedDevice || !activeChatId || !rawActiveChatId) {
      setBanner({ tone: 'error', message: 'Select a chat before rekeying direct-chat sessions.' })
      return
    }

    setLoading(true)

    try {
      const recipientDevices = (await listRecipientDevices(sessionToken, rawActiveChatId))
        .recipient_devices
      const initiatorEphemeralKeys = await prepareSessionBootstrap(
        recipientDevices.map((device) => device.device_id)
      )
      const response = await rekeyChatSessions(sessionToken, rawActiveChatId, {
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
    if (!sessionToken || !storedDevice || view !== 'chat') {
      setRemotePrekeyBundles([])
      return
    }

    if (!remotePrekeyUsername) {
      setRemotePrekeyBundles([])
      return
    }

    const token = sessionToken
    if (!token) {
      setRemotePrekeyBundles([])
      return
    }

    const username = remotePrekeyUsername
    let cancelled = false

    async function loadRemotePrekeys() {
      try {
        const response = await fetchUserPrekeys(token, username)

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
  }, [remotePrekeyUsername, sessionToken, storedDevice, view])

  // Load safety numbers
  useEffect(() => {
    if (!sessionToken || !deferredActiveChatId || view !== 'chat') {
      setSafetyNumbers([])
      return
    }

    const token2 = sessionToken
    const chatId = deferredActiveChatId
    const rawChatId = getRawChatId(chatId)

    if (!rawChatId) {
      setSafetyNumbers([])
      return
    }

    const targetChatId = rawChatId
    let cancelled = false

    async function loadSafetyNumbersForChat() {
      try {
        const response = await listSafetyNumbers(token2, targetChatId)

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
  }, [deferredActiveChatId, sessionToken, view])

  async function handleVerifyPeerSafetyNumber(peerDeviceId: string, activeChatId: string | null) {
    const rawActiveChatId = getRawChatId(activeChatId)

    if (!sessionToken || !activeChatId || !rawActiveChatId) {
      return
    }

    setVerifyingSafetyDeviceId(peerDeviceId)

    try {
      const response = await verifySafetyNumber(sessionToken, rawActiveChatId, peerDeviceId)
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
