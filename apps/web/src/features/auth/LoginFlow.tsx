import type { useAuth } from '../../hooks/useAuth.ts'
import type { useServers } from '../../hooks/useServers.ts'
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
  servers: ReturnType<typeof useServers>
}

export function LoginFlow({ auth, servers }: LoginFlowProps) {
  const navigate = (view: AuthView) => {
    auth.setView(view)
  }
  const selectedServer = servers.activeServer
  const selectedServerUrl = selectedServer?.url ?? window.location.origin

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
          serverUrl={selectedServerUrl}
          serverName={selectedServer?.label ?? auth.serverInfo?.name ?? null}
          error={auth.error}
          loading={auth.loading}
          onCheckUsername={auth.handleCheckUsername}
          onBootstrap={auth.handleBootstrap}
        />
      )

    case 'invite-code':
      return (
        <InviteCodeScreen
          onValidateInvite={auth.handleValidateInvite}
          onContinue={auth.handleInviteContinue}
          onNavigate={navigate}
        />
      )

    case 'create-account':
      return (
        <CreateAccountScreen
          inviteCode={auth.inviteCode}
          serverInfo={auth.serverInfo}
          serverUrl={selectedServerUrl}
          serverName={selectedServer?.label ?? auth.serverInfo?.name ?? null}
          error={auth.error}
          loading={auth.loading}
          onCheckUsername={auth.handleCheckUsername}
          onRegister={auth.handleRegister}
          onNavigate={navigate}
        />
      )

    case 'access-request':
      return <AccessRequestScreen onRequestAccess={auth.handleRequestAccess} onNavigate={navigate} />

    case 'forgot-password':
      return (
        <ForgotPasswordScreen
          onRequestPasswordReset={auth.handleRequestPasswordReset}
          onNavigate={navigate}
        />
      )

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
          servers={servers}
          serverInfo={auth.serverInfo}
          serverUrl={selectedServerUrl}
          serverName={selectedServer?.label ?? auth.serverInfo?.name ?? null}
          error={auth.error}
          loading={auth.loading}
          onLogin={auth.handleLogin}
          onDevQuickLogin={auth.handleDevQuickLogin}
          onNavigate={navigate}
        />
      )
  }
}
