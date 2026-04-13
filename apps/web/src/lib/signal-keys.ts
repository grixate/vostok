import {
  KeyHelper
} from '@privacyresearch/libsignal-protocol-typescript'
import type {
  KeyPairType,
  SignedPreKeyPairType,
  PreKeyPairType
} from '@privacyresearch/libsignal-protocol-typescript'

export type SignalDeviceIdentity = {
  identityKeyPair: KeyPairType
  registrationId: number
}

export type SignalDevicePrekeys = {
  signedPreKey: SignedPreKeyPairType
  preKeys: PreKeyPairType[]
}

export async function generateSignalIdentity(): Promise<SignalDeviceIdentity> {
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair()
  const registrationId = KeyHelper.generateRegistrationId()
  return { identityKeyPair, registrationId }
}

export async function generateSignalPrekeys(
  identityKeyPair: KeyPairType,
  signedPreKeyId: number,
  oneTimePreKeyStartId: number,
  count: number = 16
): Promise<SignalDevicePrekeys> {
  const signedPreKey = await KeyHelper.generateSignedPreKey(
    identityKeyPair,
    signedPreKeyId
  )
  const preKeys: PreKeyPairType[] = []
  for (let i = 0; i < count; i++) {
    preKeys.push(await KeyHelper.generatePreKey(oneTimePreKeyStartId + i))
  }
  return { signedPreKey, preKeys }
}
