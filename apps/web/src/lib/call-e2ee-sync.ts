import type { CallKeyDistribution, CallSession, CallSignal } from './api.ts'
import type { StoredDevice } from '../types.ts'
import type {
  DirectMediaPairEntry,
  LocalGeneratedCallKeys
} from './call-encryption.ts'
import type { MediaEncryptionState } from './media-e2ee.ts'

export type GroupMediaEncryptionSyncResult = {
  state: MediaEncryptionState
  fingerprint: string | null
  currentKeyEpoch: number | null
}

export async function syncGroupMediaEncryption<ControllerType, ConnectionType>(
  options: {
    activeCall: CallSession
    currentDevice: StoredDevice
    latestCallKey: CallKeyDistribution | null
    localGeneratedCallKeys: LocalGeneratedCallKeys
    resolveLocalGeneratedGroupKey: (
      localGeneratedCallKeys: LocalGeneratedCallKeys,
      callId: string,
      keyEpoch: number
    ) => string | null
    unwrapWrappedGroupKey: (
      wrappedKey: string,
      encryptionPrivateKeyPkcs8Base64?: string
    ) => Promise<string | null>
    membraneClient: unknown
    getPeerConnection: (client: unknown) => ConnectionType | null
    ensureController: () => ControllerType
    updateControllerKey: (controller: ControllerType, keyMaterialBase64: string | null) => void
    attachController: (controller: ControllerType, connection: ConnectionType) => void
  }
): Promise<GroupMediaEncryptionSyncResult> {
  const {
    activeCall,
    currentDevice,
    latestCallKey,
    localGeneratedCallKeys,
    resolveLocalGeneratedGroupKey,
    unwrapWrappedGroupKey,
    membraneClient,
    getPeerConnection,
    ensureController,
    updateControllerKey,
    attachController
  } = options

  const locallyGeneratedKey = latestCallKey
    ? resolveLocalGeneratedGroupKey(
        localGeneratedCallKeys,
        activeCall.id,
        latestCallKey.key_epoch
      )
    : null

  const keyMaterial =
    locallyGeneratedKey ||
    (latestCallKey
      ? await unwrapWrappedGroupKey(
          latestCallKey.wrapped_key,
          currentDevice.encryptionPrivateKeyPkcs8Base64
        )
      : null)

  if (!keyMaterial || !latestCallKey) {
    return {
      state: 'error',
      fingerprint: null,
      currentKeyEpoch: null
    }
  }

  const connection = getPeerConnection(membraneClient)

  if (!connection) {
    return {
      state: 'negotiating',
      fingerprint: null,
      currentKeyEpoch: null
    }
  }

  const controller = ensureController()
  updateControllerKey(controller, keyMaterial)
  attachController(controller, connection)

  return {
    state: 'encrypted',
    fingerprint: null,
    currentKeyEpoch: latestCallKey.key_epoch
  }
}

export type DirectMediaEncryptionSyncResult<PairType> = {
  state: MediaEncryptionState
  fingerprint: string | null
  currentKeyEpoch: number | null
  nextPairEntry: DirectMediaPairEntry<PairType> | null
  readySentForCallId: string | null
}

