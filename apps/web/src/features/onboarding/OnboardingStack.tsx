import { useState } from 'react'
import { useOnboardingNav } from '../../shared/hooks/useNavigation'
import { type StoredDevice } from '../../shared/context/AuthContext'
import { WelcomeScreen } from './WelcomeScreen'
import { InviteScreen } from './InviteScreen'
import { CreateAccountScreen } from './CreateAccountScreen'
import { KeyGenerationScreen } from './KeyGenerationScreen'
import { SignInScreen } from './SignInScreen'

interface Props {
  onAuthenticated: (device: StoredDevice) => void
}

export function OnboardingStack({ onAuthenticated }: Props) {
  const nav = useOnboardingNav('welcome')
  const [inviteToken, setInviteToken] = useState<string | null>(null)

  switch (nav.current) {
    case 'welcome':
      return <WelcomeScreen nav={nav} />

    case 'invite':
      return (
        <InviteScreen
          nav={nav}
          onTokenValidated={(token) => setInviteToken(token)}
        />
      )

    case 'create-account':
      return (
        <CreateAccountScreen
          nav={nav}
          inviteToken={inviteToken}
          onRegistered={onAuthenticated}
        />
      )

    case 'key-generation':
      // This screen is shown during the async registration flow.
      // CreateAccountScreen navigates here before the async work starts.
      return <KeyGenerationScreen step="generating" />

    case 'sign-in':
      return <SignInScreen nav={nav} onSignedIn={onAuthenticated} />

    default:
      return <WelcomeScreen nav={nav} />
  }
}
