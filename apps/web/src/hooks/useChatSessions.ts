import { useState, useEffect } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import type { ChatDeviceSession, PrekeyDeviceBundle, RecipientDevice } from '../lib/api.ts'
import {
  fetchUserPrekeys,
  listRecipientDevices,
  listSafetyNumbers,
  verifySafetyNumber
} from '../lib/api.ts'
import { toSafetyNumberEntry } from '../utils/safety-helpers.ts'
import { getRawChatId, type MergedChatSummary } from '../lib/multi-server.ts'
import type { AuthView, SafetyNumberEntry } from '../types.ts'

export function useChatSessions(
  view: AuthView,
  deferredActiveChatId: string | null,
  activeChatIdRef: React.RefObject<string | null>,
  chatItems: MergedChatSummary[]
) {
  const { sessionToken, storedDevice, setLoading, setBanner } = useAppContext()
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

  // Signal sessions are built on-demand in the message send path.
  // This function is kept for API compatibility but simplified — it just
  // returns the existing sessions without bootstrapping custom X3DH.
  async function syncChatSessionsFromServer(
    chatId: string,
    _knownRecipientDevices?: RecipientDevice[]
  ): Promise<ChatDeviceSession[]> {
    const rawChatId = getRawChatId(chatId)

    if (!rawChatId || !sessionToken || !storedDevice || activeChatIdRef.current !== chatId) {
      return []
    }

    // Signal protocol handles session establishment automatically via
    // PreKeyWhisperMessage on first message send. No custom bootstrap needed.
    return chatSessions
  }

  async function _handleRekeyActiveChatSessions(activeChatId: string | null) {
    const rawActiveChatId = getRawChatId(activeChatId)

    if (!sessionToken || !storedDevice || !activeChatId || !rawActiveChatId) {
      setBanner({ tone: 'error', message: 'Select a chat before rekeying direct-chat sessions.' })
      return
    }

    setLoading(true)

    try {
      // With Signal protocol, "rekeying" means the next message will use
      // a new ratchet step automatically. Nothing explicit needed.
      setBanner({
        tone: 'success',
        message: 'Signal protocol sessions automatically rekey with each message exchange.'
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
