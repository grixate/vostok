import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatSummary } from '../lib/api.ts'
import { generateSignalIdentity, generateSignalPrekeys } from '../lib/signal-keys.ts'
import { initSignalStore, arrayBufferToBase64 } from '../lib/signal-store.ts'
import { createServerApiClient } from '../lib/server-api.ts'
import { createServerRealtimeClient } from '../lib/server-realtime.ts'
import {
  addServer as buildServerEntry,
  findPrimaryServer,
  findPreferredServer,
  loadServers,
  mergeServerChats,
  persistActiveServerId,
  readActiveServerId,
  removeServer as removeServerEntry,
  saveServers,
  serverForChat,
  updateServer as updateServerEntry
} from '../lib/server-manager.ts'
import {
  getServerIdFromQualifiedChatId,
  getRawChatId,
  qualifyChatId,
  type ServerConnectionStatus,
  type ServerEntry
} from '../lib/multi-server.ts'
import type { AuthSession } from '../types.ts'

type ConnectionRecord = {
  api: ReturnType<typeof createServerApiClient>
  realtime: ReturnType<typeof createServerRealtimeClient>
  unsubscribeUser?: () => void
  unsubscribePresence?: () => void
  bootstrapKey?: string | null
  bootstrappingKey?: string | null
  chatSnapshotRequestId?: number
  latestAppliedChatSnapshotRequestId?: number
}

function chatListsEqual(left: ChatSummary[], right: ChatSummary[]): boolean {
  if (left.length !== right.length) {
    return false
  }

  return left.every((chat, index) => {
    const other = right[index]
    return (
      chat.id === other?.id &&
      chat.latest_message_at === other.latest_message_at &&
      chat.message_count === other.message_count &&
      chat.title === other.title
    )
  })
}

