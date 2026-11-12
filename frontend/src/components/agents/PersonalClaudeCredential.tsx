import { useRef, useState } from 'react'
import { Button } from '#/components/ui'
import { TextField } from '#/forms'
import { useAsyncAction } from '#/lifecycle/useAsyncAction'

type CredentialAction = 'status' | 'save' | 'remove'

const UNCONFIRMED =
  'Request unconfirmed. Check your management key and reconnect to the personal runner.'

export function PersonalClaudeCredential() {
  const key = useRef<HTMLInputElement>(null)
  const token = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<{ configured: boolean; revision: string }>()
  const [open, setOpen] = useState(false)
  const { busy, error, run, clearError } = useAsyncAction()

  async function request(action: CredentialAction) {
    if (!window.isSecureContext) {
      throw new Error()
    }
    const response = await fetch('/personal-runner/claude', {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer ' + key.current?.value,
      },
      body: JSON.stringify({
        action,
        revision: status?.revision,
        token: action === 'save' ? token.current?.value : undefined,
      }),
    })
    if (!response.ok) {
      throw new Error()
    }
    const next = await response.json()
    if (typeof next.configured !== 'boolean' || typeof next.revision !== 'string') {
      throw new Error()
    }
    setStatus({ configured: next.configured, revision: next.revision })
    if (token.current) {
      token.current.value = ''
    }
  }

  async function submit(action: CredentialAction) {
    const outcome = await run(() => request(action), UNCONFIRMED)
    if (outcome === 'failed') {
      setStatus(undefined)
    }
  }

  return (
    <section>
      <Button
        disabled={busy}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open)
          setStatus(undefined)
          clearError()
        }}
      >
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
            onChange={() => setStatus(undefined)}
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
          {error && <p role="alert">{error}</p>}
        </fieldset>
      )}
    </section>
  )
}
