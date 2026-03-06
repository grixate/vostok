interface Props {
  step: 'generating' | 'registering' | 'connecting' | 'done'
}

const STEPS: { key: Props['step']; label: string }[] = [
  { key: 'generating', label: 'Generating encryption keys' },
  { key: 'registering', label: 'Registering your device' },
  { key: 'connecting', label: 'Connecting to Vostok' }
]

const STEP_ORDER: Props['step'][] = ['generating', 'registering', 'connecting', 'done']

export function KeyGenerationScreen({ step }: Props) {
  const currentIndex = STEP_ORDER.indexOf(step)

  return (
    <div className="onboarding-screen onboarding-screen--keygen">
      <div className="onboarding-card">
        <div className="keygen-lock" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect
              className="keygen-lock__body"
              x="8" y="22" width="32" height="22"
              rx="4"
              stroke="currentColor"
              strokeWidth="2.5"
              fill="none"
            />
            <path
              className="keygen-lock__shackle"
              d="M16 22V16a8 8 0 0 1 16 0v6"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              fill="none"
            />
            <circle
              className="keygen-lock__keyhole"
              cx="24" cy="33"
              r="3"
              fill="currentColor"
            />
          </svg>
        </div>

        <h2 className="onboarding-card__title">Setting up encryption</h2>

        <div className="keygen-steps">
          {STEPS.map((s, i) => {
            const done = currentIndex > i
            const active = currentIndex === i
            return (
              <div
                key={s.key}
                className={[
                  'keygen-step',
                  done ? 'keygen-step--done' : '',
                  active ? 'keygen-step--active' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="keygen-step__indicator" aria-hidden="true">
                  {done ? '✓' : active ? '…' : '○'}
                </span>
                <span className="keygen-step__label">{s.label}</span>
              </div>
            )
          })}
        </div>

        <div className="keygen-progress" role="progressbar" aria-valuenow={currentIndex} aria-valuemax={3}>
          <div
            className="keygen-progress__bar"
            style={{ width: `${Math.round((currentIndex / 3) * 100)}%` }}
          />
        </div>
      </div>
    </div>
  )
}
