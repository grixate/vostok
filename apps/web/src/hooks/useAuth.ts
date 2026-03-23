import { startTransition, useState, useEffect } from 'react'
import { useAppContext } from '../contexts/AppContext.tsx'
import type { AuthView, AuthSession, ServerInfo } from '../types.ts'
import {
  login as apiLogin,
  authRegister,
  authBootstrap,
  authLogout,
  refreshAccessToken,
  changePassword as apiChangePassword,
  getServerInfo,
  devQuickLogin as apiDevQuickLogin,
  validateInvite,
  type LoginResponse
} from '../lib/api.ts'
import { persistAuthSession, readAuthSession } from '../utils/storage.ts'

export function useAuth() {
  const { setStoredDevice, setBanner, setLoading } = useAppContext()
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => readAuthSession())
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null)
  const [view, setView] = useState<AuthView>(() => (readAuthSession() ? 'chat' : 'login'))
  const [error, setError] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [inviteCode, setInviteCode] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(true)

  // Clear error when navigating between screens
  function navigateTo(nextView: AuthView) {
    setError(null)
    setView(nextView)
  }

  // Fetch server info on mount
  useEffect(() => {
    getServerInfo()
      .then((info) => {
        setServerInfo(info)
        if (info.bootstrap && !readAuthSession()) {
          setView('server-bootstrap')
        }
      })
      .catch(() => {
        // Server may not support the new endpoint yet
      })
  }, [])

  // Handle /invite/:code URL on mount
  useEffect(() => {
    const path = window.location.pathname
    const match = path.match(/^\/invite\/([a-zA-Z0-9]+)$/)
    if (!match) return

    const code = match[1]

    validateInvite(code)
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
  }, [])

  // Attempt silent refresh on mount if we have a stored session
  useEffect(() => {
    const stored = readAuthSession()
    if (!stored) {
      setInitializing(false)
      return
    }

    refreshAccessToken(stored.refreshToken)
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
  }, [])

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

    persistAuthSession(session)
    setAuthSession(session)
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
      const response = await apiLogin(username, password)
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
      const response = await authRegister({
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
      const response = await authBootstrap({
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
      const response = await apiDevQuickLogin(username)
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
      await apiChangePassword(authSession.accessToken, newPassword)

      const updated: AuthSession = {
        ...authSession,
        user: { ...authSession.user, temp_password: false }
      }
      persistAuthSession(updated)
      setAuthSession(updated)
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
        await authLogout(authSession.accessToken, authSession.refreshToken)
      } catch {
        // Best-effort logout
      }
    }

    persistAuthSession(null)
    setAuthSession(null)
    setError(null)
    startTransition(() => setView('login'))
  }

  function handleInviteContinue(code: string) {
    setInviteCode(code)
    navigateTo('create-account')
  }

  // Expose profileUsername for backwards compat with existing hooks
  const profileUsername = authSession?.user.username ?? null

  return {
    view,
    setView: navigateTo,
    authSession,
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
    // Legacy compat — these are still used by App.tsx / other hooks
    handleForgetDevice: handleLogout,
    setProfileUsername: (_: string | null) => {},
    username: authSession?.user.username ?? '',
    setUsername: (_: string) => {},
    deviceName: '',
    setDeviceName: (_: string) => {},
    handleReauthenticate: () => {},
    _handleRotatePrekeys: () => {},
    _handleRevokeLinkedDevice: (_: string) => {},
    refreshDeviceList: async (_: string) => {},
    setDevices: (_: any) => {},
    fetchMe: (() => {}) as any
  }
}
