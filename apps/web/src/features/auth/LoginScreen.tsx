import { useMemo, useState, type FormEvent } from 'react'
import { Zap, User, Lock, Eye, EyeOff, Plus, Server, Trash2 } from 'lucide-react'
import type { AuthView, ServerInfo } from '../../types.ts'
import type { useServers } from '../../hooks/useServers.ts'
import { DEFAULT_MULTI_SERVER_COLOR } from '../../constants.ts'
import { createServerApiClient } from '../../lib/server-api.ts'
import { defaultServerLabel, normalizeServerUrl } from '../../lib/multi-server.ts'

type Props = {
  servers: ReturnType<typeof useServers>
  serverInfo: ServerInfo | null
  serverUrl: string
  serverName: string | null
  error: string | null
  loading: boolean
  onLogin: (username: string, password: string) => void
  onDevQuickLogin: (username: string) => void
  onNavigate: (view: AuthView) => void
}

function generateDevUsername(): string {
  const n = Math.floor(1000 + Math.random() * 9000)
  return `dev_user_${n}`
}

function formatServerHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

export function LoginScreen({
  servers,
  serverInfo,
  serverUrl,
  serverName,
  error,
  loading,
  onLogin,
  onDevQuickLogin,
  onNavigate
}: Props) {
  const isDevMode = serverInfo?.auth_mode === 'dev'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState(isDevMode ? 'password' : '')
  const [showPassword, setShowPassword] = useState(false)
  const [draftUrl, setDraftUrl] = useState('')
  const [draftLabel, setDraftLabel] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [addingServer, setAddingServer] = useState(false)

  const hasError = !!error
  const selectedServer = servers.activeServer
  const serverTitle = serverInfo?.name ?? serverName ?? formatServerHost(serverUrl)
  const sortedServers = useMemo(
    () => [...servers.servers].sort((left, right) => left.sortOrder - right.sortOrder),
    [servers.servers]
  )

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    onLogin(username, password)
  }

  function handleDevQuickLogin() {
    const name = username || generateDevUsername()
    onDevQuickLogin(name)
  }

  async function handleAddServer(event: FormEvent) {
    event.preventDefault()

    const normalizedUrl = normalizeServerUrl(draftUrl)
    if (!normalizedUrl) {
      setServerError('Enter a valid server URL.')
      return
    }

    setAddingServer(true)
    setServerError(null)

    try {
      const client = createServerApiClient(normalizedUrl)
      const nextServerInfo = await client.getServerInfo().catch(() => null)
      const existingServer = servers.servers.find(
        (entry) => normalizeServerUrl(entry.url) === normalizedUrl
      )
      const nextLabel = draftLabel.trim() || defaultServerLabel(nextServerInfo?.name)

      if (existingServer) {
        servers.updateServer(existingServer.id, {
          label: nextLabel,
          serverInfo: nextServerInfo ?? existingServer.serverInfo,
          enabled: true
        })
        servers.setActiveServerId(existingServer.id)
      } else {
        const created = servers.addServer(normalizedUrl, nextLabel, DEFAULT_MULTI_SERVER_COLOR)
        servers.updateServer(created.id, {
          serverInfo: nextServerInfo
        })
        servers.setActiveServerId(created.id)
      }

      setDraftUrl('')
      setDraftLabel('')
      onNavigate(nextServerInfo?.bootstrap ? 'server-bootstrap' : 'login')
    } catch (addError) {
      setServerError(addError instanceof Error ? addError.message : 'Failed to add server.')
    } finally {
      setAddingServer(false)
    }
  }

  return (
    <div className="auth-shell">
      {isDevMode && (
        <div className="auth-dev-banner">
          <span>⚠ DEV MODE — Open registration enabled. Do not use in production.</span>
        </div>
      )}
      <div className="auth-card">
        <div className="auth-server-panel">
          <div className="auth-server-panel__header">
            <div>
              <p className="auth-server-panel__eyebrow">Server</p>
              <h2 className="auth-server-panel__title">{selectedServer?.label ?? serverTitle}</h2>
              <p className="auth-server-panel__subtitle">{formatServerHost(serverUrl)}</p>
            </div>
          </div>

          {sortedServers.length > 0 ? (
            <div className="auth-server-list">
              {sortedServers.map((entry) => {
                const isSelected = entry.id === selectedServer?.id
                const status = servers.statusByServerId[entry.id]
                const statusText =
                  status === 'connected'
                    ? 'Connected'
                    : status === 'connecting'
                      ? 'Connecting'
                      : status === 'auth_required'
                        ? 'Sign in required'
                        : status === 'error'
                          ? (servers.lastErrorByServerId[entry.id] ?? 'Connection issue')
                          : entry.enabled
                            ? 'Ready'
                            : 'Disabled'

                return (
                  <div
                    key={entry.id}
                    className={`auth-server-item${isSelected ? ' auth-server-item--active' : ''}`}
                  >
                    <button
                      className="auth-server-item__select"
                      type="button"
                      onClick={() => {
                        servers.setActiveServerId(entry.id)
                        onNavigate('login')
                      }}
                    >
                      <span
                        className="auth-server-item__swatch"
                        style={{ background: entry.color }}
                      />
                      <span className="auth-server-item__content">
                        <span className="auth-server-item__label">{entry.label}</span>
                        <span className="auth-server-item__meta">{formatServerHost(entry.url)} · {statusText}</span>
                      </span>
                    </button>
                    <button
                      className="auth-server-item__remove"
                      type="button"
                      onClick={() => servers.removeServer(entry.id)}
                      aria-label={`Remove ${entry.label}`}
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                  </div>
                )
              })}
            </div>
          ) : null}

          <form className="auth-server-add" onSubmit={handleAddServer}>
            <div className="auth-input-row">
              <Server size={18} color="var(--text-muted)" strokeWidth={1.75} />
              <input
                className="auth-input"
                placeholder="https://chat.example.com"
                value={draftUrl}
                onChange={(event) => setDraftUrl(event.target.value)}
                disabled={addingServer}
              />
            </div>
            <div className="auth-input-row">
              <User size={18} color="var(--text-muted)" strokeWidth={1.75} />
              <input
                className="auth-input"
                placeholder="Optional label"
                value={draftLabel}
                onChange={(event) => setDraftLabel(event.target.value)}
                disabled={addingServer}
              />
            </div>
            {serverError ? <p className="auth-error">{serverError}</p> : null}
            <button className="auth-link auth-link--accent auth-link--row" type="submit" disabled={addingServer}>
              {addingServer ? <span className="auth-spinner" /> : <Plus size={16} strokeWidth={1.75} />}
              <span>{addingServer ? 'Adding server…' : 'Add Server'}</span>
            </button>
          </form>
        </div>

        <div className="auth-card__logo">
          <Zap size={40} color="var(--accent)" strokeWidth={1.75} />
        </div>
        <h1 className="auth-card__title">Vostok</h1>
        <p className="auth-card__subtitle">{serverTitle}</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className={`auth-input-row${hasError ? ' auth-input-row--error' : ''}`}>
            <User size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              autoComplete="username"
              placeholder="Username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />
            {isDevMode && (
              <button
                type="button"
                className="auth-random-btn"
                onClick={() => setUsername(generateDevUsername())}
                tabIndex={-1}
              >
                Random
              </button>
            )}
          </div>

          <div className={`auth-input-row${hasError ? ' auth-input-row--error' : ''}`}>
            <Lock size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            <button
              type="button"
              className="auth-eye-toggle"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword
                ? <EyeOff size={18} strokeWidth={1.75} />
                : <Eye size={18} strokeWidth={1.75} />}
            </button>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button className="auth-btn-primary" type="submit" disabled={loading}>
            {loading ? <span className="auth-spinner" /> : 'Sign In'}
          </button>
        </form>

        <button
          className="auth-link auth-link--accent"
          type="button"
          onClick={() => onNavigate('forgot-password')}
        >
          Forgot password?
        </button>

        <div className="auth-divider">
          <span />
          <span>or</span>
          <span />
        </div>

        <button
          className="auth-link auth-link--accent"
          type="button"
          onClick={() => onNavigate('invite-code')}
        >
          I have an invite code
        </button>

        {isDevMode && (
          <button
            className="auth-link auth-link--warning"
            type="button"
            disabled={loading}
            onClick={handleDevQuickLogin}
          >
            Create Dev Account
          </button>
        )}

        {serverInfo?.access_requests_enabled && (
          <button
            className="auth-link auth-link--muted"
            type="button"
            onClick={() => onNavigate('access-request')}
          >
            Request Access
          </button>
        )}
      </div>
    </div>
  )
}
