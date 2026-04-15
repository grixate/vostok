import type { CallSession, CallSignal } from './api.ts'
import type { MediaEncryptionState } from './media-e2ee.ts'
import {
  decryptMessage,
  deriveGroupCallKey,
  generateMediaKeyMaterial,
  mediaKeyFingerprint,
  wrapMediaKeyForDevice,
  type SignalContext
} from './signal-bridge.ts'

type WrappedSignalMediaKey = {
  body: string
  type: number
}

type GroupCallKeySignalPayload = {
  kind: 'signal_group_call_key'
  sender_device_id: string
  wrapped_keys: Record<string, WrappedSignalMediaKey>
}

type DirectCallKeySignalPayload = {
  kind: 'signal_direct_call_key'
  call_id: string
  sender_device_id: string
  wrapped_key: WrappedSignalMediaKey
}

export type GroupMediaEncryptionSyncResult = {
  state: MediaEncryptionState
  fingerprint: string | null
  currentKeyEpoch: number | null
}

export async function syncGroupMediaEncryption<ControllerType, ConnectionType>(
  options: {
    activeCall: CallSession
    participantDeviceIds: string[]
    isInitiator: boolean
    callSignals: CallSignal[]
    localDeviceId: string | null
    serverId: string | null
    groupCallKeyGeneratedForCallId: string | null
    setGroupCallKeyGeneratedForCallId: (callId: string) => void
    membraneClient: unknown
    getPeerConnection: (client: unknown) => ConnectionType | null
    ensureController: () => ControllerType
    updateControllerKey: (controller: ControllerType, keyMaterialBase64: string | null) => void
    attachController: (controller: ControllerType, connection: ConnectionType) => void
    sendCallSignal: (
      token: string,
      callId: string,
      payload: { signal_type: 'heartbeat'; payload: string; target_device_id?: string }
    ) => Promise<unknown>
    ensureRemoteSessions: (deviceIds: string[]) => Promise<string[]>
    sessionToken: string
    groupCallKeyMaterial: string | null
    setGroupCallKeyMaterial: (key: string) => void
    distributedParticipantDeviceIds: string[]
    setDistributedParticipantDeviceIds: (deviceIds: string[]) => void
    }
): Promise<GroupMediaEncryptionSyncResult> {
  const {
    activeCall,
    participantDeviceIds,
    isInitiator,
    callSignals,
    localDeviceId,
    serverId,
    groupCallKeyGeneratedForCallId,
    setGroupCallKeyGeneratedForCallId,
    membraneClient,
    getPeerConnection,
    ensureController,
    updateControllerKey,
    attachController,
    sendCallSignal,
    ensureRemoteSessions,
    sessionToken,
    groupCallKeyMaterial,
    setGroupCallKeyMaterial,
    distributedParticipantDeviceIds,
    setDistributedParticipantDeviceIds
  } = options

  if (!localDeviceId || !serverId) {
    return { state: 'negotiating', fingerprint: null, currentKeyEpoch: null }
  }
  const ctx: SignalContext = { serverId, localDeviceId }
  let activeGroupCallKeyMaterial = groupCallKeyMaterial

  if (isInitiator && participantDeviceIds.length > 0) {
    if (!localDeviceId) {
      return { state: 'negotiating', fingerprint: null, currentKeyEpoch: null }
    }

    const undistributedParticipantIds = participantDeviceIds.filter((deviceId) => {
      return !distributedParticipantDeviceIds.includes(deviceId)
    })

    try {
      if (!activeGroupCallKeyMaterial && groupCallKeyGeneratedForCallId !== activeCall.id) {
        const readyParticipantIds = await ensureRemoteSessions(participantDeviceIds)

        if (readyParticipantIds.length > 0) {
          const { keyMaterialBase64, wrappedKeys } = await deriveGroupCallKey(ctx, readyParticipantIds)
          activeGroupCallKeyMaterial = keyMaterialBase64
          setGroupCallKeyMaterial(keyMaterialBase64)
          setGroupCallKeyGeneratedForCallId(activeCall.id)
          setDistributedParticipantDeviceIds(readyParticipantIds)

          await sendCallSignal(sessionToken, activeCall.id, {
            signal_type: 'heartbeat',
            payload: JSON.stringify({
              kind: 'signal_group_call_key',
              wrapped_keys: wrappedKeys,
              sender_device_id: localDeviceId
            } satisfies GroupCallKeySignalPayload)
          })
        }
      } else if (activeGroupCallKeyMaterial && undistributedParticipantIds.length > 0) {
        const readyParticipantIds = await ensureRemoteSessions(undistributedParticipantIds)

        if (readyParticipantIds.length > 0) {
          const wrappedKeys = Object.fromEntries(
            await Promise.all(
              readyParticipantIds.map(async (deviceId) => {
                return [deviceId, await wrapMediaKeyForDevice(ctx, deviceId, activeGroupCallKeyMaterial!)] as const
              })
            )
          )

          await sendCallSignal(sessionToken, activeCall.id, {
            signal_type: 'heartbeat',
            payload: JSON.stringify({
              kind: 'signal_group_call_key',
              wrapped_keys: wrappedKeys,
              sender_device_id: localDeviceId
            } satisfies GroupCallKeySignalPayload)
          })
          setDistributedParticipantDeviceIds(
            Array.from(new Set([...distributedParticipantDeviceIds, ...readyParticipantIds]))
          )
        }
      }
    } catch (error) {
      console.warn('[syncGroupMediaEncryption] Failed to generate group call key:', error)
      return { state: 'error', fingerprint: null, currentKeyEpoch: null }
    }
  }

  if (!isInitiator && !activeGroupCallKeyMaterial) {
    for (const signal of [...callSignals].reverse()) {
      if (signal.signal_type !== 'heartbeat' || !signal.payload) continue
      try {
        const parsed = parseGroupCallKeySignal(signal.payload)
        if (!parsed) continue
        if (!localDeviceId || !parsed.wrapped_keys[localDeviceId]) continue

        const wrapped = parsed.wrapped_keys[localDeviceId]
        const decryptedKey = await decryptMessage(ctx, parsed.sender_device_id, wrapped.body, wrapped.type)
        setGroupCallKeyMaterial(decryptedKey)
        activeGroupCallKeyMaterial = decryptedKey
        break
      } catch {
        // Not our key or couldn't decrypt, try next signal
      }
    }
  }

  if (!activeGroupCallKeyMaterial) {
    return { state: 'negotiating', fingerprint: null, currentKeyEpoch: null }
  }

  const connection = getPeerConnection(membraneClient)
  if (!connection) {
    return { state: 'negotiating', fingerprint: null, currentKeyEpoch: null }
  }

  const controller = ensureController()
  updateControllerKey(controller, activeGroupCallKeyMaterial)
  attachController(controller, connection)

  return {
    state: 'encrypted',
    fingerprint: mediaKeyFingerprint(activeGroupCallKeyMaterial),
    currentKeyEpoch: null
  }
}

