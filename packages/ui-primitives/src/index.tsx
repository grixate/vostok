import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

type GlassSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  tone?: 'default' | 'muted' | 'accent'
}

export function GlassSurface({
  className,
  tone = 'default',
  ...props
}: GlassSurfaceProps) {
  return <div className={cx('vostok-glass', `vostok-glass--${tone}`, className)} {...props} />
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  glyph?: ReactNode
}

export function IconButton({ className, label, glyph, children, ...props }: IconButtonProps) {
  return (
    <button className={cx('vostok-icon-button', className)} type="button" aria-label={label} {...props}>
      {children ?? glyph ?? (
        <span className="vostok-icon-button__glyph" aria-hidden="true">
          {label.slice(0, 1)}
        </span>
      )}
    </button>
  )
}

type LabelPillProps = HTMLAttributes<HTMLDivElement> & {
  eyebrow?: string
  title: string
  subtitle?: string
}

export function LabelPill({ className, eyebrow, title, subtitle, ...props }: LabelPillProps) {
  return (
    <div className={cx('vostok-label-pill', className)} {...props}>
      {eyebrow ? <span className="vostok-label-pill__eyebrow">{eyebrow}</span> : null}
      <span className="vostok-label-pill__title">{title}</span>
      {subtitle ? <span className="vostok-label-pill__subtitle">{subtitle}</span> : null}
    </div>
  )
}

type DotProps = HTMLAttributes<HTMLSpanElement> & {
  status?: 'online' | 'away' | 'muted'
}

export function StatusDot({ className, status = 'online', ...props }: DotProps) {
  return <span className={cx('vostok-status-dot', `vostok-status-dot--${status}`, className)} {...props} />
}
