import type { ReactNode } from 'react'

/**
 * Two-pane layout: fixed sidebar (320px) + flexible main panel.
 * This component owns no state — it's purely structural.
 */
export function AppShell({
  sidebar,
  main,
  className,
}: {
  sidebar: ReactNode
  main: ReactNode
  className?: string
}) {
  return (
    <div className={['app-shell', className].filter(Boolean).join(' ')}>
      <aside className="app-shell__sidebar">{sidebar}</aside>
      <main className="app-shell__main">{main}</main>
    </div>
  )
}
