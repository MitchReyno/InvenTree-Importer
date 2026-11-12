import { Button } from '#/components/ui'
import { TextField } from '#/forms'
import type { PersonalClaudeCredentialState } from './usePersonalClaudeCredential'

type Props = {
  /** The panel's state, held by the Agents settings section so its provider card agrees. */
  credential: PersonalClaudeCredentialState
}

export function PersonalClaudeCredential({ credential }: Props) {
  const { key, token, status, message, busy, open, submit, toggle, editKey } = credential

  return (
    <section>
      <Button disabled={busy} aria-expanded={open} onClick={toggle}>
        Personal Claude subscription
      </Button>
      {open && (
        <fieldset disabled={busy}>
          <legend>Shared VM credential</legend>
          <TextField
            label="Personal runner management key"
            type="password"
            autoComplete="off"
            ref={key}
            onChange={editKey}
          />
          <Button onClick={() => void submit('status')}>Check configuration</Button>
          {status && (
            <>
              <p role="status">{status.configured ? 'Configured' : 'Unconfigured'}</p>
              <TextField
                ref={token}
                label="CLAUDE_CODE_OAUTH_TOKEN"
                type="password"
                autoComplete="off"
              />
              <Button onClick={() => void submit('save')}>
                {status.configured ? 'Replace token' : 'Save token'}
              </Button>
              {status.configured && (
                <Button onClick={() => void submit('remove')}>Remove token</Button>
              )}
            </>
          )}
          {message && <p role="alert">{message}</p>}
        </fieldset>
      )}
    </section>
  )
}
