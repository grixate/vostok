import { useRef, useState, useEffect, type FormEvent } from 'react'
import { Upload, Download, Plus } from 'lucide-react'
import type { useServers } from '../../hooks/useServers.ts'
import { useBackupState } from '../../hooks/useBackupState.ts'
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
import { SectionLabel, GroupCard, InfoRow, RadioRow } from './SettingsPrimitives.tsx'

type Props = {
  servers: ReturnType<typeof useServers>
}

function formatHost(url: string): string {
  try { return new URL(url).host } catch { return url }
}

const statusLabels: Record<string, string> = {
  connected: 'Connected',
  connecting: 'Connecting...',
  disconnected: 'Disconnected',
  offline: 'Offline',
  auth_required: 'Sign in required',
  error: 'Error',
}

export function ServerManagementSection({ servers }: Props) {
  const { state: backupState, updateState: updateBackupState } = useBackupState()

  const [expandedServerId, setExpandedServerId] = useState<string | null>(null)
  const [loginUsername, setLoginUsername] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [working, setWorking] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'error' | 'success' | 'info'; text: string } | null>(null)

  // Add server
  const [showAddServer, setShowAddServer] = useState(false)
  const [draftUrl, setDraftUrl] = useState('')
  const [draftLabel, setDraftLabel] = useState('')

  // Export
  const [showExport, setShowExport] = useState(false)
  const [exportMode, setExportMode] = useState<BackupCredentialMode>('quick_restore')
  const [exportPassphrase, setExportPassphrase] = useState('')
  const [exportPassphraseConfirm, setExportPassphraseConfirm] = useState('')
  const [exportPasswords, setExportPasswords] = useState<Record<string, string>>({})
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

  // Import
  const [showImport, setShowImport] = useState(false)
  const [importFileBytes, setImportFileBytes] = useState<Uint8Array | null>(null)
  const [importFileName, setImportFileName] = useState<string | null>(null)
  const [importPassphrase, setImportPassphrase] = useState('')
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<string | null>(null)
  const importFileRef = useRef<HTMLInputElement>(null)

  // Clear expanded if server removed
  useEffect(() => {
    if (expandedServerId && !servers.servers.some((s) => s.id === expandedServerId)) {
      setExpandedServerId(null)
    }
  }, [expandedServerId, servers.servers])

  const inputStyle = {
    width: '100%',
    height: 42,
    borderRadius: 10,
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-surface-2)',
    color: 'var(--label)',
    padding: '0 14px',
    font: 'inherit',
    fontSize: 14,
  } as const

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
      setExpandedServerId(existing.id)
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
        DEFAULT_MULTI_SERVER_COLOR,
      )
      if (serverInfo) {
        servers.updateServer(entry.id, { serverInfo, label: draftLabel.trim() || defaultServerLabel(serverInfo.name) })
      }
      servers.setActiveServerId(entry.id)
      setExpandedServerId(entry.id)
      setDraftUrl('')
      setDraftLabel('')
      setShowAddServer(false)
      setMessage({ tone: 'success', text: 'Server added.' })
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Failed to add server.' })
    } finally {
      setWorking(null)
    }
  }

  // ── Sign in ──────────────────────────────────────────────────────────────

  async function handleLoginServer(serverId: string, event: FormEvent) {
    event.preventDefault()
    const server = servers.servers.find((s) => s.id === serverId)
    if (!server || !loginUsername.trim() || !loginPassword) {
      setMessage({ tone: 'error', text: 'Enter a username and password.' })
      return
    }
    setWorking('login')
    try {
      const client = createServerApiClient(server.url)
      const [serverInfo, response] = await Promise.all([
        server.serverInfo ? Promise.resolve(server.serverInfo) : client.getServerInfo().catch(() => null),
        client.login(loginUsername.trim(), loginPassword),
      ])
      servers.attachAuthSession(server.id, {
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
      servers.setActiveServerId(server.id)
      setMessage({ tone: 'success', text: `Signed in to ${server.label}.` })
      setLoginPassword('')
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : 'Sign in failed.' })
    } finally {
      setWorking(null)
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async function handleExport() {
    if (exportPassphrase.length < 8) { setExportError('Backup password must be at least 8 characters.'); return }
    if (exportPassphrase !== exportPassphraseConfirm) { setExportError('Passwords do not match.'); return }
    setExporting(true)
    setExportError(null)
    try {
      if (exportMode === 'full_credentials') {
        for (const server of servers.servers) {
          const pw = exportPasswords[server.id]
          if (pw) {
            const client = createServerApiClient(server.url)
            try { await client.login(server.auth?.user.username ?? '', pw) } catch {
              setExportError(`Wrong password for ${server.label}.`)
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
      const payload: BackupPayload = { version: 1, created_at: now.toISOString(), expires_at: expiresAt.toISOString(), credential_mode: exportMode, servers: backupServers }
      const fileBytes = await exportBackupFile(payload, exportPassphrase)
      const blob = new Blob([fileBytes as BlobPart], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `vostok-backup-${now.toISOString().slice(0, 10)}.vostok`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      updateBackupState({ lastBackupAt: now.toISOString(), expiresAt: expiresAt.toISOString(), credentialMode: exportMode, serverCount: servers.servers.length, reminderDismissedAt: null })
      setShowExport(false)
      setExportPassphrase('')
      setExportPassphraseConfirm('')
      setExportPasswords({})
      setMessage({ tone: 'success', text: 'Backup exported.' })
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
      if (!validateBackupMagic(bytes)) { setImportError('Not a valid Vostok backup file.'); setImportFileBytes(null); return }
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
      if (entry.credentials.refresh_token) {
        try {
          const result = await client.refreshAccessToken(entry.credentials.refresh_token)
          const existing = servers.servers.find((s) => normalizeServerUrl(s.url) === url)
          if (existing) {
            servers.updateServer(existing.id, { label: entry.label, color: entry.color, enabled: true })
            servers.attachAuthSession(existing.id, { accessToken: result.access_token, refreshToken: entry.credentials.refresh_token, user: { id: result.user.id, username: result.user.username, display_name: result.user.display_name, role: result.user.role, temp_password: result.user.temp_password } }, null)
          } else {
            const created = servers.addServer(url, entry.label, entry.color || DEFAULT_MULTI_SERVER_COLOR)
            servers.attachAuthSession(created.id, { accessToken: result.access_token, refreshToken: entry.credentials.refresh_token, user: { id: result.user.id, username: result.user.username, display_name: result.user.display_name, role: result.user.role, temp_password: result.user.temp_password } }, null)
          }
          connected++
          continue
        } catch { /* token expired */ }
      }
      if (entry.credentials.password) {
        try {
          const result = await client.login(entry.username, entry.credentials.password)
          const existing = servers.servers.find((s) => normalizeServerUrl(s.url) === url)
          if (existing) {
            servers.updateServer(existing.id, { label: entry.label, color: entry.color, enabled: true })
            servers.attachAuthSession(existing.id, { accessToken: result.access_token, refreshToken: result.refresh_token, user: { id: result.user.id, username: result.user.username, display_name: result.user.display_name, role: result.user.role, temp_password: result.user.temp_password } }, null)
          } else {
            const created = servers.addServer(url, entry.label, entry.color || DEFAULT_MULTI_SERVER_COLOR)
            servers.attachAuthSession(created.id, { accessToken: result.access_token, refreshToken: result.refresh_token, user: { id: result.user.id, username: result.user.username, display_name: result.user.display_name, role: result.user.role, temp_password: result.user.temp_password } }, null)
          }
          connected++
          continue
        } catch { /* password failed */ }
      }
      const existing = servers.servers.find((s) => normalizeServerUrl(s.url) === url)
      if (!existing) servers.addServer(url, entry.label, entry.color || DEFAULT_MULTI_SERVER_COLOR)
    }
    updateBackupState({ lastBackupAt: payload.created_at, expiresAt: payload.expires_at, credentialMode: payload.credential_mode, serverCount: payload.servers.length, reminderDismissedAt: null })
    setImportResult(`Restored ${connected} of ${payload.servers.length} server${payload.servers.length === 1 ? '' : 's'}.`)
    setShowImport(false)
    setImportFileBytes(null)
    setImportFileName(null)
    setImportPassphrase('')
    setImporting(false)
  }

  // ── Backup helpers ───────────────────────────────────────────────────────

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

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <SectionLabel>Servers</SectionLabel>
      <GroupCard>
        {servers.servers.map((server) => {
          const isExpanded = expandedServerId === server.id
          const status = servers.statusByServerId[server.id] ?? 'disconnected'
          const statusLabel = statusLabels[status] ?? 'Unknown'
          const isActive = server.id === servers.activeServer?.id

          return (
            <div key={server.id}>
              <button
                type="button"
                className="settings-section__row"
                onClick={() => setExpandedServerId(isExpanded ? null : server.id)}
              >
                <span style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: server.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  fontSize: 15,
                  fontWeight: 600,
                  color: '#fff',
                }}>
                  {server.label.slice(0, 1).toUpperCase()}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{server.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {server.auth?.user.username ? `@${server.auth.user.username}` : formatHost(server.url)}
                    {isActive ? ' · Active' : ''}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: status === 'connected' ? 'var(--green)' : 'var(--text-muted)' }}>
                  {statusLabel}
                </span>
              </button>

              {isExpanded && (
                <div style={{ background: 'var(--bg-surface-1)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <div className="settings-section__row settings-section__row--info">
                    <span style={{ flex: 1 }}>Address</span>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{formatHost(server.url)}</span>
                  </div>
                  {server.serverInfo?.version && (
                    <div className="settings-section__row settings-section__row--info">
                      <span style={{ flex: 1 }}>Version</span>
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{server.serverInfo.version}</span>
                    </div>
                  )}
                  {servers.lastErrorByServerId[server.id] && (
                    <div style={{ padding: '10px 20px', fontSize: 12, color: 'var(--status-error)' }}>
                      {servers.lastErrorByServerId[server.id]}
                    </div>
                  )}

                  <div style={{ display: 'flex', flexDirection: 'column', padding: '8px 20px 12px', gap: 8 }}>
                    {!isActive && (
                      <button type="button" className="settings-section__row" style={{ justifyContent: 'center', fontWeight: 500, borderBottom: 'none', height: 40, borderRadius: 8, background: 'var(--bg-surface-2)' }} onClick={() => servers.setActiveServerId(server.id)}>
                        Set as Active
                      </button>
                    )}
                    <button
                      type="button"
                      className="settings-section__row"
                      style={{ justifyContent: 'center', fontWeight: 500, borderBottom: 'none', height: 40, borderRadius: 8, background: 'var(--bg-surface-2)' }}
                      onClick={() => servers.updateServer(server.id, { enabled: !server.enabled })}
                    >
                      {server.enabled ? 'Disable Sync' : 'Enable Sync'}
                    </button>
                    {server.auth && (
                      <button
                        type="button"
                        className="settings-section__row"
                        style={{ justifyContent: 'center', fontWeight: 500, borderBottom: 'none', height: 40, borderRadius: 8, background: 'var(--bg-surface-2)', color: 'var(--status-error)' }}
                        onClick={() => servers.logoutServer(server.id)}
                      >
                        Sign Out
                      </button>
                    )}
                    {servers.servers.length > 1 && (
                      <button
                        type="button"
                        className="settings-section__row"
                        style={{ justifyContent: 'center', fontWeight: 500, borderBottom: 'none', height: 40, borderRadius: 8, background: 'var(--bg-surface-2)', color: 'var(--status-error)' }}
                        onClick={() => servers.removeServer(server.id)}
                      >
                        Remove Server
                      </button>
                    )}
                  </div>

                  {!server.auth && (
                    <form onSubmit={(e) => handleLoginServer(server.id, e)} style={{ display: 'grid', gap: 10, padding: '8px 20px 16px' }}>
                      <input type="text" placeholder="Username" value={loginUsername} onChange={(e) => setLoginUsername(e.target.value)} style={inputStyle} />
                      <input type="password" placeholder="Password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} style={inputStyle} />
                      <button type="submit" className="settings-section__row" style={{ justifyContent: 'center', fontWeight: 500, borderBottom: 'none', height: 40, borderRadius: 8, background: 'var(--bg-surface-2)' }} disabled={working === 'login'}>
                        {working === 'login' ? 'Signing In...' : 'Sign In'}
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {servers.servers.length === 0 && (
          <div style={{ padding: '18px 20px', fontSize: 14, color: 'var(--text-secondary)' }}>
            No servers configured.
          </div>
        )}
      </GroupCard>

      {/* Add server — inline toggle */}
      {!showAddServer ? (
        <button
          type="button"
          className="settings-section__row"
          style={{ marginTop: 8, borderRadius: 10, background: 'var(--bg-surface-1)', border: 'none', justifyContent: 'center', gap: 6, height: 40, fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}
          onClick={() => setShowAddServer(true)}
        >
          <Plus size={16} strokeWidth={1.75} />
          Add Server
        </button>
      ) : (
        <>
          <SectionLabel>Add Server</SectionLabel>
          <GroupCard>
            <form onSubmit={handleAddServer} style={{ display: 'grid', gap: 10, padding: '16px 20px' }}>
              <input type="url" placeholder="https://chat.example.com" value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} style={inputStyle} />
              <input type="text" placeholder="Label (optional)" value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} style={inputStyle} />
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="settings-section__row" style={{ flex: 1, justifyContent: 'center', fontWeight: 500, borderBottom: 'none', height: 40, borderRadius: 8, background: 'var(--bg-surface-2)' }} disabled={working === 'add'}>
                  {working === 'add' ? 'Adding...' : 'Add'}
                </button>
                <button type="button" className="settings-section__row" style={{ flex: 1, justifyContent: 'center', fontWeight: 500, borderBottom: 'none', height: 40, borderRadius: 8, background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' }} onClick={() => setShowAddServer(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </GroupCard>
        </>
      )}

      {message && (
        <div style={{ marginTop: 8, padding: '10px 20px', fontSize: 13, borderRadius: 8, background: 'var(--bg-surface-1)', color: message.tone === 'error' ? 'var(--status-error)' : message.tone === 'success' ? 'var(--green)' : 'var(--text-secondary)' }}>
          {message.text}
        </div>
      )}

      {importResult && (
        <div style={{ marginTop: 8, padding: '10px 20px', fontSize: 13, borderRadius: 8, background: 'var(--bg-surface-1)', color: 'var(--green)' }}>
          {importResult}
        </div>
      )}

      {/* Backup */}
      <SectionLabel>Backup</SectionLabel>
      <GroupCard>
        <InfoRow label={formatBackupAge()} value={formatBackupExpiry() ?? ''} />
        <div style={{ display: 'flex', gap: 8, padding: '8px 20px 12px' }}>
          <button type="button" className="settings-section__row" style={{ flex: 1, justifyContent: 'center', fontWeight: 500, borderBottom: 'none', height: 40, borderRadius: 8, background: 'var(--bg-surface-2)', gap: 6 }} onClick={() => { setShowExport(true); setShowImport(false) }}>
            <Download size={14} strokeWidth={1.75} />
            Export
          </button>
          <button type="button" className="settings-section__row" style={{ flex: 1, justifyContent: 'center', fontWeight: 500, borderBottom: 'none', height: 40, borderRadius: 8, background: 'var(--bg-surface-2)', gap: 6 }} onClick={() => { setShowImport(true); setShowExport(false) }}>
            <Upload size={14} strokeWidth={1.75} />
            Import
          </button>
        </div>
      </GroupCard>

      {/* Export flow */}
      {showExport && (
        <>
          <SectionLabel>Export Backup</SectionLabel>
          <GroupCard>
            <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)' }}>
                {servers.servers.length} server{servers.servers.length === 1 ? '' : 's'} will be included.
              </p>
              <div>
                <RadioRow label="Addresses only" active={exportMode === 'addresses_only'} onSelect={() => setExportMode('addresses_only')} />
                <RadioRow label="Quick restore (recommended)" active={exportMode === 'quick_restore'} onSelect={() => setExportMode('quick_restore')} />
                <RadioRow label="Full credentials" active={exportMode === 'full_credentials'} onSelect={() => setExportMode('full_credentials')} />
              </div>
              {exportMode === 'full_credentials' && servers.servers.map((server) => (
                <div key={server.id}>
                  <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>{server.label}</label>
                  <input type="password" placeholder="Password" value={exportPasswords[server.id] ?? ''} onChange={(e) => setExportPasswords((prev) => ({ ...prev, [server.id]: e.target.value }))} style={inputStyle} />
                </div>
              ))}
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Backup password</label>
                <input type="password" value={exportPassphrase} onChange={(e) => setExportPassphrase(e.target.value)} style={inputStyle} />
                <PasswordStrengthBar password={exportPassphrase} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Confirm password</label>
                <input type="password" value={exportPassphraseConfirm} onChange={(e) => setExportPassphraseConfirm(e.target.value)} style={inputStyle} />
              </div>
              {exportError && <p style={{ margin: 0, fontSize: 13, color: 'var(--status-error)' }}>{exportError}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="settings-section__row" style={{ flex: 1, justifyContent: 'center', fontWeight: 500, borderBottom: 'none', height: 40, borderRadius: 8, background: 'var(--bg-surface-2)' }} onClick={handleExport} disabled={exporting || !exportPassphrase}>
                  {exporting ? 'Exporting...' : 'Export'}
                </button>
                <button type="button" className="settings-section__row" style={{ flex: 1, justifyContent: 'center', fontWeight: 500, borderBottom: 'none', height: 40, borderRadius: 8, background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' }} onClick={() => setShowExport(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </GroupCard>
        </>
      )}

      {/* Import flow */}
      {showImport && (
        <>
          <SectionLabel>Import Backup</SectionLabel>
          <GroupCard>
            <div style={{ padding: '16px 20px', display: 'grid', gap: 14 }}>
              <input ref={importFileRef} type="file" accept=".vostok" onChange={handleImportFileChange} style={{ display: 'none' }} />
              <button type="button" className="settings-section__row" style={{ justifyContent: 'center', fontWeight: 500, borderBottom: 'none', height: 40, borderRadius: 8, background: 'var(--bg-surface-2)' }} onClick={() => importFileRef.current?.click()}>
                <Upload size={14} strokeWidth={1.75} style={{ marginRight: 4 }} />
                {importFileName ?? 'Select .vostok file'}
              </button>
              <div>
                <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Backup password</label>
                <input type="password" value={importPassphrase} onChange={(e) => setImportPassphrase(e.target.value)} style={inputStyle} />
              </div>
              {importError && <p style={{ margin: 0, fontSize: 13, color: 'var(--status-error)' }}>{importError}</p>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="settings-section__row" style={{ flex: 1, justifyContent: 'center', fontWeight: 500, borderBottom: 'none', height: 40, borderRadius: 8, background: 'var(--bg-surface-2)' }} onClick={handleImport} disabled={importing || !importFileBytes || !importPassphrase}>
                  {importing ? 'Restoring...' : 'Restore'}
                </button>
                <button type="button" className="settings-section__row" style={{ flex: 1, justifyContent: 'center', fontWeight: 500, borderBottom: 'none', height: 40, borderRadius: 8, background: 'var(--bg-surface-2)', color: 'var(--text-secondary)' }} onClick={() => setShowImport(false)}>
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
