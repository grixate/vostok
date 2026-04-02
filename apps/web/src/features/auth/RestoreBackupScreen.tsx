import { useRef, useState, type FormEvent } from 'react'
import { Zap, Lock, Eye, EyeOff, Upload, CheckCircle, XCircle, Loader } from 'lucide-react'
import type { AuthView } from '../../types.ts'
import type { useServers } from '../../hooks/useServers.ts'
import { DEFAULT_MULTI_SERVER_COLOR } from '../../constants.ts'
import { importBackupFile, validateBackupMagic, type BackupPayload, type BackupServerEntry } from '../../lib/backup-crypto.ts'
import { createServerApiClient } from '../../lib/server-api.ts'
import { normalizeServerUrl } from '../../lib/multi-server.ts'
import { useBackupState } from '../../hooks/useBackupState.ts'

type Props = {
  servers: ReturnType<typeof useServers>
  onNavigate: (view: AuthView) => void
}

type ServerRestoreStatus =
  | { state: 'pending' }
  | { state: 'restoring' }
  | { state: 'connected'; username: string }
  | { state: 'needs_password'; username: string }
  | { state: 'unreachable' }
  | { state: 'failed'; message: string }

type ServerRestoreEntry = {
  backup: BackupServerEntry
  status: ServerRestoreStatus
  passwordInput: string
  loginError: string | null
}

