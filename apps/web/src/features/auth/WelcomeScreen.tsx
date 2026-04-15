import { useState, type FormEvent } from 'react'
import { Zap, Server, Upload } from 'lucide-react'
import type { AuthView } from '../../types.ts'
import type { useServers } from '../../hooks/useServers.ts'
import { DEFAULT_MULTI_SERVER_COLOR } from '../../constants.ts'
import { createServerApiClient } from '../../lib/server-api.ts'
import { defaultServerLabel, normalizeServerUrl } from '../../lib/multi-server.ts'
import { t } from '../../lib/i18n.ts'

type Props = {
  servers: ReturnType<typeof useServers>
  onNavigate: (view: AuthView) => void
}

export function WelcomeScreen({ servers, onNavigate }: Props) {
  const [showUrlInput, setShowUrlInput] = useState(false)
  const [draftUrl, setDraftUrl] = useState('')
  const [probing, setProbing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConnect(event: FormEvent) {
    event.preventDefault()

    const normalizedUrl = normalizeServerUrl(draftUrl)
    if (!normalizedUrl) {
      setError(t('enter_valid_url'))
      return
    }

    setProbing(true)
    setError(null)

    try {
      const client = createServerApiClient(normalizedUrl)
      const info = await client.getServerInfo().catch(() => null)

      const existing = servers.servers.find(
        (entry) => normalizeServerUrl(entry.url) === normalizedUrl,
      )

      if (existing) {
        servers.updateServer(existing.id, {
          serverInfo: info ?? existing.serverInfo,
          enabled: true,
        })
        servers.setActiveServerId(existing.id)
      } else {
        const label = defaultServerLabel(info?.name)
        const created = servers.addServer(normalizedUrl, label, DEFAULT_MULTI_SERVER_COLOR)
        servers.updateServer(created.id, { serverInfo: info })
        servers.setActiveServerId(created.id)
      }

      onNavigate(info?.bootstrap ? 'server-bootstrap' : 'login')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('could_not_reach_server'))
    } finally {
      setProbing(false)
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-card__logo">
          <Zap size={40} color="var(--accent)" strokeWidth={1.75} />
        </div>
        <h1 className="auth-card__title">{t('welcome_title')}</h1>
        <p className="auth-card__subtitle">{t('welcome_subtitle')}</p>

        {showUrlInput ? (
          <form className="auth-form" onSubmit={handleConnect}>
            <div className={`auth-input-row${error ? ' auth-input-row--error' : ''}`}>
              <Server size={18} color="var(--text-muted)" strokeWidth={1.75} />
              <input
                className="auth-input"
                placeholder={t('server_url_placeholder')}
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                disabled={probing}
                autoFocus
              />
            </div>
            {error && <p className="auth-error">{error}</p>}
            <button className="auth-btn-primary" type="submit" disabled={probing}>
              {probing ? <span className="auth-spinner" /> : t('continue')}
            </button>
            <button
              className="auth-link auth-link--muted"
              type="button"
              onClick={() => { setShowUrlInput(false); setError(null) }}
            >
              {t('back')}
            </button>
          </form>
        ) : (
          <div className="auth-welcome-actions">
            <button
              className="auth-btn-primary"
              type="button"
              onClick={() => setShowUrlInput(true)}
            >
              <Server size={16} strokeWidth={1.75} />
              <span>{t('connect_to_server')}</span>
            </button>
            <button
              className="auth-btn-secondary"
              type="button"
              onClick={() => onNavigate('restore-backup')}
            >
              <Upload size={16} strokeWidth={1.75} />
              <span>{t('restore_from_backup')}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
