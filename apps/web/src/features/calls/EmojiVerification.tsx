import { useState, useEffect, useRef } from 'react'
import { LockIcon } from '../../icons/index.tsx'

type EmojiVerificationProps = {
  emojis: string[]
}

export function EmojiVerification({ emojis }: EmojiVerificationProps) {
  const [expanded, setExpanded] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  // Close popover on outside click
  useEffect(() => {
    if (!expanded) return
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setExpanded(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [expanded])

  if (emojis.length === 0) return null

  return (
    <div style={{ position: 'relative' }} ref={popoverRef}>
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--text-secondary)', fontSize: 14, padding: '4px 8px',
          borderRadius: 8,
        }}
        aria-label="Encryption verification"
        aria-expanded={expanded}
      >
        <LockIcon width={12} height={12} />
        {emojis.map((emoji, i) => (
          <span key={`${i}-${emoji}`}>{emoji}</span>
        ))}
      </button>

      {expanded && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          background: 'var(--bg-panel)', borderRadius: 10, padding: 16,
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)', width: 260, zIndex: 100,
        }}>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, fontSize: 28, marginBottom: 12 }}>
            {emojis.map((emoji, i) => (
              <span key={`expanded-${i}-${emoji}`}>{emoji}</span>
            ))}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, textAlign: 'center', lineHeight: 1.4 }}>
            If these emojis match for all participants, the call is end-to-end encrypted and secure.
          </p>
        </div>
      )}
    </div>
  )
}