export function useServers(
  existingChatActivityRef?: React.RefObject<(chatId: string) => void>
) {
  const [servers, setServers] = useState<ServerEntry[]>(() => loadServers())
  const [activeServerId, setActiveServerIdState] = useState<string | null>(() => readActiveServerId())
  const [statusByServerId, setStatusByServerId] = useState<Record<string, ServerConnectionStatus>>({})
  const statusByServerIdRef = useRef(statusByServerId)
  statusByServerIdRef.current = statusByServerId
  const [chatsByServerId, setChatsByServerId] = useState<Map<string, ChatSummary[]>>(new Map())
  const [onlineUserIdsByServerId, setOnlineUserIdsByServerId] = useState<Map<string, Set<string>>>(new Map())
  const [lastErrorByServerId, setLastErrorByServerId] = useState<Record<string, string | null>>({})

  const connectionsRef = useRef<Map<string, ConnectionRecord>>(new Map())

  const setActiveServerId = useCallback((serverId: string | null) => {
    persistActiveServerId(serverId)
    setActiveServerIdState(serverId)
  }, [])

  const setServerStatus = useCallback((serverId: string, status: ServerConnectionStatus) => {
    setStatusByServerId((current) => (current[serverId] === status ? current : { ...current, [serverId]: status }))
  }, [])

  const updateServer = useCallback((serverId: string, updates: Partial<ServerEntry>) => {
    setServers((current) => {
      const next = updateServerEntry(current, serverId, updates)
      saveServers(next)
      return next
    })
  }, [])

  const applyServerUpdate = useCallback((serverId: string, updater: (server: ServerEntry) => ServerEntry) => {
    setServers((current) => {
      const next = current.map((server) => (server.id === serverId ? updater(server) : server))
      saveServers(next)
      return next
    })
  }, [])

  const updateChatsForServer = useCallback((serverId: string, chats: ChatSummary[]) => {
    setChatsByServerId((current) => {
      const existing = current.get(serverId) ?? []
      if (chatListsEqual(existing, chats)) {
        return current
      }

      const next = new Map(current)
      next.set(serverId, chats)
      return next
    })
  }, [])

  const updateChatForServer = useCallback((serverId: string, chat: ChatSummary) => {
    setChatsByServerId((current) => {
      const existing = current.get(serverId) ?? []
      const nextChats = [chat, ...existing.filter((entry) => entry.id !== chat.id)]
      const next = new Map(current)
      next.set(serverId, nextChats)
      return next
    })
  }, [])

  const getConnection = useCallback((serverId: string) => connectionsRef.current.get(serverId) ?? null, [])

  const beginChatSnapshotRequest = useCallback((serverId: string): {
    connection: ConnectionRecord | null
    requestId: number
  } => {
    const connection = connectionsRef.current.get(serverId) ?? null
    if (!connection) {
      return { connection: null, requestId: 0 }
    }

    const requestId = (connection.chatSnapshotRequestId ?? 0) + 1
    connection.chatSnapshotRequestId = requestId
    return { connection, requestId }
  }, [])

  const applyChatSnapshotIfCurrent = useCallback((
    serverId: string,
    requestId: number,
    chats: ChatSummary[],
    source: 'bootstrap' | 'refresh'
  ) => {
    const connection = connectionsRef.current.get(serverId)

    if (!connection) {
      return
    }

    const latestApplied = connection.latestAppliedChatSnapshotRequestId ?? 0
    if (requestId < latestApplied) {
      return
    }

    connection.latestAppliedChatSnapshotRequestId = requestId
    updateChatsForServer(serverId, chats)
  }, [updateChatsForServer])

  const refreshServerChats = useCallback(async (serverId: string) => {
    const server = servers.find((entry) => entry.id === serverId)
    const { connection, requestId } = beginChatSnapshotRequest(serverId)

    if (!server?.auth || !connection) {
      return
    }

    const response = await connection.api.listChats(server.auth.accessToken)
    let chats = response.chats

    if (!chats.some((chat) => chat.is_self_chat)) {
      const created = await connection.api.createSelfChat(server.auth.accessToken)
      chats = [created.chat, ...chats]
    }

    applyChatSnapshotIfCurrent(serverId, requestId, chats, 'refresh')
  }, [applyChatSnapshotIfCurrent, beginChatSnapshotRequest, servers])

  const addServer = useCallback((url: string, label: string, color: string) => {
    const entry = buildServerEntry(url, label, color)

    setServers((current) => {
      const next = [...current, { ...entry, sortOrder: current.length }]
      saveServers(next)
      return next
    })

    if (!activeServerId) {
      setActiveServerId(entry.id)
    }

    return entry
  }, [activeServerId, setActiveServerId])

  const removeServer = useCallback((serverId: string) => {
    const connection = connectionsRef.current.get(serverId)
    connection?.unsubscribeUser?.()
    connection?.unsubscribePresence?.()
    connection?.realtime.disconnect()
    connectionsRef.current.delete(serverId)

    setServers((current) => {
      const next = removeServerEntry(current, serverId)
      saveServers(next)
      return next
    })
    setChatsByServerId((current) => {
      const next = new Map(current)
      next.delete(serverId)
      return next
    })
    setOnlineUserIdsByServerId((current) => {
      const next = new Map(current)
      next.delete(serverId)
      return next
    })

    if (activeServerId === serverId) {
      const nextPreferredServer = findPreferredServer(removeServerEntry(servers, serverId))
      setActiveServerId(nextPreferredServer?.id ?? null)
    }
  }, [activeServerId, servers, setActiveServerId])

  const attachAuthSession = useCallback((serverId: string, authSession: AuthSession, serverInfo: ServerEntry['serverInfo']) => {
    updateServer(serverId, { auth: authSession, serverInfo })
    if (!activeServerId) {
      setActiveServerId(serverId)
    }
  }, [activeServerId, setActiveServerId, updateServer])

  const logoutServer = useCallback((serverId: string) => {
    updateServer(serverId, { auth: null, device: null })
    setServerStatus(serverId, 'auth_required')
  }, [setServerStatus, updateServer])

  useEffect(() => {
    const knownIds = new Set(servers.map((server) => server.id))

    for (const [serverId, connection] of connectionsRef.current.entries()) {
      const server = servers.find((entry) => entry.id === serverId)
      if (!server || !server.enabled || !server.auth) {
        connection.unsubscribeUser?.()
        connection.unsubscribePresence?.()
        connection.realtime.disconnect()
        connectionsRef.current.delete(serverId)
      }
    }

    for (const server of servers) {
      if (!server.enabled) {
        setServerStatus(server.id, 'disconnected')
        continue
      }

      if (!server.auth) {
        setServerStatus(server.id, 'auth_required')
        continue
      }

      if (!connectionsRef.current.has(server.id)) {
        connectionsRef.current.set(server.id, {
          api: createServerApiClient(server.url),
          realtime: createServerRealtimeClient(server.url),
          chatSnapshotRequestId: 0,
          latestAppliedChatSnapshotRequestId: 0
        })
      }

      const connection = connectionsRef.current.get(server.id)
      if (!connection) {
        continue
      }

      // Note: accessToken is intentionally excluded — the bootstrap itself
      // refreshes the token (line 270), which changes accessToken, which would
      // change the key, causing the guard to fail and re-bootstrap infinitely.
      const bootstrapKey = JSON.stringify({
        refreshToken: server.auth.refreshToken,
        deviceId: server.device?.deviceId ?? null
      })

      if (
        connection.bootstrapKey === bootstrapKey &&
        connection.bootstrappingKey == null &&
        statusByServerIdRef.current[server.id] === 'connected'
      ) {
        continue
      }

      if (connection.bootstrappingKey === bootstrapKey) {
        continue
      }

      let cancelled = false

      void (async () => {
        connection.bootstrappingKey = bootstrapKey
        setServerStatus(server.id, 'connecting')
        setLastErrorByServerId((current) => ({ ...current, [server.id]: null }))

        try {
          let activeAuth = server.auth
          let serverInfo = server.serverInfo

          if (!activeAuth?.refreshToken) {
            setServerStatus(server.id, 'auth_required')
            setLastErrorByServerId((current) => ({
              ...current,
              [server.id]: 'Authentication is incomplete. Please sign in again.'
            }))
            applyServerUpdate(server.id, (current) => ({ ...current, auth: null }))
            return
          }

          try {
            serverInfo = await connection.api.getServerInfo()
          } catch {
            // Non-fatal; keep cached server info.
          }

          try {
            const refresh = await connection.api.refreshAccessToken(activeAuth.refreshToken)
            activeAuth = {
              ...activeAuth,
              accessToken: refresh.access_token,
              refreshToken: activeAuth.refreshToken,
              user: {
                id: refresh.user.id,
                username: refresh.user.username,
                display_name: refresh.user.display_name,
                role: refresh.user.role,
                temp_password: refresh.user.temp_password
              }
            }
            applyServerUpdate(server.id, (current) => ({
              ...current,
              auth: activeAuth,
              serverInfo,
              lastConnectedAt: current.lastConnectedAt
            }))
          } catch (error) {
            if (!cancelled) {
              connection.bootstrappingKey = null
              setServerStatus(server.id, 'auth_required')
              setLastErrorByServerId((current) => ({
                ...current,
                [server.id]: error instanceof Error ? error.message : 'Authentication expired.'
              }))
              applyServerUpdate(server.id, (current) => ({ ...current, auth: null }))
            }
            return
          }

          const { requestId: bootstrapChatSnapshotRequestId } = beginChatSnapshotRequest(server.id)

          const [me, listChatsResponse] = await Promise.all([
            connection.api.fetchMe(activeAuth.accessToken),
            connection.api.listChats(activeAuth.accessToken)
          ])

          let nextStoredDevice = server.device

          try {
            const deviceResponse = await connection.api.listDevices(activeAuth.accessToken)
            const linkedDeviceStillExists =
              nextStoredDevice
                ? deviceResponse.devices.some(
                    (device) => device.id === nextStoredDevice?.deviceId && !device.revoked_at
                  )
                : false

            if (nextStoredDevice && (!linkedDeviceStillExists || nextStoredDevice.username !== me.user.username)) {
              nextStoredDevice = null
              applyServerUpdate(server.id, (current) => ({ ...current, device: null }))
            }
          } catch {
            // Listing devices is optional at bootstrap time.
          }

          // Detect legacy P-256 device and force re-registration
          if (nextStoredDevice && nextStoredDevice.privateKeyPkcs8Base64 && !nextStoredDevice.identityKeyPairJson) {
            nextStoredDevice = null
            applyServerUpdate(server.id, (current) => ({ ...current, device: null }))
          }

          if (!nextStoredDevice) {
            try {
              const signalIdentity = await generateSignalIdentity()
              const signedPreKeyId = 1
              const oneTimePreKeyStartId = 1
              const signalPrekeys = await generateSignalPrekeys(
                signalIdentity.identityKeyPair,
                signedPreKeyId,
                oneTimePreKeyStartId,
                16
              )

              // Initialize Signal store and persist keys
              const identityKeyPairJson = JSON.stringify({
                pubKey: arrayBufferToBase64(signalIdentity.identityKeyPair.pubKey),
                privKey: arrayBufferToBase64(signalIdentity.identityKeyPair.privKey)
              })
              const store = initSignalStore(identityKeyPairJson, signalIdentity.registrationId)

              // Persist signed prekey and one-time prekeys in Signal store
              await store.storeSignedPreKey(signedPreKeyId, signalPrekeys.signedPreKey.keyPair)
              for (const preKey of signalPrekeys.preKeys) {
                await store.storePreKey(preKey.keyId, preKey.keyPair)
              }

              const identityPubBase64 = arrayBufferToBase64(signalIdentity.identityKeyPair.pubKey)
              const signedPreKeyPubBase64 = arrayBufferToBase64(signalPrekeys.signedPreKey.keyPair.pubKey)
              const signedPreKeySigBase64 = arrayBufferToBase64(signalPrekeys.signedPreKey.signature)

              const linked = await connection.api.linkDevice(activeAuth.accessToken, {
                device_name: 'Web',
                device_identity_public_key: identityPubBase64,
                device_encryption_public_key: identityPubBase64,
                signed_prekey: signedPreKeyPubBase64,
                signed_prekey_signature: signedPreKeySigBase64,
                registration_id: signalIdentity.registrationId,
                signed_prekey_id: signedPreKeyId,
                one_time_prekeys: signalPrekeys.preKeys.map((key) => ({
                  key_id: key.keyId,
                  public_key: arrayBufferToBase64(key.keyPair.pubKey)
                }))
              })

              nextStoredDevice = {
                deviceId: linked.device.id,
                deviceName: linked.device.device_name,
                registrationId: signalIdentity.registrationId,
                identityKeyPairJson,
                signedPreKeyIdCounter: signedPreKeyId,
                oneTimePreKeyIdCounter: oneTimePreKeyStartId + signalPrekeys.preKeys.length,
                sessionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                sessionToken: activeAuth.accessToken,
                username: me.user.username
              }

              applyServerUpdate(server.id, (current) => ({ ...current, device: nextStoredDevice }))
            } catch (deviceError) {
              console.warn(`[useServers] device bootstrap failed for ${server.url}:`, deviceError)
            }
          } else if (nextStoredDevice.identityKeyPairJson) {
            // Re-initialize Signal store from existing device
            initSignalStore(nextStoredDevice.identityKeyPairJson, nextStoredDevice.registrationId)
          }

          let chats = listChatsResponse.chats
          if (!chats.some((chat) => chat.is_self_chat)) {
            const created = await connection.api.createSelfChat(activeAuth.accessToken)
            chats = [created.chat, ...chats]
          }

          if (cancelled) {
            connection.bootstrappingKey = null
            return
          }

          applyChatSnapshotIfCurrent(server.id, bootstrapChatSnapshotRequestId, chats, 'bootstrap')

          connection.realtime.connect(activeAuth.accessToken)
          connection.unsubscribeUser?.()
          connection.unsubscribePresence?.()
          connection.unsubscribeUser = connection.realtime.subscribeToUserStream(me.user.id, {
            onChatActivity(rawChatId) {
              void refreshServerChats(server.id)
                .then(() => {
                  existingChatActivityRef?.current?.(qualifyChatId(server.id, rawChatId))
                })
                .catch(() => undefined)
            }
          })
          connection.unsubscribePresence = connection.realtime.subscribeToPresence({
            onSync(onlineUserIds) {
              setOnlineUserIdsByServerId((current) => {
                const next = new Map(current)
                next.set(server.id, onlineUserIds)
                return next
              })
            }
          })

          setServerStatus(server.id, 'connected')
          connection.bootstrapKey = bootstrapKey
          connection.bootstrappingKey = null
          applyServerUpdate(server.id, (current) => ({
            ...current,
            auth: activeAuth,
            device: nextStoredDevice ?? current.device,
            serverInfo,
            lastConnectedAt: new Date().toISOString()
          }))
        } catch (error) {
          if (!cancelled) {
            connection.bootstrappingKey = null
            setServerStatus(server.id, 'error')
            setLastErrorByServerId((current) => ({
              ...current,
              [server.id]: error instanceof Error ? error.message : 'Failed to connect.'
            }))
          }
        }
      })()

      if (!knownIds.has(server.id)) {
        cancelled = true
      }
    }

    // Note: statusByServerId is intentionally excluded — it is written by this
    // effect (via setServerStatus) and only read as an optimisation guard.
    // No cleanup function here — subscriptions are managed by the bootstrap
    // logic itself (it unsubscribes before re-subscribing at lines 375-376),
    // and by removeServer.  Returning a cleanup would tear down live WebSocket
    // subscriptions every time `servers` changes during bootstrap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    applyServerUpdate,
    existingChatActivityRef,
    refreshServerChats,
    servers,
    setServerStatus,
    applyChatSnapshotIfCurrent,
    beginChatSnapshotRequest,
    updateChatsForServer
  ])

  useEffect(() => {
    const selectedServer = activeServerId
      ? servers.find((server) => server.id === activeServerId) ?? null
      : null
    const primary = findPrimaryServer(servers)
    const preferred = findPreferredServer(servers)

    if (!selectedServer) {
      if (preferred) {
        setActiveServerId(preferred.id)
      }
      return
    }

    if ((!selectedServer.enabled || !selectedServer.auth) && primary && primary.id !== selectedServer.id) {
      setActiveServerId(primary.id)
    }
  }, [activeServerId, servers, setActiveServerId])

  const mergedChats = useMemo(() => mergeServerChats(servers, chatsByServerId), [servers, chatsByServerId])
  const hasAuthenticatedServer = useMemo(
    () => servers.some((server) => server.enabled && !!server.auth),
    [servers]
  )
  const activeServer = useMemo(() => {
    const selectedServer = activeServerId
      ? servers.find((server) => server.id === activeServerId) ?? null
      : null
    const primary = findPrimaryServer(servers)
    const preferred = findPreferredServer(servers)

    if (selectedServer?.enabled && (selectedServer.auth || !primary)) {
      return selectedServer
    }

    return primary ?? selectedServer ?? preferred ?? null
  }, [activeServerId, servers])

  const activeServerScope = useMemo(() => {
    if (!activeServer) {
      return null
    }

    const connection = getConnection(activeServer.id)
    if (!connection) {
      return null
    }

    return {
      server: activeServer,
      api: connection.api,
      realtime: connection.realtime,
      token: activeServer.auth?.accessToken ?? null,
      device: activeServer.device
    }
  }, [activeServer, getConnection])

  const resolveServerForChat = useCallback((qualifiedChatId: string | null) => {
    const server = serverForChat(servers, qualifiedChatId)
    if (!server) {
      return null
    }

    const connection = getConnection(server.id)
    if (!connection) {
      return null
    }

    return {
      server,
      api: connection.api,
      realtime: connection.realtime,
      token: server.auth?.accessToken ?? null,
      device: server.device,
      rawChatId: getRawChatId(qualifiedChatId)
    }
  }, [getConnection, servers])

  const isUserOnline = useCallback((serverId: string, userId: string) => {
    return onlineUserIdsByServerId.get(serverId)?.has(userId) ?? false
  }, [onlineUserIdsByServerId])

  return {
    servers,
    activeServerId,
    setActiveServerId,
    activeServer,
    activeServerScope,
    statusByServerId,
    chatsByServerId,
    mergedChats,
    hasAuthenticatedServer,
    lastErrorByServerId,
    addServer,
    removeServer,
    updateServer,
    attachAuthSession,
    logoutServer,
    refreshServerChats,
    updateChatsForServer,
    updateChatForServer,
    resolveServerForChat,
    serverIdForChatId: getServerIdFromQualifiedChatId,
    isUserOnline
  }
}
