import { useEffect, useRef, useState } from 'react'
import { Button, TextField } from '#/components/ui'

type Account = {
  state: 'pending' | 'connected' | 'disconnected' | 'denied'
  loginId?: string
  userCode?: string
  verificationUrl?: string
}

export function ChatGPTSignIn() {
  const key = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [account, setAccount] = useState<Account>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const inFlight = useRef(false)

  async function request(action: string, loginId?: string) {
    if (inFlight.current) {
      return
    }
    inFlight.current = true
    const current = generation.current
    setBusy(true)
    try {
      if (!window.isSecureContext) {
        throw new Error()
      }
      const r = await fetch('/personal-runner/codex', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + key.current?.value,
        },
        body: JSON.stringify({ action, loginId }),
      })
      if (!r.ok) {
        throw new Error()
      }
      const next = await r.json()
      if (
        !['pending', 'connected', 'disconnected', 'denied'].includes(next.state) ||
        (next.state === 'pending' &&
          (next.verificationUrl !== 'https://auth.openai.com/codex/device' ||
            typeof next.loginId !== 'string' ||
            typeof next.userCode !== 'string'))
      ) {
        throw new Error()
      }
      if (generation.current === current) {
        setAccount(next)
        setMessage('')
      }
    } catch {
      if (generation.current === current) {
        setAccount(undefined)
        setMessage(
          'Could not confirm sign-in status. Check the management key and reconnect to the runner.',
        )
      }
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!open || account?.state !== 'pending') {
      return
    }
    const timer = setInterval(() => {
      void request('status', account.loginId)
    }, 3000)
    return () => clearInterval(timer)
  }, [open, account?.state, account?.loginId])
  return (
    <section>
      <Button
        aria-expanded={open}
        disabled={busy}
        onClick={() => {
          generation.current++
          setOpen(!open)
          setMessage('')
          setAccount(undefined)
        }}
      >
        ChatGPT subscription
      </Button>
      {open && (
        <fieldset>
          <legend>Codex in the shared VM</legend>
          <p>
            Enable device code sign-in for Codex in{' '}
            <a href="https://chatgpt.com/#settings/Security" target="_blank" rel="noreferrer">
              ChatGPT Security Settings
            </a>{' '}
            before starting. If you just enabled it, cancel the previous code and start again.
          </p>
          <TextField
            label="Codex runner management key"
            ref={key}
            type="password"
            autoComplete="off"
            onChange={() => {
              generation.current++
              setAccount(undefined)
              setMessage('')
            }}
          />
          <Button disabled={busy} onClick={() => void request('status')}>
            Check ChatGPT connection
          </Button>
          {account?.state === 'connected' ? (
            <>
              <p role="status">Connected to ChatGPT</p>
              <Button disabled={busy} onClick={() => void request('disconnect')}>
                Disconnect ChatGPT
              </Button>
            </>
          ) : account?.state === 'pending' ? (
            <>
              <p>
                Open{' '}
                <a href={account.verificationUrl} target="_blank" rel="noreferrer">
                  OpenAI device verification
                </a>{' '}
                and enter <strong>{account.userCode}</strong>.
              </p>
              <Button disabled={busy} onClick={() => void request('cancel', account.loginId)}>
                Cancel sign-in
              </Button>
            </>
          ) : (
            <>
              <Button disabled={busy} onClick={() => void request('start')}>
                Sign in with ChatGPT
              </Button>
              {account?.state === 'denied' && <p>Sign-in was declined or expired.</p>}
            </>
          )}
          {message && <p role="alert">{message}</p>}
        </fieldset>
      )}
    </section>
  )
}
