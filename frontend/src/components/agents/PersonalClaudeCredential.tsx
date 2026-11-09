import { useRef, useState } from 'react'
import { Button } from '#/components/ui'
import { TextField } from '#/forms'

export function PersonalClaudeCredential() {
  const key = useRef<HTMLInputElement>(null)
  const token = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<{ configured: boolean; revision: string }>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  async function submit(action: 'status' | 'save' | 'remove') {
    setBusy(true)
    setMessage('')
    try {
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
    } catch {
      setStatus(undefined)
      setMessage(
        'Request unconfirmed. Check your management key and reconnect to the personal runner.',
      )
    } finally {
      setBusy(false)
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
          setMessage('')
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
          {message && <p role="alert">{message}</p>}
        </fieldset>
      )}
    </section>
  )
}
