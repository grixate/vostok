import { useState, useEffect } from 'react'
import { createInvite, type CreateInviteResponse } from '../../lib/api'

type ExpiryOption = '24h' | '7d' | '30d'

interface Props {
  sessionToken: string
  onClose: () => void
}

export function InviteShareSheet({ sessionToken, onClose }: Props) {
  const [expiry, setExpiry] = useState<ExpiryOption>('7d')
  const [invite, setInvite] = useState<CreateInviteResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    createInvite(sessionToken, { expires_in: expiry })
      .then((result) => {
        if (!cancelled) {
          setInvite(result)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to create invite.')
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [sessionToken, expiry])

  function handleCopyLink() {
    if (!invite) return
    void navigator.clipboard.writeText(invite.link).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="invite-sheet-backdrop" onClick={onClose}>
      <div
        className="invite-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Invite someone to Vostok"
      >
        <div className="invite-sheet__header">
          <h2 className="invite-sheet__title">Invite someone</h2>
          <button
            className="invite-sheet__close vostok-icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            <span className="vostok-icon-button__glyph">×</span>
          </button>
        </div>

        <div className="invite-sheet__expiry">
          <span className="invite-sheet__label">Expires in</span>
          <div className="invite-sheet__expiry-options">
            {(['24h', '7d', '30d'] as ExpiryOption[]).map((opt) => (
              <button
                key={opt}
                className={expiry === opt ? 'auth-tab auth-tab--active' : 'auth-tab'}
                type="button"
                onClick={() => {
                  setExpiry(opt)
                  setInvite(null)
                }}
              >
                {opt === '24h' ? '24 hours' : opt === '7d' ? '7 days' : '30 days'}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="invite-sheet__loading">Generating invite…</div>
        ) : error ? (
          <div className="invite-sheet__error">{error}</div>
        ) : invite ? (
          <>
            <div className="invite-sheet__link-row">
              <input
                className="invite-sheet__link-input"
                readOnly
                value={invite.link}
                onFocus={(e) => e.target.select()}
              />
              <button
                className="primary-action invite-sheet__copy"
                type="button"
                onClick={handleCopyLink}
              >
                {copied ? 'Copied!' : 'Copy link'}
              </button>
            </div>

            {invite.expires_at ? (
              <span className="invite-sheet__expires">
                Expires {new Date(invite.expires_at).toLocaleDateString()}
              </span>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  )
}
