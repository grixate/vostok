import type { ChatDeviceSession, RecipientDevice } from '../lib/api'
import type { LocalSessionDeviceMaterial } from '../lib/chat-session-vault'
import type { StoredDevice } from '../types'

export function toLocalSessionDeviceMaterial(storedDevice: StoredDevice): LocalSessionDeviceMaterial {
  return {
    deviceId: storedDevice.deviceId,
    encryptionPrivateKeyPkcs8Base64: storedDevice.encryptionPrivateKeyPkcs8Base64,
    signedPrekeyPublicKeyBase64: storedDevice.signedPrekeyPublicKeyBase64,
    signedPrekeyPrivateKeyPkcs8Base64: storedDevice.signedPrekeyPrivateKeyPkcs8Base64,
    signedPrekeys:
      storedDevice.signedPrekeys ??
      (storedDevice.signedPrekeyPublicKeyBase64 && storedDevice.signedPrekeyPrivateKeyPkcs8Base64
        ? [
            {
              publicKeyBase64: storedDevice.signedPrekeyPublicKeyBase64,
              privateKeyPkcs8Base64: storedDevice.signedPrekeyPrivateKeyPkcs8Base64
            }
          ]
        : []),
    oneTimePrekeys: storedDevice.oneTimePrekeys
  }
}

export function canUseChatSessions(
  storedDevice: StoredDevice,
  sessions: ChatDeviceSession[],
  recipientDevices: RecipientDevice[]
): boolean {
  if (!storedDevice.encryptionPrivateKeyPkcs8Base64) {
    return false
  }

  const outboundRecipientIds = new Set(
    sessions
      .filter(
        (session) =>
          session.initiator_device_id === storedDevice.deviceId &&
          session.session_state !== 'superseded'
      )
      .map((session) => session.recipient_device_id)
  )

  return recipientDevices.every((device) => outboundRecipientIds.has(device.device_id))
}

export function shouldQueueOutboxSendFailure(message: string): boolean {
  const normalized = message.toLowerCase()

  if (
    normalized.includes('required') ||
    normalized.includes('must ') ||
    normalized.includes('must be') ||
    normalized.includes('unauthorized') ||
    normalized.includes('forbidden') ||
    normalized.includes('not found') ||
    normalized.includes('sender key') ||
    normalized.includes('session transport') ||
    normalized.includes('already been taken')
  ) {
    return false
  }

  return true
}

export function isOutboxDuplicateClientIdError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('client') && normalized.includes('already been taken')
}
