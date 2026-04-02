import { startTransition, useEffect, useMemo, useState } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import type { AuthView, AuthSession, ServerInfo } from '../types.ts'
import type { InviteValidation, LoginResponse } from '../lib/api.ts'
import { normalizeServerUrl } from '../lib/multi-server.ts'
import { createServerApiClient } from '../lib/server-api.ts'
import { persistAuthSession, persistStoredDevice, readAuthSession } from '../utils/storage.ts'

export function useAuth(serverBaseUrl?: string | null) {
  const { setStoredDevice, setBanner, setLoading } = useAppContext()
  const resolvedServerBaseUrl = normalizeServerUrl(
    serverBaseUrl?.trim() || (typeof window !== 'undefined' ? window.location.origin : '')
  )
  const currentOriginBaseUrl = normalizeServerUrl(
    typeof window !== 'undefined' ? window.location.origin : resolvedServerBaseUrl
  )
  const useLegacyStorage = resolvedServerBaseUrl === currentOriginBaseUrl
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => (
    useLegacyStorage ? readAuthSession() : null
  ))
  const [authSessionServerUrl, setAuthSessionServerUrl] = useState<string | null>(() => (
    useLegacyStorage && readAuthSession() ? currentOriginBaseUrl : null
  ))
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)
  const [view, setView] = useState<AuthView>(() => (
    useLegacyStorage && readAuthSession() ? 'chat' : 'welcome'
  ))
  const [error, setError] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(true)
  const serverClient = useMemo(
    () => createServerApiClient(resolvedServerBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '')),
    [resolvedServerBaseUrl]
  )

  useEffect(() => {
    if (authSessionServerUrl === resolvedServerBaseUrl) {
      return
    }

    if (!useLegacyStorage) {
      setAuthSession(null)
      setAuthSessionServerUrl(null)
      setInviteCode(null)
      setError(null)
      setView('login')
    }
  }, [authSessionServerUrl, resolvedServerBaseUrl, useLegacyStorage])

  // Clear error when navigating between screens
  function navigateTo(nextView: AuthView) {
    setError(null)
    setView(nextView)
  }

  // Fetch server info whenever the selected pre-auth server changes.
  useEffect(() => {
    let cancelled = false

    setServerInfo(null)

    serverClient.getServerInfo()
      .then((info) => {
        if (cancelled) {
          return
        }

        setServerInfo(info)
        const hasStoredSession = useLegacyStorage ? !!readAuthSession() : !!authSession
        if (info.bootstrap && !hasStoredSession) {
          setView('server-bootstrap')
        } else if (!hasStoredSession) {
          setView('login')
        }
      })
      .catch(() => {
        // Server may not support the new endpoint yet
      })
    return () => {
      cancelled = true
    }
  }, [authSession, serverClient, useLegacyStorage])

  // Handle /invite/:code URL on mount
  useEffect(() => {
    const path = window.location.pathname
    const match = path.match(/^\/invite\/([a-zA-Z0-9]+)$/)
    if (!match) return

    const code = match[1]

    serverClient.validateInvite(code)
      .then((result) => {
        if (result.valid) {
          setInviteCode(code)
          setView('create-account')
        } else {
          setError(result.reason ?? 'This invite link is invalid or has expired.')
          setView('login')
        }
      })
      .catch(() => {
        setError('Could not validate invite link.')
        setView('login')
      })
      .finally(() => {
        // Clean up the URL without reloading
        window.history.replaceState(null, '', '/')
      })
  }, [serverClient])

  // Attempt silent refresh on mount if we have a stored session
  useEffect(() => {
    if (!useLegacyStorage) {
      setInitializing(false)
      return
    }

    const stored = readAuthSession()
    if (!stored) {
      setInitializing(false)
      return
    }

    serverClient.refreshAccessToken(stored.refreshToken)
      .then((result) => {
        const updated: AuthSession = {
          ...stored,
          accessToken: result.access_token,
          user: {
            id: result.user.id,
            username: result.user.username,
            display_name: result.user.display_name,
            role: result.user.role,
            temp_password: result.user.temp_password
          }
        }
        persistAuthSession(updated)
        setAuthSession(updated)
        setAuthSessionServerUrl(currentOriginBaseUrl)

        if (result.user.temp_password) {
          setView('force-password-change')
        } else {
          setView('chat')
        }
      })
      .catch(() => {
        persistAuthSession(null)
        setAuthSession(null)
        setView('login')
      })
      .finally(() => {
        setInitializing(false)
      })
  }, [currentOriginBaseUrl, serverClient, useLegacyStorage])

  function handleLoginResponse(response: LoginResponse) {
    const session: AuthSession = {
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      user: {
        id: response.user.id,
        username: response.user.username,
        display_name: response.user.display_name,
        role: response.user.role,
        temp_password: response.user.temp_password
      }
    }

    if (useLegacyStorage) {
      persistAuthSession(session)
    }
    setAuthSession(session)
    setAuthSessionServerUrl(useLegacyStorage ? currentOriginBaseUrl : resolvedServerBaseUrl)
    setError(null)

    if (response.user.temp_password) {
      setView('force-password-change')
    } else {
      startTransition(() => setView('chat'))
    }
  }

  async function handleLogin(username: string, password: string) {
    setAuthLoading(true)
    setError(null)

    try {
      const response = await serverClient.login(username, password)
      handleLoginResponse(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed.')
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleRegister(
    code: string | null,
    username: string,
    displayName: string,
    password: string
  ) {
    setAuthLoading(true)
    setError(null)

    try {
      const response = await serverClient.register({
        invite_code: code ?? undefined,
        username,
        display_name: displayName || undefined,
        password
      })
      handleLoginResponse(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.')
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleBootstrap(username: string, displayName: string, password: string) {
    setAuthLoading(true)
    setError(null)

    try {
      const response = await serverClient.bootstrap({
        username,
        display_name: displayName || undefined,
        password
      })
      handleLoginResponse(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bootstrap failed.')
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleDevQuickLogin(username: string) {
    setAuthLoading(true)
    setError(null)

    try {
      const response = await serverClient.devQuickLogin(username)
      handleLoginResponse(response)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dev login failed.')
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleChangePassword(newPassword: string) {
    if (!authSession) return
    setAuthLoading(true)
    setError(null)

    try {
      await serverClient.changePassword(authSession.accessToken, newPassword)

      const updated: AuthSession = {
        ...authSession,
        user: { ...authSession.user, temp_password: false }
      }
      if (useLegacyStorage) {
        persistAuthSession(updated)
      }
      setAuthSession(updated)
      setAuthSessionServerUrl(useLegacyStorage ? currentOriginBaseUrl : resolvedServerBaseUrl)
      startTransition(() => setView('chat'))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password.')
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleLogout() {
    if (authSession) {
      try {
        await serverClient.logout(authSession.accessToken, authSession.refreshToken)
      } catch {
        // Best-effort logout
      }
    }

    if (useLegacyStorage) {
      persistAuthSession(null)
    }
    setAuthSession(null)
    setAuthSessionServerUrl(null)
    setError(null)
    setBanner(null)
    setLoading(false)
    startTransition(() => setView('login'))
  }

  async function handleForgetDevice() {
    await handleLogout()
    if (useLegacyStorage) {
      persistStoredDevice(null)
    }
    setStoredDevice(null)
  }

  function handleInviteContinue(code: string) {
    setInviteCode(code)
    navigateTo('create-account')
  }

  async function handleCheckUsername(username: string): Promise<{ available: boolean }> {
    return serverClient.checkUsername(username)
  }

  async function handleValidateInvite(code: string): Promise<InviteValidation> {
    return serverClient.validateInvite(code)
  }

  async function handleRequestAccess(name: string, message?: string): Promise<{ ok: boolean }> {
    return serverClient.requestAccess(name, message)
  }

  async function handleRequestPasswordReset(username: string, message?: string): Promise<{ ok: boolean }> {
    return serverClient.requestPasswordReset(username, message)
  }

  // Expose profileUsername for backwards compat with existing hooks
  const profileUsername = authSession?.user.username ?? null

  return {
    view,
    setView: navigateTo,
    authSession,
    authSessionServerUrl,
    serverInfo,
    error,
    loading: authLoading,
    initializing,
    inviteCode,
    profileUsername,
    handleLogin,
    handleRegister,
    handleBootstrap,
    handleDevQuickLogin,
    handleChangePassword,
    handleLogout,
    handleInviteContinue,
    handleCheckUsername,
    handleValidateInvite,
    handleRequestAccess,
    handleRequestPasswordReset,
    // Legacy compat — these are still used by App.tsx / other hooks
    handleForgetDevice,
    setProfileUsername: (() => {}) as (value: string | null) => void,
    username: authSession?.user.username ?? '',
    setUsername: (() => {}) as (value: string) => void,
    deviceName: '',
    setDeviceName: (() => {}) as (value: string) => void,
    handleReauthenticate: () => {},
    _handleRotatePrekeys: () => {},
    _handleRevokeLinkedDevice: (() => {}) as (deviceId: string) => void,
    refreshDeviceList: (async () => undefined) as (token: string) => Promise<void>,
    setDevices: (() => {}) as (devices: unknown) => void,
    fetchMe: (() => undefined) as () => void
  }
}
