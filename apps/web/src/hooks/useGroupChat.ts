import { useState, useEffect, type FormEvent } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import type { ChatSummary, GroupMember, GroupSenderKey } from '../lib/api.ts'
import {
  createGroupChat,
  renameGroupChat,
  updateChatInfo,
  addChatMembers,
  updateGroupMemberRole,
  removeGroupMember,
  transferOwnership,
  listGroupMembers,
  listGroupSenderKeys,
  listRecipientDevices,
  distributeGroupSenderKeys
} from '../lib/api.ts'
import {
  getActiveGroupSenderKey,
  setActiveGroupSenderKey,
  storeGroupSenderKeyMaterial,
  storeInboundGroupSenderKeys,
  wrapGroupSenderKeyForRecipients
} from '../lib/message-vault.ts'
import { bytesToBase64 } from '../lib/base64.ts'
import { getRawChatId, qualifyChatId, type MergedChatSummary } from '../lib/multi-server.ts'
import { mergeChat } from '../utils/chat-helpers.ts'
import type { AuthView } from '../types.ts'

const DEFAULT_CHAT_PERMISSIONS: Record<string, 'everyone' | 'admins'> = {
  who_can_send: 'everyone',
  who_can_add_members: 'admins',
  who_can_edit_info: 'admins',
  who_can_pin_messages: 'admins'
}

type ActiveServerScope = {
  id: string
  label: string
  color: string
  url: string
}

type ServerScopeLike =
  | ActiveServerScope
  | Pick<MergedChatSummary, 'serverId' | 'serverLabel' | 'serverColor' | 'serverUrl'>

function normalizeServerScope(server: ServerScopeLike): ActiveServerScope {
  if ('serverId' in server) {
    return {
      id: server.serverId,
      label: server.serverLabel,
      color: server.serverColor,
      url: server.serverUrl
    }
  }

  return server
}

function toMergedGroupChat(chat: ChatSummary, server: ServerScopeLike): MergedChatSummary {
  const normalizedServer = normalizeServerScope(server)
  const qualifiedId = qualifyChatId(normalizedServer.id, chat.id)
  return {
    ...chat,
    id: qualifiedId,
    rawId: chat.id,
    qualifiedId,
    serverId: normalizedServer.id,
    serverLabel: normalizedServer.label,
    serverColor: normalizedServer.color,
    serverUrl: normalizedServer.url
  }
}

