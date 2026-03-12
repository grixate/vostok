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
        const existingSession = chatSessions.find(
          (session) =>
            session.chat_id === chatId &&
            session.initiator_device_id === storedDevice.deviceId &&
            session.recipient_device_id === device.device_id &&
            session.session_state !== 'superseded'
        )

        return !existingSession || existingSession.establishment_state !== 'established'
      })
      .map((device) => device.device_id)
    // All sessions are already established — skip the bootstrap API call entirely.
    // Calling bootstrap with an empty initiator_ephemeral_keys map is rejected by the
    // server, and there is nothing new to synchronise anyway.
    if (bootstrapTargetDeviceIds.length === 0) {
      const establishedSessions = chatSessions.filter(
        (session) =>
          session.chat_id === chatId &&
          session.initiator_device_id === storedDevice.deviceId &&
          session.session_state !== 'superseded' &&
          session.establishment_state === 'established'
      )
      return establishedSessions
    }

    const initiatorEphemeralKeys = await prepareSessionBootstrap(bootstrapTargetDeviceIds)
    const response = await bootstrapChatSessions(storedDevice.sessionToken, chatId, {
      initiator_ephemeral_keys: initiatorEphemeralKeys
    })
    const synchronizedIds = await synchronizeChatSessions(
      toLocalSessionDeviceMaterial(storedDevice),
      response.sessions
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