export async function syncDirectMediaEncryption<ControllerType, ConnectionType, PairType>(
  options: {
    activeCall: CallSession
    sessionToken: string
    callSignals: CallSignal[]
    localDeviceId: string | null
    currentPairEntry: DirectMediaPairEntry<PairType> | null
    readySentForCallId: string | null
    needsNewDirectMediaKeyPair: (
      pairEntry: DirectMediaPairEntry<PairType> | null,
      callId: string
    ) => boolean
    generateDirectMediaKeyPair: () => Promise<PairType & { publicKeyBase64: string; privateKey: CryptoKey }>
    sendCallSignal: (
      token: string,
      callId: string,
      payload: { signal_type: 'heartbeat'; payload: string }
    ) => Promise<unknown>
    buildDirectMediaKeySignalPayload: (publicKeyBase64: string) => string
    findRemoteMediaKeySignal: (
      signals: CallSignal[],
      localDeviceId: string | null,
      parseMediaSignal: (payload: string) => { kind: 'media_e2ee_key'; public_key: string } | { kind: 'media_e2ee_ready'; fingerprint: string } | null
    ) => { publicKey: string } | null
    parseMediaSignal: (payload: string) => { kind: 'media_e2ee_key'; public_key: string } | { kind: 'media_e2ee_ready'; fingerprint: string } | null
    deriveDirectMediaSharedKey: (
      privateKey: CryptoKey,
      remotePublicKeyBase64: string
    ) => Promise<{ keyMaterialBase64: string; fingerprint: string }>
    membraneClient: unknown
    getPeerConnection: (client: unknown) => ConnectionType | null
    ensureController: () => ControllerType
    updateControllerKey: (controller: ControllerType, keyMaterialBase64: string | null) => void
    attachController: (controller: ControllerType, connection: ConnectionType) => void
    buildDirectMediaReadySignalPayload: (fingerprint: string) => string
    hasMatchingRemoteReadySignal: (
      signals: CallSignal[],
      localDeviceId: string | null,
      fingerprint: string,
      parseMediaSignal: (payload: string) => { kind: 'media_e2ee_key'; public_key: string } | { kind: 'media_e2ee_ready'; fingerprint: string } | null
    ) => boolean
  }
): Promise<DirectMediaEncryptionSyncResult<PairType & { publicKeyBase64: string; privateKey: CryptoKey }>> {
  const {
    activeCall,
    sessionToken,
    callSignals,
    localDeviceId,
    currentPairEntry,
    readySentForCallId,
    needsNewDirectMediaKeyPair,
    generateDirectMediaKeyPair,
    sendCallSignal,
    buildDirectMediaKeySignalPayload,
    findRemoteMediaKeySignal,
    parseMediaSignal,
    deriveDirectMediaSharedKey,
    membraneClient,
    getPeerConnection,
    ensureController,
    updateControllerKey,
    attachController,
    buildDirectMediaReadySignalPayload,
    hasMatchingRemoteReadySignal
  } = options

  let nextPairEntry = currentPairEntry as DirectMediaPairEntry<PairType & { publicKeyBase64: string; privateKey: CryptoKey }> | null

  if (needsNewDirectMediaKeyPair(nextPairEntry, activeCall.id)) {
    const keyPair = await generateDirectMediaKeyPair()
    nextPairEntry = { callId: activeCall.id, keyPair }

    await sendCallSignal(sessionToken, activeCall.id, {
      signal_type: 'heartbeat',
      payload: buildDirectMediaKeySignalPayload(keyPair.publicKeyBase64)
    })
  }

  if (!nextPairEntry) {
    return {
      state: 'negotiating',
      fingerprint: null,
      currentKeyEpoch: null,
      nextPairEntry,
      readySentForCallId
    }
  }

  const remoteKeySignal = findRemoteMediaKeySignal(callSignals, localDeviceId, parseMediaSignal)

  if (!remoteKeySignal) {
    return {
      state: 'negotiating',
      fingerprint: null,
      currentKeyEpoch: null,
      nextPairEntry,
      readySentForCallId
    }
  }

  const sharedKey = await deriveDirectMediaSharedKey(
    nextPairEntry.keyPair.privateKey,
    remoteKeySignal.publicKey
  )

  const connection = getPeerConnection(membraneClient)

  if (!connection) {
    return {
      state: 'negotiating',
      fingerprint: null,
      currentKeyEpoch: null,
      nextPairEntry,
      readySentForCallId
    }
  }

  const controller = ensureController()
  updateControllerKey(controller, sharedKey.keyMaterialBase64)
  attachController(controller, connection)

  let nextReadySentForCallId = readySentForCallId

  if (readySentForCallId !== activeCall.id) {
    nextReadySentForCallId = activeCall.id
    await sendCallSignal(sessionToken, activeCall.id, {
      signal_type: 'heartbeat',
      payload: buildDirectMediaReadySignalPayload(sharedKey.fingerprint)
    })
  }

  const matchingReady = hasMatchingRemoteReadySignal(
    callSignals,
    localDeviceId,
    sharedKey.fingerprint,
    parseMediaSignal
  )

  return {
    state: matchingReady ? 'verified' : 'encrypted',
    fingerprint: sharedKey.fingerprint,
    currentKeyEpoch: 1,
    nextPairEntry,
    readySentForCallId: nextReadySentForCallId
  }
}
