import { useThemeContext, type ThemePreference } from '../../contexts/ThemeContext.tsx'

const ACCENT_PRESETS = [
  { label: 'Orange', value: '#FF5500' },
  { label: 'Amber', value: '#FF9500' },
  { label: 'Red', value: '#FF3B30' },
  { label: 'Pink', value: '#FF2D55' },
  { label: 'Purple', value: '#5856D6' },
  { label: 'Blue', value: '#008BFF' },
  { label: 'Teal', value: '#20BFAB' },
]

const BG_PRESETS_LIGHT = [
  { label: 'Soft Blue', value: '#E8F0FE' },
  { label: 'Soft Green', value: '#F0F8E8' },
  { label: 'Soft Orange', value: '#FFF3E0' },
  { label: 'Soft Purple', value: '#F3E8FF' },
]

const BG_PRESETS_DARK = [
  { label: 'Deep Navy', value: '#1A1A2E' },
  { label: 'Deep Green', value: '#1A2E1A' },
  { label: 'Deep Amber', value: '#2E2A1A' },
  { label: 'Deep Indigo', value: '#1A1A3E' },
]

const THEME_MODES: { label: string; value: ThemePreference }[] = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'System', value: 'system' },
]

export function ThemePicker() {
  const {
    themePreference,
    setThemePreference,
    resolvedTheme,
    accentColor,
    setAccentColor,
    chatBackground,
    setChatBackground,
  } = useThemeContext()

  const bgPresets = resolvedTheme === 'dark' ? BG_PRESETS_DARK : BG_PRESETS_LIGHT

  return (
    <div className="theme-picker">
      {/* Theme Mode */}
      <div className="theme-picker__section">
        <div className="theme-picker__label">Appearance</div>
        <div className="theme-picker__mode-group">
          {THEME_MODES.map((mode) => (
            <button
              key={mode.value}
              className={`theme-picker__mode-btn${themePreference === mode.value ? ' theme-picker__mode-btn--active' : ''}`}
              type="button"
              onClick={() => setThemePreference(mode.value)}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>

      {/* Accent Color */}
      <div className="theme-picker__section">
        <div className="theme-picker__label">Accent Color</div>
        <div className="theme-picker__accent-group">
          {ACCENT_PRESETS.map((preset) => (
            <button
              key={preset.value}
              className={`theme-picker__accent-dot${accentColor.toLowerCase() === preset.value.toLowerCase() ? ' theme-picker__accent-dot--active' : ''}`}
              style={{ background: preset.value }}
              type="button"
              onClick={() => setAccentColor(preset.value)}
              aria-label={preset.label}
              title={preset.label}
            >
              {accentColor.toLowerCase() === preset.value.toLowerCase() ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7L6 10L11 4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </button>
          ))}
        </div>
      </div>

      {/* Chat Background */}
      <div className="theme-picker__section">
        <div className="theme-picker__label">Chat Background</div>
        <div className="theme-picker__accent-group">
          <button
            className={`theme-picker__bg-dot theme-picker__bg-dot--default${chatBackground === null ? ' theme-picker__bg-dot--active' : ''}`}
            type="button"
            onClick={() => setChatBackground(null)}
            aria-label="Default"
            title="Default"
          >
            {chatBackground === null ? (
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M3 7L6 10L11 4" stroke="var(--label)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : null}
          </button>
          {bgPresets.map((preset) => (
            <button
              key={preset.value}
              className={`theme-picker__bg-dot${chatBackground === preset.value ? ' theme-picker__bg-dot--active' : ''}`}
              style={{ background: preset.value }}
              type="button"
              onClick={() => setChatBackground(preset.value)}
              aria-label={preset.label}
              title={preset.label}
            >
              {chatBackground === preset.value ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <path d="M3 7L6 10L11 4" stroke={resolvedTheme === 'dark' ? 'white' : '#333'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
