import { useRef, useState, useEffect, type FormEvent } from 'react'
import { Upload, Download } from 'lucide-react'
import type { useServers } from '../../hooks/useServers.ts'
import { useBackupState } from '../../hooks/useBackupState.ts'
import { useConnectionStatus } from '../../hooks/useConnectionStatus.ts'
import { DEFAULT_MULTI_SERVER_COLOR } from '../../constants.ts'
import { createServerApiClient } from '../../lib/server-api.ts'
import { defaultServerLabel, normalizeServerUrl } from '../../lib/multi-server.ts'
import {
  exportBackupFile,
  importBackupFile,
  validateBackupMagic,
  type BackupCredentialMode,
  type BackupPayload,
  type BackupServerEntry,
} from '../../lib/backup-crypto.ts'
import { PasswordStrengthBar } from '../auth/PasswordStrengthBar.tsx'
import { SectionLabel, GroupCard, InfoRow, RadioRow, rowStyle, lastRowMod } from './SettingsPrimitives.tsx'

type Props = {
  servers: ReturnType<typeof useServers>
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatHost(url: string): string {
  try { return new URL(url).host } catch { return url }
}

const statusThemes: Record<string, { color: string; label: string }> = {
  connected: { color: 'var(--green, #34C759)', label: 'Connected' },
  connecting: { color: 'var(--color-warning)', label: 'Connecting...' },
  disconnected: { color: 'var(--text-secondary)', label: 'Disconnected' },
  offline: { color: 'var(--status-warning, #f0a030)', label: 'Offline' },
  auth_required: { color: 'var(--status-warning, #f0a030)', label: 'Sign in required' },
  error: { color: 'var(--status-error)', label: 'Error' },
}

function StatusDot({ serverId, servers }: { serverId: string; servers: Props['servers'] }) {
  const status = servers.statusByServerId[serverId] ?? 'disconnected'
  const theme = statusThemes[status] ?? statusThemes.disconnected
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: theme.color }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: theme.color }} />
      {theme.label}
    </span>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function ServerManagementSection({ servers }: Props) {
  const connectionStatus = useConnectionStatus()
  const { state: backupState, updateState: updateBackupState } = useBackupState()

  // ── Server list state ────────────────────────────────────────────────────
  const [selectedServerId, setSelectedServerId] = useState<string | null>(
    servers.activeServer?.id ?? servers.servers[0]?.id ?? null,
  )
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [working, setWorking] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null)

  // ── Add server state ─────────────────────────────────────────────────────
  const [draftUrl, setDraftUrl] = useState('')
  const [draftLabel, setDraftLabel] = useState('')
  const [draftColor, setDraftColor] = useState(DEFAULT_MULTI_SERVER_COLOR)

  // ── Export state ──────────────────────────────────────────────────────────
  const [showExport, setShowExport] = useState(false)
  const [exportMode, setExportMode] = useState<BackupCredentialMode>('quick_restore')
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [exportPassphraseConfirm, setExportPassphraseConfirm] = useState('')
  const [exportPasswords, setExportPasswords] = useState<Record<string, string>>({})
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // ── Import state ──────────────────────────────────────────────────────────
  const [showImport, setShowImport] = useState(false)
  const [importFileBytes, setImportFileBytes] = useState<Uint8Array | null>(null)
  const [importFileName, setImportFileName] = useState<string | null>(null)
  const [importPassphrase, setImportPassphrase] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<string | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  // ── Keep selected server in sync ─────────────────────────────────────────
  useEffect(() => {
    if (selectedServerId && servers.servers.some((s) => s.id === selectedServerId)) return
    setSelectedServerId(servers.activeServer?.id ?? servers.servers[0]?.id ?? null)
  }, [selectedServerId, servers.activeServer?.id, servers.servers])

  const selectedServer =
    servers.servers.find((s) => s.id === selectedServerId) ??
    servers.activeServer ??
    servers.servers[0] ??
    null

  const selectedServerStatus = selectedServer
    ? servers.statusByServerId[selectedServer.id] ?? 'disconnected'
    : 'disconnected'
  const activeConnectionStatus =
    servers.activeServer?.id === selectedServer?.id ? connectionStatus : selectedServerStatus
  const statusTheme = statusThemes[activeConnectionStatus] ?? statusThemes.disconnected

  // ── Add server ───────────────────────────────────────────────────────────

  async function handleAddServer(event: FormEvent) {
    event.preventDefault()

    const normalizedUrl = normalizeServerUrl(draftUrl)
    if (!normalizedUrl) {
      setMessage({ tone: 'error', text: 'Enter a valid server URL.' })
      return
    }

    const existing = servers.servers.find((s) => normalizeServerUrl(s.url) === normalizedUrl)
    if (existing) {
      servers.setActiveServerId(existing.id)
      setSelectedServerId(existing.id)
      setMessage({ tone: 'info', text: 'That server is already configured.' })
      return
    }

    setWorking('add')
    try {
      const client = createServerApiClient(normalizedUrl)
      let serverInfo = null
      try { serverInfo = await client.getServerInfo() } catch { /* discovery may be unavailable */ }

      const entry = servers.addServer(
        normalizedUrl,
        draftLabel.trim() || defaultServerLabel(serverInfo?.name),
        draftColor,
      )
      if (serverInfo) {
        servers.updateServer(entry.id, { serverInfo, label: draftLabel.trim() || defaultServerLabel(serverInfo.name) })
      }
      servers.setActiveServerId(entry.id)
      setSelectedServerId(entry.id)
      setDraftUrl('')
      setDraftLabel('')
      setDraftColor(DEFAULT_MULTI_SERVER_COLOR)
      setMessage({ tone: 'success', text: 'Server added. Sign in to start syncing.' })
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Failed to add server.' })
    } finally {
      setWorking(null)
    }
  }

  // ── Sign in ──────────────────────────────────────────────────────────────

  async function handleLoginSelectedServer(event: FormEvent) {
    event.preventDefault()
    if (!selectedServer || !loginUsername.trim() || !loginPassword) {
      setMessage({ tone: 'error', text: 'Enter a username and password.' })
      return
    }
    setWorking('login')
    try {
      const client = createServerApiClient(selectedServer.url)
      const [serverInfo, response] = await Promise.all([
        selectedServer.serverInfo ? Promise.resolve(selectedServer.serverInfo) : client.getServerInfo().catch(() => null),
        client.login(loginUsername.trim(), loginPassword),
      ])
      servers.attachAuthSession(selectedServer.id, {
        accessToken: response.access_token,
        refreshToken: response.refresh_token,
        user: {
          id: response.user.id,
          username: response.user.username,
          display_name: response.user.display_name,
          role: response.user.role,
          temp_password: response.user.temp_password,
        },
      }, serverInfo)
      servers.setActiveServerId(selectedServer.id)
      setMessage({ tone: 'success', text: `Signed in to ${selectedServer.label}.` })
      setLoginPassword('')
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Sign in failed.' })
    } finally {
      setWorking(null)
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async function handleExport() {
    if (exportPassphrase.length < 8) {
      setExportError('Backup password must be at least 8 characters.')
      return
    }
    if (exportPassphrase !== exportPassphraseConfirm) {
      setExportError('Passwords do not match.')
      return
    }

    setExporting(true)
    setExportError(null)

    try {
      // If full_credentials, verify passwords first
      if (exportMode === 'full_credentials') {
        for (const server of servers.servers) {
          const pw = exportPasswords[server.id]
          if (pw) {
            const client = createServerApiClient(server.url)
            try {
              await client.login(server.auth?.user.username ?? '', pw)
            } catch {
              setExportError(`Wrong password for ${server.label}. Please correct it.`)
              setExporting(false)
              return
            }
          }
        }
      }

      const now = new Date()
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)

      const backupServers: BackupServerEntry[] = servers.servers.map((server) => ({
        url: server.url,
        username: server.auth?.user.username ?? '',
        label: server.label,
        color: server.color,
        sort_order: server.sortOrder,
        credentials: {
          refresh_token: exportMode !== 'addresses_only' ? (server.auth?.refreshToken ?? null) : null,
          refresh_token_expires_at: exportMode !== 'addresses_only' ? expiresAt.toISOString() : null,
          password: exportMode === 'full_credentials' ? (exportPasswords[server.id] ?? null) : null,
        },
      }))

      const payload: BackupPayload = {
        version: 1,
        created_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        credential_mode: exportMode,
        servers: backupServers,
      }

      const fileBytes = await exportBackupFile(payload, exportPassphrase)

      // Trigger download
      const blob = new Blob([fileBytes as BlobPart], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vostok-backup-${now.toISOString().slice(0, 10)}.vostok`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      // Update backup state
      updateBackupState({
        lastBackupAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        credentialMode: exportMode,
        serverCount: servers.servers.length,
        reminderDismissedAt: null,
      })

      setShowExport(false)
      setExportPassphrase('')
      setExportPassphraseConfirm('')
      setExportPasswords({})
      setMessage({ tone: 'success', text: 'Backup exported successfully.' })
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed.')
    } finally {
      setExporting(false)
    }
  }

  // ── Import ───────────────────────────────────────────────────────────────

  function handleImportFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setImportError(null)
    setImportFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer)
      if (!validateBackupMagic(bytes)) {
        setImportError('Not a valid Vostok backup file.')
        setImportFileBytes(null)
        return
      }
      setImportFileBytes(bytes)
    }
    reader.readAsArrayBuffer(file)
  }

  async function handleImport() {
    if (!importFileBytes) return

    setImporting(true)
    setImportError(null)

    let payload: BackupPayload
    try {
      payload = await importBackupFile(importFileBytes, importPassphrase)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Decryption failed.')
      setImporting(false)
      return
    }

    let connected = 0
    for (const entry of payload.servers) {
      const url = normalizeServerUrl(entry.url)
      if (!url) continue

      const client = createServerApiClient(url)

      // Try refresh token
      if (entry.credentials.refresh_token) {
        try {
          const result = await client.refreshAccessToken(entry.credentials.refresh_token)
          const existing = servers.servers.find((s) => normalizeServerUrl(s.url) === url)
          if (existing) {
            servers.updateServer(existing.id, { label: entry.label, color: entry.color, enabled: true })
            servers.attachAuthSession(existing.id, {
              accessToken: result.access_token,
              refreshToken: entry.credentials.refresh_token,
              user: { id: result.user.id, username: result.user.username, display_name: result.user.display_name, role: result.user.role, temp_password: result.user.temp_password },
            }, null)
          } else {
            const created = servers.addServer(url, entry.label, entry.color || DEFAULT_MULTI_SERVER_COLOR)
            servers.attachAuthSession(created.id, {
              accessToken: result.access_token,
              refreshToken: entry.credentials.refresh_token,
              user: { id: result.user.id, username: result.user.username, display_name: result.user.display_name, role: result.user.role, temp_password: result.user.temp_password },
            }, null)
          }
          connected++
          continue
        } catch { /* token expired, try password */ }
      }

      // Try password
      if (entry.credentials.password) {
        try {
          const result = await client.login(entry.username, entry.credentials.password)
          const existing = servers.servers.find((s) => normalizeServerUrl(s.url) === url)
          if (existing) {
            servers.updateServer(existing.id, { label: entry.label, color: entry.color, enabled: true })
            servers.attachAuthSession(existing.id, {
              accessToken: result.access_token,
              refreshToken: result.refresh_token,
              user: { id: result.user.id, username: result.user.username, display_name: result.user.display_name, role: result.user.role, temp_password: result.user.temp_password },
            }, null)
          } else {
            const created = servers.addServer(url, entry.label, entry.color || DEFAULT_MULTI_SERVER_COLOR)
            servers.attachAuthSession(created.id, {
              accessToken: result.access_token,
              refreshToken: result.refresh_token,
              user: { id: result.user.id, username: result.user.username, display_name: result.user.display_name, role: result.user.role, temp_password: result.user.temp_password },
            }, null)
          }
          connected++
          continue
        } catch { /* password failed */ }
      }

      // Fallback: add server entry without auth
      const existing = servers.servers.find((s) => normalizeServerUrl(s.url) === url)
      if (!existing) {
        servers.addServer(url, entry.label, entry.color || DEFAULT_MULTI_SERVER_COLOR)
      }
    }

    updateBackupState({
      lastBackupAt: payload.created_at,
      expiresAt: payload.expires_at,
      credentialMode: payload.credential_mode,
      serverCount: payload.servers.length,
      reminderDismissedAt: null,
    })

    setImportResult(`Restored ${connected} of ${payload.servers.length} server${payload.servers.length === 1 ? '' : 's'}.`)
    setShowImport(false)
    setImportFileBytes(null)
    setImportFileName(null)
    setImportPassphrase('')
    setImporting(false)
  }

  // ── Backup info ──────────────────────────────────────────────────────────

  function formatBackupAge(): string {
    if (!backupState.lastBackupAt) return 'No backup created'
    const days = Math.floor((Date.now() - new Date(backupState.lastBackupAt).getTime()) / (1000 * 60 * 60 * 24))
    if (days === 0) return 'Last backup: today'
    return `Last backup: ${days} day${days === 1 ? '' : 's'} ago`
  }

  function formatBackupExpiry(): string | null {
    if (!backupState.expiresAt) return null
    const days = Math.ceil((new Date(backupState.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (days < 0) return `Backup expired ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`
    if (days === 0) return 'Backup expires today'
    return `Backup expires in ${days} day${days === 1 ? '' : 's'}`
  }

  const inputStyle = {
    width: '100%',
    height: 42,
    borderRadius: 10,
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-surface-2)',
    color: 'var(--label)',
    padding: '0 14px',
  } as const

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      {/* Server list */}
      <SectionLabel>Connected Servers</SectionLabel>
      <GroupCard>
        {servers.servers.length > 0 ? (
          servers.servers.map((server, index) => {
            const isSelected = server.id === selectedServer?.id
            return (
              <button
                key={server.id}
                type="button"
                onClick={() => setSelectedServerId(server.id)}
                style={{
                  ...rowStyle,
                  ...(index === servers.servers.length - 1 ? lastRowMod : {}),
                  height: 'auto',
                  minHeight: 72,
                  padding: '14px 20px',
                  justifyContent: 'space-between',
                  background: isSelected ? 'var(--bg-surface-2)' : 'none',
                  border: 'none',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 999, background: server.color, flexShrink: 0 }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span>{server.label}</span>
                      {server.id === servers.activeServer?.id && (
                        <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 700 }}>ACTIVE</span>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {formatHost(server.url)}
                    </div>
                    <div style={{ marginTop: 6 }}><StatusDot serverId={server.id} servers={servers} /></div>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                  {server.auth?.user.username ? `@${server.auth.user.username}` : 'Signed out'}
                </div>
              </button>
            )
          })
        ) : (
          <div style={{ padding: '18px 20px', fontSize: 14, color: 'var(--text-secondary)' }}>
            No servers are configured yet.
          </div>
        )}
      </GroupCard>

      {/* Selected server detail */}
      {selectedServer && (
        <>
          <SectionLabel>Selected Server</SectionLabel>
          <GroupCard>
            <InfoRow label="Address" value={selectedServer.url} />
            <InfoRow label="Status" value={statusTheme.label} />
            <InfoRow label="Account" value={selectedServer.auth?.user.username ? `@${selectedServer.auth.user.username}` : 'Not signed in'} />
            <InfoRow label="Auth Mode" value={selectedServer.serverInfo?.auth_mode ?? 'Unknown'} />
            <InfoRow label="Version" value={selectedServer.serverInfo?.version ?? 'Unknown'} />
            {servers.lastErrorByServerId[selectedServer.id] && (
              <div style={{ padding: '12px 20px', fontSize: 12, color: 'var(--status-error)', borderBottom: '1px solid var(--border-subtle)' }}>
                {servers.lastErrorByServerId[selectedServer.id]}
              </div>
            )}
            <div style={{ display: 'flex', gap: 10, padding: '14px 20px', flexWrap: 'wrap' }}>
              {selectedServer.id !== servers.activeServer?.id && (
                <button type="button" className="mini-action" onClick={() => servers.setActiveServerId(selectedServer.id)}>
                  Use This Server
                </button>
              )}
              <button type="button" className="mini-action" onClick={() => servers.updateServer(selectedServer.id, { enabled: !selectedServer.enabled })}>
                {selectedServer.enabled ? 'Disable Sync' : 'Enable Sync'}
              </button>
              {selectedServer.auth && (
                <button type="button" className="mini-action" onClick={() => servers.logoutServer(selectedServer.id)}>
                  Sign Out
                </button>
              )}
              {servers.servers.length > 1 && (
                <button type="button" className="mini-action" onClick={() => servers.removeServer(selectedServer.id)}>
                  Remove
                </button>
              )}
            </div>
            {selectedServer.auth?.user.role === 'admin' && (
              <div style={{ padding: '0 20px 16px', fontSize: 12, color: 'var(--text-secondary)' }}>
                This account can access server administration features.
              </div>
            )}
          </GroupCard>

          {/* Sign in form for unauthenticated server */}
          {!selectedServer.auth && (
            <>
              <SectionLabel>Sign In</SectionLabel>
              <GroupCard>
                <form onSubmit={handleLoginSelectedServer} style={{ display: 'grid', gap: 12, padding: 20 }}>
                  <input type="text" placeholder="Username" value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} style={inputStyle} />
                  <input type="password" placeholder="Password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} style={inputStyle} />
                  <button type="submit" className="primary-action" disabled={working === 'login'}>
                    {working === 'login' ? 'Signing In...' : 'Sign In'}
                  </button>
                </form>
              </GroupCard>
            </>
          )}
        </>
      )}

      {/* Add server */}
      <SectionLabel>Add Server</SectionLabel>
      <GroupCard>
        <form onSubmit={handleAddServer} style={{ display: 'grid', gap: 12, padding: 20 }}>
          <input type="url" placeholder="https://chat.example.com" value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} style={inputStyle} />
          <input type="text" placeholder="Server label (optional)" value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} style={inputStyle} />
          <label style={{ display: 'grid', gap: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
            Accent Color
            <input type="color" value={draftColor} onChange={(e) => setDraftColor(e.target.value)} style={{ width: 56, height: 36, border: 'none', background: 'none', padding: 0 }} />
          </label>
          <button type="submit" className="primary-action" disabled={working === 'add'}>
            {working === 'add' ? 'Adding...' : 'Add Server'}
          </button>
        </form>
      </GroupCard>

      {message && (
        <div style={{ marginTop: 12, fontSize: 13, color: message.tone === 'error' ? 'var(--status-error)' : message.tone === 'success' ? 'var(--green, #34C759)' : 'var(--text-secondary)' }}>
          {message.text}
        </div>
      )}

      {importResult && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--green, #34C759)' }}>
          {importResult}
        </div>
      )}

      {/* ── Backup section ──────────────────────────────────────────────── */}
      <SectionLabel>Backup</SectionLabel>
      <GroupCard>
        <div style={{ ...rowStyle, height: 'auto', padding: '14px 20px', flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <span style={{ fontSize: 14 }}>{formatBackupAge()}</span>
          {formatBackupExpiry() && (
            <span style={{ fontSize: 12, color: backupState.expiresAt && new Date(backupState.expiresAt).getTime() < Date.now() ? 'var(--status-error)' : 'var(--color-warning)' }}>
              {formatBackupExpiry()}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, padding: '14px 20px' }}>
          <button type="button" className="mini-action" onClick={() => { setShowExport(true); setShowImport(false) }}>
            <Download size={14} strokeWidth={1.75} style={{ marginRight: 4 }} />
            Export Backup
          </button>
          <button type="button" className="mini-action" onClick={() => { setShowImport(true); setShowExport(false) }}>
            <Upload size={14} strokeWidth={1.75} style={{ marginRight: 4 }} />
            Import Backup
          </button>
        </div>
      </GroupCard>

      {/* ── Export flow ─────────────────────────────────────────────────── */}
      {showExport && (
        <>
          <SectionLabel>Export Server Backup</SectionLabel>
          <GroupCard>
            <div style={{ padding: 20, display: 'grid', gap: 16 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                This backup includes {servers.servers.length} server{servers.servers.length === 1 ? '' : 's'}.
              </p>

              <div>
                <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 600 }}>What to include:</p>
                <RadioRow label="Addresses only" active={exportMode === 'addresses_only'} onSelect={() => setExportMode('addresses_only')} />
                <RadioRow label="Quick restore (recommended)" active={exportMode === 'quick_restore'} onSelect={() => setExportMode('quick_restore')} />
                <RadioRow label="Full credentials" active={exportMode === 'full_credentials'} onSelect={() => setExportMode('full_credentials')} />
              </div>

              {exportMode === 'addresses_only' && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                  Server URLs and usernames. You'll enter passwords on restore.
                </p>
              )}
              {exportMode === 'quick_restore' && (
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
                  Includes login sessions. One-click restore for 30 days.
                </p>
              )}
              {exportMode === 'full_credentials' && (
                <>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--color-warning)' }}>
                    Your passwords will be stored in this backup file, encrypted with your backup password. Keep this file secure.
                  </p>
                  {servers.servers.map((server) => (
                    <div key={server.id}>
                      <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>
                        {server.label} ({formatHost(server.url)})
                      </label>
                      <input
                        type="password"
                        placeholder="Password"
                        value={exportPasswords[server.id] ?? ''}
                        onChange={(e) => setExportPasswords((prev) => ({ ...prev, [server.id]: e.target.value }))}
                        style={inputStyle}
                      />
                    </div>
                  ))}
                </>
              )}

              <div>
                <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Backup password</label>
                <input type="password" value={exportPassphrase} onChange={(e) => setExportPassphrase(e.target.value)} style={inputStyle} />
                <PasswordStrengthBar password={exportPassphrase} />
              </div>

              <div>
                <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Confirm password</label>
                <input type="password" value={exportPassphraseConfirm} onChange={(e) => setExportPassphraseConfirm(e.target.value)} style={inputStyle} />
              </div>

              {exportError && <p style={{ margin: 0, fontSize: 13, color: 'var(--status-error)' }}>{exportError}</p>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="primary-action" onClick={handleExport} disabled={exporting || !exportPassphrase}>
                  {exporting ? 'Exporting...' : 'Export Backup'}
                </button>
                <button type="button" className="mini-action" onClick={() => setShowExport(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </GroupCard>
        </>
      )}

      {/* ── Import flow ─────────────────────────────────────────────────── */}
      {showImport && (
        <>
          <SectionLabel>Import Backup</SectionLabel>
          <GroupCard>
            <div style={{ padding: 20, display: 'grid', gap: 16 }}>
              <input ref={importFileRef} type="file" accept=".vostok" onChange={handleImportFileChange} style={{ display: 'none' }} />
              <button type="button" className="mini-action" onClick={() => importFileRef.current?.click()}>
                <Upload size={14} strokeWidth={1.75} style={{ marginRight: 4 }} />
                {importFileName ?? 'Select .vostok file'}
              </button>

              <div>
                <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Backup password</label>
                <input type="password" value={importPassphrase} onChange={(e) => setImportPassphrase(e.target.value)} style={inputStyle} />
              </div>

              {importError && <p style={{ margin: 0, fontSize: 13, color: 'var(--status-error)' }}>{importError}</p>}

              <div style={{ display: 'flex', gap: 10 }}>
                <button type="button" className="primary-action" onClick={handleImport} disabled={importing || !importFileBytes || !importPassphrase}>
                  {importing ? 'Restoring...' : 'Restore'}
                </button>
                <button type="button" className="mini-action" onClick={() => setShowImport(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </GroupCard>
        </>
      )}
    </>
  )
}
