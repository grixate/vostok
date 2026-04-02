import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatSummary } from '../lib/api.ts'
import { generateDeviceIdentity, generateDevicePrekeys } from '../lib/device-auth.ts'
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

export function useServers() {
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

  const refreshServerChats = useCallback(async (serverId: string) => {
    const server = servers.find((entry) => entry.id === serverId)
    const connection = connectionsRef.current.get(serverId)

    if (!server?.auth || !connection) {
      return
    }

    const response = await connection.api.listChats(server.auth.accessToken)
    let chats = response.chats

    if (!chats.some((chat) => chat.is_self_chat)) {
      const created = await connection.api.createSelfChat(server.auth.accessToken)
      chats = [created.chat, ...chats]
    }

    updateChatsForServer(serverId, chats)
  }, [servers, updateChatsForServer])

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
          realtime: createServerRealtimeClient(server.url)
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

          if (!nextStoredDevice) {
            try {
              const identity = await generateDeviceIdentity()
              const prekeys = await generateDevicePrekeys(identity.signingPrivateKeyPkcs8Base64)
              const linked = await connection.api.linkDevice(activeAuth.accessToken, {
                device_name: 'Web',
                device_identity_public_key: identity.signingPublicKeyBase64,
                device_encryption_public_key: identity.encryptionPublicKeyBase64,
                signed_prekey: prekeys.signedPrekey.publicKeyBase64,
                signed_prekey_signature: prekeys.signedPrekey.signatureBase64,
                one_time_prekeys: prekeys.oneTimePrekeys.map((key) => key.publicKeyBase64)
              })

              nextStoredDevice = {
                deviceId: linked.device.id,
                deviceName: linked.device.device_name,
                privateKeyPkcs8Base64: identity.signingPrivateKeyPkcs8Base64,
                publicKeyBase64: identity.signingPublicKeyBase64,
                encryptionPrivateKeyPkcs8Base64: identity.encryptionPrivateKeyPkcs8Base64,
                encryptionPublicKeyBase64: identity.encryptionPublicKeyBase64,
                signedPrekeyPublicKeyBase64: prekeys.signedPrekey.publicKeyBase64,
                signedPrekeyPrivateKeyPkcs8Base64: prekeys.signedPrekey.privateKeyPkcs8Base64,
                signedPrekeys: [prekeys.signedPrekey],
                oneTimePrekeys: prekeys.oneTimePrekeys,
                sessionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                sessionToken: activeAuth.accessToken,
                username: me.user.username
              }

              applyServerUpdate(server.id, (current) => ({ ...current, device: nextStoredDevice }))
            } catch (deviceError) {
              console.warn(`[useServers] device bootstrap failed for ${server.url}:`, deviceError)
            }
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

          updateChatsForServer(server.id, chats)

          connection.realtime.connect(activeAuth.accessToken)
          connection.unsubscribeUser?.()
          connection.unsubscribePresence?.()
          connection.unsubscribeUser = connection.realtime.subscribeToUserStream(me.user.id, {
            onChatActivity(rawChatId) {
              void refreshServerChats(server.id).catch(() => undefined)
              setChatsByServerId((current) => {
                const existing = current.get(server.id) ?? []
                if (existing.some((chat) => chat.id === rawChatId)) {
                  return current
                }
                return current
              })
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
  }, [applyServerUpdate, refreshServerChats, servers, setServerStatus, updateChatsForServer])

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
