import { useState } from 'react'
import { CloseIcon, LinkChainIcon, CopyIcon } from '../../icons/index.tsx'
import { t } from '../../lib/i18n.ts'

type CallLinkSheetProps = {
  callLink: string | null
  onGenerateLink: () => Promise<string>
  onClose: () => void
}

export function CallLinkSheet({ callLink, onGenerateLink, onClose }: CallLinkSheetProps) {
  const [link, setLink] = useState(callLink)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)

  async function handleGenerate() {
    setGenerating(true)
    try {
      const newLink = await onGenerateLink()
      setLink(newLink)
    } catch {
      // Error handled by parent
    } finally {
      setGenerating(false)
    }
  }

  async function handleCopy() {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard not available
    }
  }

  return (
    <div className="incoming-call-overlay">
      <div className="incoming-call-overlay__card" style={{ maxWidth: 380, padding: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', padding: '16px 20px', gap: 12, borderBottom: '1px solid var(--border-subtle)', width: '100%' }}>
          <LinkChainIcon width={20} height={20} />
          <span style={{ fontSize: 17, fontWeight: 510, flex: 1 }}>{t('call_link')}</span>
          <button type="button" onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', display: 'flex' }}>
            <CloseIcon width={20} height={20} />
          </button>
        </div>

        <div style={{ padding: 20, width: '100%' }}>
          {link ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0 }}>
                {t('call_link_subtitle')}
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  readOnly
                  value={link}
                  style={{
                    flex: 1, padding: '10px 12px', borderRadius: 10,
                    border: 'none', background: 'var(--bg-surface-1)',
                    color: 'var(--text-primary)', fontSize: 14, outline: 'none',
                  }}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 40, height: 40, borderRadius: 10, border: 'none',
                    background: 'var(--accent)', color: 'white', cursor: 'pointer',
                  }}
                  aria-label={t('copy_link')}
                >
                  <CopyIcon width={18} height={18} />
                </button>
              </div>
              {copied && (
                <span style={{ fontSize: 13, color: 'var(--accent)' }}>{t('copied_to_clipboard')}</span>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, textAlign: 'center' }}>
                {t('generate_link_subtitle')}
              </p>
              <button
                type="button"
                disabled={generating}
                onClick={() => void handleGenerate()}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '10px 24px', borderRadius: 10, border: 'none',
                  background: 'var(--accent)', color: 'white', cursor: 'pointer',
                  fontSize: 14, fontWeight: 510, opacity: generating ? 0.6 : 1,
                }}
              >
                {generating ? t('generating') : t('generate_link')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