export type DirectMediaEncryptionSyncResult = {
  state: MediaEncryptionState
  fingerprint: string | null
  currentKeyEpoch: number | null
}

export async function syncDirectMediaEncryption<ControllerType, ConnectionType>(
  options: {
    activeCall: CallSession
    remoteDeviceId: string | null
    callSignals: CallSignal[]
    localDeviceId: string | null
    serverId: string | null
    isInitiator: boolean
    membraneClient: unknown
    getPeerConnection: (client: unknown) => ConnectionType | null
    ensureController: () => ControllerType
    updateControllerKey: (controller: ControllerType, keyMaterialBase64: string | null) => void
    attachController: (controller: ControllerType, connection: ConnectionType) => void
    sendCallSignal: (
      token: string,
      callId: string,
      payload: { signal_type: 'heartbeat'; payload: string; target_device_id?: string }
    ) => Promise<unknown>
    sessionToken: string
    directCallKeyMaterial: string | null
    setDirectCallKeyMaterial: (key: string) => void
    directCallKeyGeneratedForCallId: string | null
    setDirectCallKeyGeneratedForCallId: (callId: string) => void
    ensureRemoteSession: (deviceId: string) => Promise<boolean>
  }
): Promise<DirectMediaEncryptionSyncResult> {
  const {
    activeCall,
    remoteDeviceId,
    callSignals,
    localDeviceId,
    serverId,
    isInitiator,
    membraneClient,
    getPeerConnection,
    ensureController,
    updateControllerKey,
    attachController,
    sendCallSignal,
    sessionToken,
    directCallKeyMaterial,
    setDirectCallKeyMaterial,
    directCallKeyGeneratedForCallId,
    setDirectCallKeyGeneratedForCallId,
    ensureRemoteSession
  } = options

  if (!remoteDeviceId) {
    return { state: 'negotiating', fingerprint: null, currentKeyEpoch: null }
  }

  if (!localDeviceId || !serverId) {
    return { state: 'negotiating', fingerprint: null, currentKeyEpoch: null }
  }
  const ctx: SignalContext = { serverId, localDeviceId }
  let activeDirectCallKeyMaterial = directCallKeyMaterial

  try {
    if (
      isInitiator &&
      !activeDirectCallKeyMaterial &&
      directCallKeyGeneratedForCallId !== activeCall.id
    ) {
      if (!localDeviceId) {
        return { state: 'negotiating', fingerprint: null, currentKeyEpoch: null }
      }

      const ready = await ensureRemoteSession(remoteDeviceId)

      if (!ready) {
        return { state: 'negotiating', fingerprint: null, currentKeyEpoch: null }
      }

      const keyMaterialBase64 = generateMediaKeyMaterial()
      const wrappedKey = await wrapMediaKeyForDevice(ctx, remoteDeviceId, keyMaterialBase64)

      await sendCallSignal(sessionToken, activeCall.id, {
        signal_type: 'heartbeat',
        target_device_id: remoteDeviceId,
        payload: JSON.stringify({
          kind: 'signal_direct_call_key',
          call_id: activeCall.id,
          sender_device_id: localDeviceId,
          wrapped_key: wrappedKey
        } satisfies DirectCallKeySignalPayload)
      })

      setDirectCallKeyMaterial(keyMaterialBase64)
      setDirectCallKeyGeneratedForCallId(activeCall.id)
      activeDirectCallKeyMaterial = keyMaterialBase64
    }
  } catch (error) {
    console.warn('[syncDirectMediaEncryption] Failed to distribute call key:', error)
    return { state: 'error', fingerprint: null, currentKeyEpoch: null }
  }

  if (!activeDirectCallKeyMaterial) {
    for (const signal of [...callSignals].reverse()) {
      if (signal.signal_type !== 'heartbeat' || !signal.payload) continue
      if (signal.target_device_id && signal.target_device_id !== localDeviceId) continue

      try {
        const parsed = parseDirectCallKeySignal(signal.payload)
        if (!parsed || parsed.call_id !== activeCall.id || parsed.sender_device_id === localDeviceId) {
          continue
        }

        const decryptedKey = await decryptMessage(
          ctx,
          parsed.sender_device_id,
          parsed.wrapped_key.body,
          parsed.wrapped_key.type
        )
        setDirectCallKeyMaterial(decryptedKey)
        activeDirectCallKeyMaterial = decryptedKey
        break
      } catch {
        // Ignore malformed or undecryptable key signals and keep scanning.
      }
    }
  }

  if (!activeDirectCallKeyMaterial) {
    return { state: 'negotiating', fingerprint: null, currentKeyEpoch: null }
  }

  const connection = getPeerConnection(membraneClient)
  if (!connection) {
    return { state: 'negotiating', fingerprint: null, currentKeyEpoch: null }
  }

  const controller = ensureController()
  updateControllerKey(controller, activeDirectCallKeyMaterial)
  attachController(controller, connection)

  return {
    state: 'encrypted',
    fingerprint: mediaKeyFingerprint(activeDirectCallKeyMaterial),
    currentKeyEpoch: null
  }
}

function parseGroupCallKeySignal(payload: string): GroupCallKeySignalPayload | null {
  const parsed = JSON.parse(payload) as Partial<GroupCallKeySignalPayload>
  if (
    parsed.kind !== 'signal_group_call_key' ||
    typeof parsed.sender_device_id !== 'string' ||
    !parsed.wrapped_keys ||
    typeof parsed.wrapped_keys !== 'object'
  ) {
    return null
  }

  return parsed as GroupCallKeySignalPayload
}

function parseDirectCallKeySignal(payload: string): DirectCallKeySignalPayload | null {
  const parsed = JSON.parse(payload) as Partial<DirectCallKeySignalPayload>
  if (
    parsed.kind !== 'signal_direct_call_key' ||
    typeof parsed.call_id !== 'string' ||
    typeof parsed.sender_device_id !== 'string' ||
    !parsed.wrapped_key ||
    typeof parsed.wrapped_key !== 'object' ||
    typeof parsed.wrapped_key.body !== 'string' ||
    typeof parsed.wrapped_key.type !== 'number'
  ) {
    return null
  }

  return parsed as DirectCallKeySignalPayload
}
