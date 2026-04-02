import type { ReactNode, CSSProperties } from 'react'
import { ChevronRightIcon } from '../../icons/index.tsx'

// ─── Toggle ────────────────────────────────────────────────────────────────────

export function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`toggle ${on ? 'toggle--on' : ''}`}
      onClick={onToggle}
    >
      <span className="toggle__thumb" />
    </button>
  )
}

// ─── Row Components ────────────────────────────────────────────────────────────

export function ToggleRow({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void; last?: boolean }) {
  return (
    <div className="settings-section__row settings-section__row--info">
      <span style={{ flex: 1 }}>{label}</span>
      <Toggle on={on} onToggle={onToggle} />
    </div>
  )
}

export function ChevronRow({ label, secondary, onClick }: { label: string; secondary?: string; onClick?: () => void; last?: boolean }) {
  return (
    <button type="button" className="settings-section__row" onClick={onClick}>
      <span style={{ flex: 1 }}>{label}</span>
      {secondary && <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{secondary}</span>}
      <ChevronRightIcon />
    </button>
  )
}

export function RadioRow({ label, active, onSelect }: { label: string; active: boolean; onSelect: () => void; last?: boolean }) {
  return (
    <button type="button" className="settings-section__row" onClick={onSelect}>
      <span style={{ flex: 1 }}>{label}</span>
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          border: active ? 'none' : '2px solid var(--text-secondary)',
          background: active ? 'var(--accent)' : 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {active && <span style={{ width: 8, height: 8, borderRadius: 4, background: '#fff' }} />}
      </span>
    </button>
  )
}

export function InfoRow({ label, value }: { label: string; value: string; last?: boolean }) {
  return (
    <div className="settings-section__row settings-section__row--info">
      <span style={{ flex: 1 }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  )
}

export function ButtonRow({ label, color, onClick }: { label: string; color?: 'accent' | 'danger'; onClick?: () => void; last?: boolean }) {
  const c = color === 'danger' ? 'var(--status-error)' : 'var(--accent)'
  return (
    <button type="button" className="settings-section__row" onClick={onClick} style={{ color: c, fontWeight: 600 }}>
      {label}
    </button>
  )
}

// ─── Group Wrapper ─────────────────────────────────────────────────────────────

export function SectionLabel({ children, description }: { children: ReactNode; description?: string }) {
  return (
    <>
      <div className="settings-section__group-title" style={{ paddingTop: 18 }}>
        {children}
      </div>
      {description && <p className="settings-section__group-desc">{description}</p>}
    </>
  )
}

export function GroupCard({ children }: { children: ReactNode }) {
  return (
    <div className="settings-section__group">
      {children}
    </div>
  )
}

// ─── Shared Row Styles ─────────────────────────────────────────────────────────

export const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  height: 48,
  padding: '0 20px',
  fontSize: 14,
  color: 'var(--label)',
  background: 'none',
  borderBottom: '1px solid var(--border-subtle)',
  width: '100%',
}

export const lastRowMod: CSSProperties = { borderBottom: 'none' }
