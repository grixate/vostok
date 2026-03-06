import { useState } from 'react'
import type { NavigationStack, AppScreen } from '../../shared/hooks/useNavigation'
import type { DeviceInfo } from '../../lib/api'
import type { StoredDevice } from '../../shared/context/AuthContext'

interface Props {
  nav: NavigationStack<AppScreen>
  profileUsername: string | null
  storedDevice: StoredDevice | null
  devices: DeviceInfo[]
  outboxPendingCount: number
  isAdmin: boolean
  loading: boolean
  onRevokeDevice: (deviceId: string) => void
  onRotatePrekeys: () => void
  onRefreshSession: () => void
  onForgetDevice: () => void
  onShowInviteSheet: () => void
}

export function SettingsView({
  nav,
  profileUsername,
  storedDevice,
  devices,
  outboxPendingCount,
  isAdmin,
  loading,
  onRevokeDevice,
  onRotatePrekeys,
  onRefreshSession,
  onForgetDevice,
  onShowInviteSheet
}: Props) {
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const activeDevices = devices.filter((d) => !d.revoked_at)
  const sessionExpiry = storedDevice?.sessionExpiresAt
    ? new Date(storedDevice.sessionExpiresAt).toLocaleDateString()
    : null

  return (
    <div className="sidebar-view settings-view">
      <div className="sidebar-view__header">
        <button
          className="sidebar-view__back"
          type="button"
          onClick={() => nav.pop()}
          aria-label="Back"
        >
          ←
        </button>
        <h2 className="sidebar-view__title">Settings</h2>
      </div>

      <div className="settings-view__body">
        {/* ── Profile ──────────────────────────────────────────── */}
        <section className="settings-section">
          <div className="settings-section__avatar" aria-hidden="true">
            {profileUsername?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="settings-section__profile-info">
            <strong className="settings-section__username">
              @{profileUsername ?? storedDevice?.username ?? '…'}
            </strong>
            <span className="settings-section__device-name">
              {storedDevice?.deviceName ?? 'This device'}
            </span>
          </div>
        </section>

        {/* ── Invite (admin only) ───────────────────────────────── */}
        {isAdmin ? (
          <section className="settings-section">
            <h3 className="settings-section__title">Invite</h3>
            <button
              className="settings-row settings-row--action"
              type="button"
              onClick={onShowInviteSheet}
            >
              <span className="settings-row__label">Invite someone to Vostok</span>
              <span className="settings-row__chevron" aria-hidden="true">›</span>
            </button>
          </section>
        ) : null}

        {/* ── Devices ──────────────────────────────────────────── */}
        <section className="settings-section">
          <h3 className="settings-section__title">
            Devices
            <span className="settings-section__badge">{activeDevices.length}</span>
          </h3>
          <div className="settings-list">
            {devices.length === 0 ? (
              <span className="settings-list__empty">Loading devices…</span>
            ) : (
              devices.map((device) => (
                <div
                  key={device.id}
                  className={[
                    'settings-row',
                    device.revoked_at ? 'settings-row--revoked' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="settings-row__main">
                    <strong className="settings-row__label">
                      {device.device_name}
                      {device.is_current ? (
                        <span className="settings-row__current-badge"> This device</span>
                      ) : null}
                    </strong>
                    <span className="settings-row__detail">
                      {device.revoked_at
                        ? 'Revoked'
                        : `${device.one_time_prekey_count} prekey${device.one_time_prekey_count === 1 ? '' : 's'}`}
                    </span>
                  </div>
                  {!device.is_current && !device.revoked_at ? (
                    <button
                      className="danger-action settings-row__action"
                      disabled={loading}
                      onClick={() => onRevokeDevice(device.id)}
                      type="button"
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </section>

        {/* ── Appearance placeholder ────────────────────────────── */}
        <section className="settings-section">
          <h3 className="settings-section__title">Appearance</h3>
          <div className="settings-row">
            <span className="settings-row__label">Theme</span>
            <span className="settings-row__detail settings-row__detail--muted">System default</span>
          </div>
        </section>

        {/* ── Advanced (collapsible) ────────────────────────────── */}
        <section className="settings-section settings-section--advanced">
          <button
            className="settings-section__collapse-toggle"
            type="button"
            onClick={() => setAdvancedOpen((v) => !v)}
            aria-expanded={advancedOpen}
          >
            <span>Advanced</span>
            <span className="settings-section__collapse-icon" aria-hidden="true">
              {advancedOpen ? '▾' : '▸'}
            </span>
          </button>

          {advancedOpen ? (
            <div className="settings-section__advanced-body">
              <div className="settings-row">
                <div className="settings-row__main">
                  <span className="settings-row__label">Session</span>
                  <span className="settings-row__detail">
                    {sessionExpiry ? `Expires ${sessionExpiry}` : 'No expiry info'}
                  </span>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row__main">
                  <span className="settings-row__label">Offline outbox</span>
                  <span className="settings-row__detail">
                    {outboxPendingCount} pending message{outboxPendingCount === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row__main">
                  <span className="settings-row__label">Prekeys</span>
                  <span className="settings-row__detail">
                    {storedDevice?.oneTimePrekeys?.length ?? 0} local one-time prekeys cached
                  </span>
                </div>
              </div>
              <div className="settings-section__advanced-actions">
                <button
                  className="secondary-action"
                  disabled={loading}
                  onClick={onRefreshSession}
                  type="button"
                >
                  Refresh Session
                </button>
                <button
                  className="secondary-action"
                  disabled={loading}
                  onClick={onRotatePrekeys}
                  type="button"
                >
                  Rotate Prekeys
                </button>
              </div>
            </div>
          ) : null}
        </section>

        {/* ── Danger zone ──────────────────────────────────────── */}
        <section className="settings-section settings-section--danger">
          <button
            className="danger-action settings-danger-action"
            onClick={onForgetDevice}
            type="button"
          >
            Sign out &amp; forget this device
          </button>
        </section>
      </div>
    </div>
  )
}
