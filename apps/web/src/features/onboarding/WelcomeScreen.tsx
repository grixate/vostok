import type { NavigationStack, OnboardingScreen } from '../../shared/hooks/useNavigation'

interface Props {
  nav: NavigationStack<OnboardingScreen>
}

export function WelcomeScreen({ nav }: Props) {
  return (
    <div className="onboarding-screen onboarding-screen--welcome">
      <div className="onboarding-hero">
        <svg
          className="onboarding-logo"
          viewBox="0 0 80 80"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Paper plane icon */}
          <path
            className="onboarding-logo__path"
            d="M10 40 L70 10 L50 70 L38 48 Z"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
            fill="none"
          />
          <path
            className="onboarding-logo__path"
            d="M38 48 L36 65 L46 54"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
            fill="none"
          />
          <path
            className="onboarding-logo__path"
            d="M38 48 L70 10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinejoin="round"
            fill="none"
          />
        </svg>
        <h1 className="onboarding-hero__title">Vostok</h1>
        <p className="onboarding-hero__tagline">Private messaging for people you trust.</p>
      </div>

      <div className="onboarding-actions">
        <button
          className="primary-action onboarding-actions__primary"
          type="button"
          onClick={() => nav.push('invite')}
        >
          Get Started
        </button>
        <button
          className="onboarding-actions__link"
          type="button"
          onClick={() => nav.push('sign-in')}
        >
          Sign in →
        </button>
      </div>
    </div>
  )
}
