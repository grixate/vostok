import { useEffect, useState, type FormEvent } from 'react'
import type { ChatSummary, GroupMember, GroupSenderKey } from '../lib/api'
import {
  distributeGroupSenderKeys,
  listGroupMembers,
  listGroupSenderKeys,
  listRecipientDevices,
  removeGroupMember,
  renameGroupChat,
  revokeDevice,
  updateGroupMemberRole,
  listDevices
} from '../lib/api'
import {
  getActiveGroupSenderKey,
  setActiveGroupSenderKey,
  storeGroupSenderKeyMaterial,
  storeInboundGroupSenderKeys,
  wrapGroupSenderKeyForRecipients
} from '../lib/message-vault'
import { bytesToBase64 } from '../lib/base64'
import { mergeChat } from '../utils/chat-helpers'
import { useAppContext } from '../contexts/AppContext'

export type UseGroupChatParams = {
  activeChat: ChatSummary | null
  setChatItems: React.Dispatch<React.SetStateAction<ChatSummary[]>>
  view: string
  setDevices: (devices: import('../lib/api').DeviceInfo[]) => void
}

export function useGroupChat(params: UseGroupChatParams) {
  const { storedDevice, setBanner, setLoading } = useAppContext()
  const { activeChat, setChatItems, view, setDevices } = params

  const [groupRenameTitle, setGroupRenameTitle] = useState('')
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [groupSenderKeys, setGroupSenderKeys] = useState<GroupSenderKey[]>([])

  const activeGroupChatId = activeChat?.type === 'group' ? activeChat.id : null

  // Group rename title sync
  useEffect(() => {
    if (activeChat?.type === 'group') {
      setGroupRenameTitle(activeChat.title)
      return
    }

    setGroupRenameTitle('')
  }, [activeChat?.id, activeChat?.title, activeChat?.type])

  // Group members load
  useEffect(() => {
    if (!storedDevice || view !== 'chat' || !activeGroupChatId) {
      setGroupMembers([])
      return
    }

    const { sessionToken } = storedDevice
    const groupChatId = activeGroupChatId
    let cancelled = false

    async function loadGroupMembers() {
      try {
        const response = await listGroupMembers(sessionToken, groupChatId)

        if (!cancelled) {
          setGroupMembers(response.members)
        }
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : 'Failed to load group members.'
          setBanner({ tone: 'error', message })
          setGroupMembers([])
        }
      }
    }

    void loadGroupMembers()

    return () => {
      cancelled = true
    }
  }, [activeGroupChatId, storedDevice, view])

  // Group sender keys load
  useEffect(() => {
    if (!storedDevice || view !== 'chat' || !activeGroupChatId) {
      setGroupSenderKeys([])
      return
    }

    const { sessionToken } = storedDevice
    const encryptionPrivateKeyPkcs8Base64 = storedDevice.encryptionPrivateKeyPkcs8Base64
    const groupChatId = activeGroupChatId
    let cancelled = false

    async function loadGroupSenderKeys() {
      try {
        const response = await listGroupSenderKeys(sessionToken, groupChatId)

        if (!cancelled) {
          await storeInboundGroupSenderKeys(
            groupChatId,
            response.sender_keys,
            encryptionPrivateKeyPkcs8Base64
          )
          setGroupSenderKeys(response.sender_keys)
        }
      } catch {
        if (!cancelled) {
          setGroupSenderKeys([])
        }
      }
    }

    void loadGroupSenderKeys()

    return () => {
      cancelled = true
    }
  }, [activeGroupChatId, storedDevice, view])

  async function handleRenameActiveGroupChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!storedDevice || !activeChat || activeChat.type !== 'group' || groupRenameTitle.trim() === '') {
      return
    }

    setLoading(true)

    try {
      const response = await renameGroupChat(storedDevice.sessionToken, activeChat.id, {
        title: groupRenameTitle.trim()
      })

      setChatItems((current) => mergeChat(current, response.chat))
      setGroupRenameTitle(response.chat.title)
      setBanner({ tone: 'success', message: `Group updated: ${response.chat.title}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename the group.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdateActiveGroupMemberRole(member: GroupMember, role: 'admin' | 'member') {
    if (!storedDevice || !activeChat || activeChat.type !== 'group' || member.role === role) {
      return
    }

    setLoading(true)

    try {
      const response = await updateGroupMemberRole(storedDevice.sessionToken, activeChat.id, member.user_id, role)
      setGroupMembers((current) =>
        current.map((entry) => (entry.user_id === response.member.user_id ? response.member : entry))
      )
      setBanner({
        tone: 'success',
        message: `${response.member.username} is now ${response.member.role}.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update the group member.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleRemoveActiveGroupMember(member: GroupMember) {
    if (!storedDevice || !activeChat || activeChat.type !== 'group') {
      return
    }

    setLoading(true)

    try {
      const response = await removeGroupMember(storedDevice.sessionToken, activeChat.id, member.user_id)
      setGroupMembers((current) => current.filter((entry) => entry.user_id !== response.member.user_id))
      setChatItems((current) =>
        current.map((chat) =>
          chat.id === activeChat.id
            ? {
                ...chat,
                participant_usernames: chat.participant_usernames.filter(
                  (username) => username !== response.member.username
                )
              }
            : chat
        )
      )
      setBanner({ tone: 'success', message: `${response.member.username} was removed from the group.` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove the group member.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleRotateGroupSenderKey() {
    if (!storedDevice || !activeChat || activeChat.type !== 'group') {
      return
    }

    setLoading(true)

    try {
      const recipientDevices = (
        await listRecipientDevices(storedDevice.sessionToken, activeChat.id)
      ).recipient_devices.filter((device) => device.device_id !== storedDevice.deviceId)

      if (recipientDevices.length === 0) {
        throw new Error('No recipient devices are currently available for sender key distribution.')
      }

      const senderKeyMaterial = window.crypto.getRandomValues(new Uint8Array(32))
      const senderKeyMaterialBase64 = bytesToBase64(senderKeyMaterial)
      const keyId = `sender-${Date.now()}-${window.crypto.randomUUID()}`
      const wrappedKeys = await wrapGroupSenderKeyForRecipients(
        senderKeyMaterialBase64,
        recipientDevices
      )
      const currentActiveSenderKey = getActiveGroupSenderKey(activeChat.id)
      const nextEpoch = currentActiveSenderKey ? currentActiveSenderKey.epoch + 1 : 1
      const response = await distributeGroupSenderKeys(storedDevice.sessionToken, activeChat.id, {
        key_id: keyId,
        sender_key_epoch: nextEpoch,
        algorithm: 'p256-ecdh+a256gcm',
        wrapped_keys: wrappedKeys
      })

      storeGroupSenderKeyMaterial(activeChat.id, keyId, senderKeyMaterialBase64)
      setActiveGroupSenderKey(activeChat.id, keyId, nextEpoch)
      setGroupSenderKeys(response.sender_keys)
      setBanner({
        tone: 'success',
        message: `Distributed Sender Key ${keyId} (epoch ${nextEpoch}) to ${response.sender_keys.length} recipient device${response.sender_keys.length === 1 ? '' : 's'}.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rotate the group Sender Key.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleRevokeLinkedDevice(deviceId: string) {
    if (!storedDevice) {
      return
    }

    setLoading(true)

    try {
      const response = await revokeDevice(storedDevice.sessionToken, deviceId)
      const deviceResponse = await listDevices(storedDevice.sessionToken)
      setDevices(deviceResponse.devices)
      setBanner({
        tone: 'success',
        message: `Revoked ${response.device.device_name}. Existing sessions for that device are now invalid.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to revoke device.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  return {
    groupRenameTitle,
    setGroupRenameTitle,
    groupMembers,
    groupSenderKeys,
    activeGroupChatId,
    handleRenameActiveGroupChat,
    handleUpdateActiveGroupMemberRole,
    handleRemoveActiveGroupMember,
    handleRotateGroupSenderKey,
    handleRevokeLinkedDevice
  }
}