export function RestoreBackupScreen({ servers, onNavigate }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { updateState: updateBackupState } = useBackupState()
  const [step, setStep] = useState<'pick' | 'restoring'>('pick')
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [passphrase, setPassphrase] = useState('')
  const [showPassphrase, setShowPassphrase] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [decrypting, setDecrypting] = useState(false)
  const [entries, setEntries] = useState<ServerRestoreEntry[]>([])

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setError(null)
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer)
      if (!validateBackupMagic(bytes)) {
        setError('This file is not a valid Vostok backup.')
        setFileBytes(null)
        return
      }
      setFileBytes(bytes)
    }
    reader.readAsArrayBuffer(file)
  }

  async function handleDecrypt(event: FormEvent) {
    event.preventDefault()
    if (!fileBytes) return

    setDecrypting(true)
    setError(null)

    let payload: BackupPayload
    try {
      payload = await importBackupFile(fileBytes, passphrase)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to decrypt backup.')
      setDecrypting(false)
      return
    }

    const restoreEntries: ServerRestoreEntry[] = payload.servers.map((s) => ({
      backup: s,
      status: { state: 'pending' as const },
      passwordInput: '',
      loginError: null,
    }))

    setEntries(restoreEntries)
    setStep('restoring')
    setDecrypting(false)

    // Update backup state tracking
    updateBackupState({
      lastBackupAt: payload.created_at,
      expiresAt: payload.expires_at,
      credentialMode: payload.credential_mode,
      serverCount: payload.servers.length,
      reminderDismissedAt: null,
    })

    // Restore servers in parallel
    await Promise.allSettled(
      restoreEntries.map((entry, index) => restoreServer(entry, index)),
    )
  }

  async function restoreServer(entry: ServerRestoreEntry, index: number) {
    const { backup } = entry
    const url = normalizeServerUrl(backup.url)
    if (!url) {
      updateEntry(index, { state: 'failed', message: 'Invalid server URL' })
      return
    }

    updateEntry(index, { state: 'restoring' })
    const client = createServerApiClient(url)

    // Step 1: Try refresh token
    if (backup.credentials.refresh_token) {
      try {
        const result = await client.refreshAccessToken(backup.credentials.refresh_token)
        addRestoredServer(url, backup, result.access_token, result.user.username)
        updateEntry(index, { state: 'connected', username: result.user.username })
        return
      } catch (err) {
        // TypeError = network failure (fetch spec); other errors = auth failure
        if (err instanceof TypeError) {
          updateEntry(index, { state: 'unreachable' })
          return
        }
        // Token expired/revoked — try password next
      }
    }

    // Step 2: Try password
    if (backup.credentials.password) {
      try {
        const result = await client.login(backup.username, backup.credentials.password)
        addRestoredServer(url, backup, result.access_token, result.user.username)
        updateEntry(index, { state: 'connected', username: result.user.username })
        return
      } catch (err) {
        if (err instanceof TypeError) {
          updateEntry(index, { state: 'unreachable' })
          return
        }
        // Wrong password — fall through to manual
      }
    }

    // Step 3: Needs manual login
    addServerEntry(url, backup)
    updateEntry(index, { state: 'needs_password', username: backup.username })
  }

  function addRestoredServer(
    url: string,
    backup: BackupServerEntry,
    accessToken: string,
    username: string,
  ) {
    const existing = servers.servers.find(
      (s) => normalizeServerUrl(s.url) === url,
    )
    if (existing) {
      servers.updateServer(existing.id, {
        label: backup.label,
        color: backup.color,
        enabled: true,
      })
      servers.attachAuthSession(existing.id, {
        accessToken,
        refreshToken: backup.credentials.refresh_token ?? '',
        user: { id: '', username, display_name: null, role: 'user', temp_password: false },
      }, null)
    } else {
      const created = servers.addServer(url, backup.label, backup.color)
      servers.attachAuthSession(created.id, {
        accessToken,
        refreshToken: backup.credentials.refresh_token ?? '',
        user: { id: '', username, display_name: null, role: 'user', temp_password: false },
      }, null)
    }
  }

  function addServerEntry(url: string, backup: BackupServerEntry) {
    const existing = servers.servers.find(
      (s) => normalizeServerUrl(s.url) === url,
    )
    if (!existing) {
      servers.addServer(url, backup.label, backup.color || DEFAULT_MULTI_SERVER_COLOR)
    }
  }

  function updateEntry(index: number, status: ServerRestoreStatus) {
    setEntries((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], status }
      return next
    })
  }

  async function handleManualLogin(index: number) {
    const entry = entries[index]
    const url = normalizeServerUrl(entry.backup.url)
    if (!url || !entry.passwordInput) return

    updateEntry(index, { state: 'restoring' })
    const client = createServerApiClient(url)

    try {
      const result = await client.login(entry.backup.username, entry.passwordInput)
      addRestoredServer(url, entry.backup, result.access_token, result.user.username)
      updateEntry(index, { state: 'connected', username: result.user.username })
    } catch (err) {
      if (err instanceof TypeError) {
        updateEntry(index, { state: 'unreachable' })
      } else {
        // Keep needs_password so the user can correct and retry
        updateEntry(index, { state: 'needs_password', username: entry.backup.username })
        setEntries((prev) => {
          const next = [...prev]
          next[index] = { ...next[index], loginError: err instanceof Error ? err.message : 'Login failed' }
          return next
        })
      }
    }
  }

  const connectedCount = entries.filter((e) => e.status.state === 'connected').length
  const stillWorking = entries.some(
    (e) => e.status.state === 'pending' || e.status.state === 'restoring',
  )

  if (step === 'restoring') {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <h1 className="auth-card__title auth-card__title--left">Restoring Servers</h1>

          <div className="auth-restore-list">
            {entries.map((entry, index) => (
              <div key={entry.backup.url} className="auth-restore-item">
                <div className="auth-restore-item__header">
                  <span className="auth-restore-item__icon">
                    {entry.status.state === 'connected' && <CheckCircle size={18} color="var(--green)" strokeWidth={1.75} />}
                    {entry.status.state === 'restoring' && <Loader size={18} className="auth-spin" strokeWidth={1.75} />}
                    {(entry.status.state === 'failed' || entry.status.state === 'unreachable') && <XCircle size={18} color="var(--danger)" strokeWidth={1.75} />}
                    {entry.status.state === 'needs_password' && <XCircle size={18} color="var(--color-warning)" strokeWidth={1.75} />}
                    {entry.status.state === 'pending' && <Loader size={18} color="var(--label3)" strokeWidth={1.75} />}
                  </span>
                  <span className="auth-restore-item__info">
                    <span className="auth-restore-item__label">
                      {entry.backup.label}
                    </span>
                    <span className="auth-restore-item__meta">
                      {entry.status.state === 'connected' && `Connected as ${entry.status.username}`}
                      {entry.status.state === 'restoring' && 'Connecting...'}
                      {entry.status.state === 'unreachable' && 'Server unreachable'}
                      {entry.status.state === 'failed' && entry.status.message}
                      {entry.status.state === 'needs_password' && 'Session expired'}
                      {entry.status.state === 'pending' && 'Waiting...'}
                    </span>
                  </span>
                </div>

                {entry.status.state === 'needs_password' && (
                  <div className="auth-restore-item__password">
                    <div className="auth-input-row">
                      <Lock size={16} color="var(--text-muted)" strokeWidth={1.75} />
                      <input
                        className="auth-input"
                        type="password"
                        placeholder="Enter password"
                        value={entry.passwordInput}
                        onChange={(e) => {
                          const val = e.target.value
                          setEntries((prev) => {
                            const next = [...prev]
                            next[index] = { ...next[index], passwordInput: val, loginError: null }
                            return next
                          })
                        }}
                      />
                    </div>
                    {entry.loginError && <p className="auth-error" style={{ margin: 0 }}>{entry.loginError}</p>}
                    <button
                      className="auth-link auth-link--accent"
                      type="button"
                      onClick={() => handleManualLogin(index)}
                    >
                      Sign In
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {!stillWorking && (
            <>
              <p className="auth-card__subtitle">
                {connectedCount} of {entries.length} server{entries.length === 1 ? '' : 's'} connected
              </p>
              <button
                className="auth-btn-primary"
                type="button"
                disabled={connectedCount === 0}
                onClick={() => onNavigate('chat')}
              >
                Continue to Chats
              </button>
            </>
          )}

          <button
            className="auth-link auth-link--muted"
            type="button"
            onClick={() => onNavigate('welcome')}
          >
            Back
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-card__logo">
          <Zap size={40} color="var(--accent)" strokeWidth={1.75} />
        </div>
        <h1 className="auth-card__title">Restore from Backup</h1>
        <p className="auth-card__subtitle">Select a .vostok backup file and enter your backup password.</p>

        <form className="auth-form" onSubmit={handleDecrypt}>
          <input
            ref={fileInputRef}
            type="file"
            accept=".vostok"
            onChange={handleFileChange}
            style={{ display: 'none' }}
          />
          <button
            className="auth-btn-secondary"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={16} strokeWidth={1.75} />
            <span>{fileName ?? 'Select .vostok file'}</span>
          </button>

          <div className={`auth-input-row${error ? ' auth-input-row--error' : ''}`}>
            <Lock size={18} color="var(--text-muted)" strokeWidth={1.75} />
            <input
              className="auth-input"
              type={showPassphrase ? 'text' : 'password'}
              placeholder="Backup password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              disabled={decrypting}
            />
            <button
              type="button"
              className="auth-eye-toggle"
              onClick={() => setShowPassphrase(!showPassphrase)}
              tabIndex={-1}
            >
              {showPassphrase
                ? <EyeOff size={18} strokeWidth={1.75} />
                : <Eye size={18} strokeWidth={1.75} />}
            </button>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button
            className="auth-btn-primary"
            type="submit"
            disabled={!fileBytes || !passphrase || decrypting}
          >
            {decrypting ? <span className="auth-spinner" /> : 'Restore'}
          </button>
        </form>

        <button
          className="auth-link auth-link--muted"
          type="button"
          onClick={() => onNavigate('welcome')}
        >
          Back
        </button>
      </div>
    </div>
  )
}