export function useGroupChat(
  view: AuthView,
  activeChat: MergedChatSummary | null,
  profileUsername: string | null,
  setChatItems: React.Dispatch<React.SetStateAction<MergedChatSummary[]>>,
  activeServer: ActiveServerScope | null
) {
  const { sessionToken, storedDevice, setLoading, setBanner } = useAppContext()
  const [groupRenameTitle, setGroupRenameTitle] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [chatIsPublic, setChatIsPublic] = useState(false)
  const [chatAllowComments, setChatAllowComments] = useState(true)
  const [chatPermissions, setChatPermissions] = useState<Record<string, 'everyone' | 'admins'>>(
    DEFAULT_CHAT_PERMISSIONS
  )
  const [groupMembers, setGroupMembers] = useState<GroupMember[]>([])
  const [, setGroupSenderKeys] = useState<GroupSenderKey[]>([])

  const activeGroupChatId =
    activeChat?.type === 'group' || activeChat?.type === 'channel' ? activeChat.id : null

  useEffect(() => {
    if (activeChat?.type === 'group' || activeChat?.type === 'channel') {
      setGroupRenameTitle(activeChat.title)
      setGroupDescription(activeChat.description ?? '')
      setChatIsPublic(Boolean(activeChat.is_public))
      setChatAllowComments(activeChat.allow_comments ?? true)
      setChatPermissions({
        ...DEFAULT_CHAT_PERMISSIONS,
        ...(activeChat.permissions ?? {})
      })
      return
    }

    setGroupRenameTitle('')
    setGroupDescription('')
    setChatIsPublic(false)
    setChatAllowComments(true)
    setChatPermissions(DEFAULT_CHAT_PERMISSIONS)
  }, [
    activeChat?.allow_comments,
    activeChat?.description,
    activeChat?.id,
    activeChat?.is_public,
    activeChat?.permissions,
    activeChat?.title,
    activeChat?.type
  ])

  useEffect(() => {
    if (!sessionToken || view !== 'chat' || !activeGroupChatId) {
      setGroupMembers([])
      return
    }

    if (
      activeChat?.type === 'channel' &&
      activeChat.membership_role !== 'owner' &&
      activeChat.membership_role !== 'admin'
    ) {
      setGroupMembers([])
      return
    }

    const token = sessionToken
    const groupChatId = getRawChatId(activeGroupChatId)
    if (!groupChatId) {
      setGroupMembers([])
      return
    }

    const rawGroupChatId = groupChatId
    let cancelled = false

    async function loadGroupMembers() {
      try {
        const response = await listGroupMembers(token, rawGroupChatId)

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
  }, [activeGroupChatId, sessionToken, view, setBanner])

  useEffect(() => {
    if (!sessionToken || !storedDevice || view !== 'chat' || !activeGroupChatId) {
      setGroupSenderKeys([])
      return
    }

    const token2 = sessionToken
    const groupChatId = getRawChatId(activeGroupChatId)

    if (!groupChatId) {
      setGroupSenderKeys([])
      return
    }

    const rawGroupChatId = groupChatId
    const qualifiedGroupChatId = activeGroupChatId
    let cancelled = false

    async function loadGroupSenderKeys() {
      try {
        const response = await listGroupSenderKeys(token2, rawGroupChatId)

        if (!cancelled) {
          // Group sender keys are legacy — Signal pairwise sessions handle
          // group message encryption now. Still load keys for decrypting
          // old messages that used the sender key scheme.
          await storeInboundGroupSenderKeys(
            qualifiedGroupChatId,
            response.sender_keys,
            undefined
          )
          if (rawGroupChatId !== qualifiedGroupChatId) {
            await storeInboundGroupSenderKeys(
              rawGroupChatId,
              response.sender_keys,
              undefined
            )
          }
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
  }, [activeGroupChatId, sessionToken, storedDevice, view])

  async function _handleCreateGroupChat(event: FormEvent<HTMLFormElement>, newGroupTitle: string, newGroupMembers: string, setNewGroupTitle: (v: string) => void, setNewGroupMembers: (v: string) => void) {
    event.preventDefault()

    if (!sessionToken || newGroupTitle.trim() === '') {
      return
    }

    setLoading(true)

    try {
      if (!activeServer) {
        throw new Error('No active server is available for group creation.')
      }

      const members = newGroupMembers
        .split(',')
        .map((member) => member.trim())
        .filter(Boolean)
      const response = await createGroupChat(sessionToken, {
        title: newGroupTitle.trim(),
        members
      })

      const mergedChat = toMergedGroupChat(response.chat, activeServer)
      setChatItems((current) => mergeChat(current, mergedChat))
      setNewGroupTitle('')
      setNewGroupMembers('')
      setBanner({ tone: 'success', message: `Group ready: ${response.chat.title}` })
      return mergedChat.id
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create group chat.'
      setBanner({ tone: 'error', message })
      return null
    } finally {
      setLoading(false)
    }
  }

  async function _handleRenameActiveGroupChat(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (
      !sessionToken ||
      !activeChat ||
      !['group', 'channel'].includes(activeChat.type) ||
      groupRenameTitle.trim() === ''
    ) {
      return
    }

    setLoading(true)

    try {
      const rawActiveChatId = getRawChatId(activeChat.id)

      if (!rawActiveChatId) {
        throw new Error('The active group chat is unavailable.')
      }

      const response =
        activeChat.type === 'group'
          ? await renameGroupChat(sessionToken, rawActiveChatId, {
              title: groupRenameTitle.trim()
            })
          : await updateChatInfo(sessionToken, rawActiveChatId, {
              title: groupRenameTitle.trim()
            })

      setChatItems((current) => mergeChat(current, toMergedGroupChat(response.chat, activeChat)))
      setGroupRenameTitle(response.chat.title)
      setBanner({ tone: 'success', message: `Group updated: ${response.chat.title}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to rename the group.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdateActiveChatSettings(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault()

    if (!sessionToken || !activeChat || !['group', 'channel'].includes(activeChat.type)) {
      return
    }

    setLoading(true)

    try {
      const rawActiveChatId = getRawChatId(activeChat.id)

      if (!rawActiveChatId) {
        throw new Error('The active group chat is unavailable.')
      }

      const response = await updateChatInfo(sessionToken, rawActiveChatId, {
        description: groupDescription.trim() || '',
        permissions: chatPermissions,
        is_public: activeChat.type === 'channel' ? chatIsPublic : undefined,
        allow_comments: activeChat.type === 'channel' ? chatAllowComments : undefined
      })

      setChatItems((current) => mergeChat(current, toMergedGroupChat(response.chat, activeChat)))
      setGroupDescription(response.chat.description ?? '')
      setChatIsPublic(Boolean(response.chat.is_public))
      setChatAllowComments(response.chat.allow_comments ?? true)
      setChatPermissions({
        ...DEFAULT_CHAT_PERMISSIONS,
        ...(response.chat.permissions ?? {})
      })
      setBanner({ tone: 'success', message: `Chat settings updated: ${response.chat.title}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update chat settings.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleUpdateActiveChatAvatar(photoBase64: string, contentType: string): Promise<string | null> {
    if (!sessionToken || !activeChat || !['group', 'channel'].includes(activeChat.type)) {
      throw new Error('The active chat does not support avatars.')
    }

    setLoading(true)

    try {
      const rawActiveChatId = getRawChatId(activeChat.id)

      if (!rawActiveChatId) {
        throw new Error('The active group chat is unavailable.')
      }

      const response = await updateChatInfo(sessionToken, rawActiveChatId, {
        avatar_base64: photoBase64,
        avatar_content_type: contentType
      })

      const mergedChat = toMergedGroupChat(response.chat, activeChat)
      if (mergedChat.avatar_url) {
        mergedChat.avatar_url = `${mergedChat.avatar_url}${mergedChat.avatar_url.includes('?') ? '&' : '?'}v=${Date.now()}`
      }

      setChatItems((current) => mergeChat(current, mergedChat))
      setBanner({ tone: 'success', message: `Chat avatar updated: ${response.chat.title}` })
      return mergedChat.avatar_url ?? null
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to update chat avatar.'
      setBanner({ tone: 'error', message })
      throw error
    } finally {
      setLoading(false)
    }
  }

  async function handleRemoveActiveChatAvatar(): Promise<void> {
    if (!sessionToken || !activeChat || !['group', 'channel'].includes(activeChat.type)) {
      throw new Error('The active chat does not support avatars.')
    }

    setLoading(true)

    try {
      const rawActiveChatId = getRawChatId(activeChat.id)

      if (!rawActiveChatId) {
        throw new Error('The active group chat is unavailable.')
      }

      const response = await updateChatInfo(sessionToken, rawActiveChatId, {
        remove_avatar: true
      })

      const mergedChat = toMergedGroupChat(response.chat, activeChat)
      mergedChat.avatar_url = null
      setChatItems((current) => mergeChat(current, mergedChat))
      setBanner({ tone: 'success', message: `Chat avatar removed: ${response.chat.title}` })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to remove chat avatar.'
      setBanner({ tone: 'error', message })
      throw error
    } finally {
      setLoading(false)
    }
  }

  async function _handleUpdateActiveGroupMemberRole(member: GroupMember, role: 'admin' | 'member') {
    if (
      !sessionToken ||
      !activeChat ||
      !['group', 'channel'].includes(activeChat.type) ||
      member.role === role
    ) {
      return
    }

    setLoading(true)

    try {
      const rawActiveChatId = getRawChatId(activeChat.id)

      if (!rawActiveChatId) {
        throw new Error('The active group chat is unavailable.')
      }

      const response = await updateGroupMemberRole(sessionToken, rawActiveChatId, member.user_id, role)
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
    if (!sessionToken || !activeChat || !['group', 'channel'].includes(activeChat.type)) {
      return
    }

    setLoading(true)

    try {
      const rawActiveChatId = getRawChatId(activeChat.id)

      if (!rawActiveChatId) {
        throw new Error('The active group chat is unavailable.')
      }

      const response = await removeGroupMember(sessionToken, rawActiveChatId, member.user_id)
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

  async function handleAddActiveGroupMembers(usernames: string[]) {
    if (!sessionToken || !activeChat || !['group', 'channel'].includes(activeChat.type)) {
      return
    }

    const normalizedUsernames = usernames.map((username) => username.trim()).filter(Boolean)

    if (normalizedUsernames.length === 0) {
      return
    }

    setLoading(true)

    try {
      const rawActiveChatId = getRawChatId(activeChat.id)

      if (!rawActiveChatId) {
        throw new Error('The active group chat is unavailable.')
      }

      const response = await addChatMembers(sessionToken, rawActiveChatId, normalizedUsernames)

      if (response.members.length === 0) {
        setBanner({ tone: 'info', message: 'No new members were added.' })
        return
      }

      setGroupMembers((current) => {
        const existingById = new Map(current.map((entry) => [entry.user_id, entry]))

        for (const member of response.members) {
          existingById.set(member.user_id, member)
        }

        return Array.from(existingById.values())
      })

      setChatItems((current) =>
        current.map((chat) =>
          chat.id === activeChat.id
            ? {
                ...chat,
                member_count: (chat.member_count ?? groupMembers.length) + response.members.length,
                participant_usernames: Array.from(
                  new Set([...chat.participant_usernames, ...response.members.map((member) => member.username)])
                )
              }
            : chat
        )
      )

      setBanner({
        tone: 'success',
        message: `Added ${response.members.length} member${response.members.length === 1 ? '' : 's'}.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to add chat members.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function handleTransferActiveGroupOwnership(member: GroupMember) {
    if (!sessionToken || !activeChat || !['group', 'channel'].includes(activeChat.type)) {
      return
    }

    setLoading(true)

    try {
      const rawActiveChatId = getRawChatId(activeChat.id)

      if (!rawActiveChatId) {
        throw new Error('The active group chat is unavailable.')
      }

      const response = await transferOwnership(sessionToken, rawActiveChatId, member.user_id)
      setGroupMembers((current) =>
        current.map((entry) => {
          if (entry.user_id === response.previous_owner.user_id) {
            return response.previous_owner
          }

          if (entry.user_id === response.new_owner.user_id) {
            return response.new_owner
          }

          return entry
        })
      )

      setChatItems((current) =>
        current.map((chat) =>
          chat.id === activeChat.id
            ? {
                ...chat,
                membership_role:
                  profileUsername === response.previous_owner.username
                    ? 'admin'
                    : profileUsername === response.new_owner.username
                      ? 'owner'
                      : chat.membership_role,
                can_delete_chat:
                  profileUsername === response.previous_owner.username ? false : chat.can_delete_chat,
                can_leave_chat:
                  profileUsername === response.previous_owner.username ? true : chat.can_leave_chat
              }
            : chat
        )
      )

      setBanner({
        tone: 'success',
        message: `${response.new_owner.username} is now the owner.`
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to transfer ownership.'
      setBanner({ tone: 'error', message })
    } finally {
      setLoading(false)
    }
  }

  async function _handleRotateGroupSenderKey() {
    if (!sessionToken || !storedDevice || !activeChat || activeChat.type !== 'group') {
      return
    }

    setLoading(true)

    try {
      const rawActiveChatId = getRawChatId(activeChat.id)

      if (!rawActiveChatId) {
        throw new Error('The active group chat is unavailable.')
      }

      const recipientDevices = (
        await listRecipientDevices(sessionToken, rawActiveChatId)
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
      const response = await distributeGroupSenderKeys(sessionToken, rawActiveChatId, {
        key_id: keyId,
        sender_key_epoch: nextEpoch,
        algorithm: 'p256-ecdh+a256gcm',
        wrapped_keys: wrappedKeys
      })

      storeGroupSenderKeyMaterial(activeChat.id, keyId, senderKeyMaterialBase64)
      setActiveGroupSenderKey(activeChat.id, keyId, nextEpoch)
      if (rawActiveChatId !== activeChat.id) {
        storeGroupSenderKeyMaterial(rawActiveChatId, keyId, senderKeyMaterialBase64)
        setActiveGroupSenderKey(rawActiveChatId, keyId, nextEpoch)
      }
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

  return {
    groupRenameTitle,
    setGroupRenameTitle,
    groupDescription,
    setGroupDescription,
    chatIsPublic,
    setChatIsPublic,
    chatAllowComments,
    setChatAllowComments,
    chatPermissions,
    setChatPermissions,
    groupMembers,
    activeGroupChatId,
    _handleCreateGroupChat,
    _handleRenameActiveGroupChat,
    handleUpdateActiveChatAvatar,
    handleRemoveActiveChatAvatar,
    handleUpdateActiveChatSettings,
    _handleUpdateActiveGroupMemberRole,
    handleAddActiveGroupMembers,
    handleRemoveActiveGroupMember,
    handleTransferActiveGroupOwnership,
    _handleRotateGroupSenderKey
  }
}
