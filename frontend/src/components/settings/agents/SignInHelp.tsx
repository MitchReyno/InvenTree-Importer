import type { AgentSelectionDto } from '@invimport/contracts'

/** Where a provider's sign-in lives; keys and tokens are never entered here. */
export function SignInHelp({
  provider,
  authentication,
}: Pick<AgentSelectionDto, 'provider' | 'authentication'>) {
  if (authentication === 'api_key') {
    return (
      <>
        Set <code>{provider === 'codex' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'}</code> in the
        separately supervised worker environment. Keys stay on the host and are never entered or
        returned here.
      </>
    )
  }
  if (provider === 'codex') {
    return (
      <>
        Sign in with <code>codex login</code> using{' '}
        <code>CODEX_HOME="$INTAKE_AGENT_STATE_ROOT/codex"</code>. This dedicated directory must have
        no custom configuration, plugins or skills.
      </>
    )
  }
  return (
    <>
      Sign in with <code>claude auth login</code> on the host as the worker's user. The application
      uses that native login without copying credentials.
    </>
  )
}
