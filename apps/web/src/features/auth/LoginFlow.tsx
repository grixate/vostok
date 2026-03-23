import type { useAuth } from '../../hooks/useAuth.ts'
import type { AuthView } from '../../types.ts'
import { LoginScreen } from './LoginScreen.tsx'
import { InviteCodeScreen } from './InviteCodeScreen.tsx'
import { CreateAccountScreen } from './CreateAccountScreen.tsx'
import { AccessRequestScreen } from './AccessRequestScreen.tsx'
import { ForgotPasswordScreen } from './ForgotPasswordScreen.tsx'
import { ForcePasswordChangeScreen } from './ForcePasswordChangeScreen.tsx'
import { ServerBootstrapScreen } from './ServerBootstrapScreen.tsx'

type LoginFlowProps = {
  auth: ReturnType<typeof useAuth>
}

export function LoginFlow({ auth }: LoginFlowProps) {
  const navigate = (view: AuthView) => {
    auth.setView(view)
  }

  // Show nothing while checking stored session
  if (auth.initializing) {
    return (
      <div className="auth-shell">
        <span className="auth-spinner" />
      </div>
    )
  }

  switch (auth.view) {
    case 'server-bootstrap':
      return (
        <ServerBootstrapScreen
          error={auth.error}
          loading={auth.loading}
          onBootstrap={auth.handleBootstrap}
        />
      )

    case 'invite-code':
      return (
        <InviteCodeScreen
          onContinue={auth.handleInviteContinue}
          onNavigate={navigate}
        />
      )

    case 'create-account':
      return (
        <CreateAccountScreen
          inviteCode={auth.inviteCode}
          serverInfo={auth.serverInfo}
          error={auth.error}
          loading={auth.loading}
          onRegister={auth.handleRegister}
          onNavigate={navigate}
        />
      )

    case 'access-request':
      return <AccessRequestScreen onNavigate={navigate} />

    case 'forgot-password':
      return <ForgotPasswordScreen onNavigate={navigate} />

    case 'force-password-change':
      return (
        <ForcePasswordChangeScreen
          error={auth.error}
          loading={auth.loading}
          onChangePassword={auth.handleChangePassword}
        />
      )

    case 'login':
    default:
      return (
        <LoginScreen
          serverInfo={auth.serverInfo}
          error={auth.error}
          loading={auth.loading}
          onLogin={auth.handleLogin}
          onDevQuickLogin={auth.handleDevQuickLogin}
          onNavigate={navigate}
        />
      )
  }
}
