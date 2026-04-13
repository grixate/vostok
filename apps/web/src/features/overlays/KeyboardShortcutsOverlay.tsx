import { useUIContext } from '../../contexts/UIContext.tsx'

type ShortcutEntry = { keys: string; label: string }

const SHORTCUT_GROUPS: { title: string; items: ShortcutEntry[] }[] = [
  {
    title: 'Navigation',
    items: [
      { keys: 'Alt + ↑', label: 'Previous chat' },
      { keys: 'Alt + ↓', label: 'Next chat' },
      { keys: '/', label: 'Focus message input' },
      { keys: '⌘/Ctrl + \\', label: 'Toggle detail panel' },
    ],
  },
  {
    title: 'Search',
    items: [
      { keys: '⌘/Ctrl + F', label: 'Search in chat' },
      { keys: '⌘/Ctrl + Shift + F', label: 'Filter chat list' },
      { keys: '⌘/Ctrl + K', label: 'Quick jump to chat' },
    ],
  },
  {
    title: 'Messaging',
    items: [
      { keys: '⌘/Ctrl + Enter', label: 'Send message' },
      { keys: '⌘/Ctrl + N', label: 'New message' },
      { keys: '⌘/Ctrl + Shift + G', label: 'New group' },
      { keys: 'Escape', label: 'Clear selection / dismiss' },
      { keys: 'Double-click', label: 'Reply to message' },
    ],
  },
  {
    title: 'Calls',
    items: [
      { keys: '⌘/Ctrl + Shift + A', label: 'Start call' },
    ],
  },
  {
    title: 'Appearance',
    items: [
      { keys: '⌘/Ctrl + Shift + D', label: 'Cycle theme mode' },
      { keys: '⌘/Ctrl + ?', label: 'Keyboard shortcuts' },
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
          <h2 className="shortcuts-overlay__title">Keyboard Shortcuts</h2>
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
            <div key={group.title} className="shortcuts-overlay__group">
              <h3 className="shortcuts-overlay__group-title">{group.title}</h3>
              {group.items.map((item) => (
                <div key={item.label} className="shortcuts-overlay__row">
                  <span className="shortcuts-overlay__label">{item.label}</span>
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
