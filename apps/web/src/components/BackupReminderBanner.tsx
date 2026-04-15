import { useBackupState } from '../hooks/useBackupState.ts'
import { useUIContext } from '../contexts/UIContext.tsx'
import { t } from '../lib/i18n.ts'

export function BackupReminderBanner() {
  const { reminderText, dismissReminder } = useBackupState()
  const { setSettingsOverlayOpen, setInitialSettingsSection } = useUIContext()

  if (!reminderText) return null

  return (
    <div className="backup-reminder-banner">
      <span className="backup-reminder-banner__text">{reminderText}</span>
      <div className="backup-reminder-banner__actions">
        <button
          type="button"
          className="backup-reminder-banner__btn"
          onClick={dismissReminder}
        >
          {t('dismiss')}
        </button>
        <button
          type="button"
          className="backup-reminder-banner__btn backup-reminder-banner__btn--primary"
          onClick={() => {
            setInitialSettingsSection('servers')
            setSettingsOverlayOpen(true)
          }}
        >
          {t('export_now')}
        </button>
      </div>
    </div>
  )
}
