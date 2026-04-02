type PasswordStrength = 'weak' | 'fair' | 'strong'

function getPasswordStrength(password: string): PasswordStrength {
  if (password.length < 8) return 'weak'

  let score = 0
  if (password.length >= 12) score++
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++
  if (/\d/.test(password)) score++
  if (/[^a-zA-Z0-9]/.test(password)) score++

  if (score >= 3) return 'strong'
  if (score >= 1) return 'fair'
  return 'weak'
}

const strengthConfig = {
  weak: { segments: 1, color: '#FF453A', label: 'Weak — add numbers and symbols' },
  fair: { segments: 2, color: '#F59E0B', label: 'Fair — could be stronger' },
  strong: { segments: 3, color: '#22C55E', label: 'Strong password' }
}

export function PasswordStrengthBar({ password }: { password: string }) {
  if (!password) return null

  const strength = getPasswordStrength(password)
  const config = strengthConfig[strength]

  return (
    <div className="auth-strength-group">
      <div className="auth-strength-bar">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{ background: i < config.segments ? config.color : '#2A2A2A' }}
          />
        ))}
      </div>
      <span className="auth-strength-hint" style={{ color: config.color }}>
        {config.label}
      </span>
    </div>
  )
}
