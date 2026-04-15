import { useUIContext } from '../../contexts/UIContext.tsx'
import { t } from '../../lib/i18n.ts'

type ShortcutEntry = { keys: string; labelKey: string }

const SHORTCUT_GROUPS: { titleKey: string; items: ShortcutEntry[] }[] = [
  {
    titleKey: 'navigation',
    items: [
      { keys: 'Alt + \u2191', labelKey: 'shortcut_prev_chat' },
      { keys: 'Alt + \u2193', labelKey: 'shortcut_next_chat' },
      { keys: '/', labelKey: 'shortcut_focus_input' },
      { keys: '\u2318/Ctrl + \\', labelKey: 'shortcut_toggle_detail' },
    ],
  },
  {
    titleKey: 'search',
    items: [
      { keys: '\u2318/Ctrl + F', labelKey: 'shortcut_search_chat' },
      { keys: '\u2318/Ctrl + Shift + F', labelKey: 'shortcut_filter_list' },
      { keys: '\u2318/Ctrl + K', labelKey: 'shortcut_quick_jump' },
    ],
  },
  {
    titleKey: 'messaging',
    items: [
      { keys: '\u2318/Ctrl + Enter', labelKey: 'shortcut_send_message' },
      { keys: '\u2318/Ctrl + N', labelKey: 'shortcut_new_message' },
      { keys: '\u2318/Ctrl + Shift + G', labelKey: 'shortcut_new_group' },
      { keys: 'Escape', labelKey: 'shortcut_clear_selection' },
      { keys: 'Double-click', labelKey: 'shortcut_reply_message' },
    ],
  },
  {
    titleKey: 'calls',
    items: [
      { keys: '\u2318/Ctrl + Shift + A', labelKey: 'shortcut_start_call' },
    ],
  },
  {
    titleKey: 'appearance',
    items: [
      { keys: '\u2318/Ctrl + Shift + D', labelKey: 'shortcut_cycle_theme' },
      { keys: '\u2318/Ctrl + ?', labelKey: 'shortcut_keyboard_shortcuts' },
    ],
  },
]

export function KeyboardShortcutsOverlay() {
  const { shortcutsOpen, setShortcutsOpen } = useUIContext()

  if (!shortcutsOpen) return null

  return (
    <>
      <div
        className="shortcuts-overlay__backdrop"
        onClick={() => setShortcutsOpen(false)}
      />
      <div className="shortcuts-overlay">
        <div className="shortcuts-overlay__header">
          <h2 className="shortcuts-overlay__title">{t('keyboard_shortcuts')}</h2>
          <button
            className="shortcuts-overlay__close"
            type="button"
            onClick={() => setShortcutsOpen(false)}
          >
            ✕
          </button>
        </div>
        <div className="shortcuts-overlay__body">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.titleKey} className="shortcuts-overlay__group">
              <h3 className="shortcuts-overlay__group-title">{t(group.titleKey)}</h3>
              {group.items.map((item) => (
                <div key={item.labelKey} className="shortcuts-overlay__row">
                  <span className="shortcuts-overlay__label">{t(item.labelKey)}</span>
                  <kbd className="shortcuts-overlay__kbd">{item.keys}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
