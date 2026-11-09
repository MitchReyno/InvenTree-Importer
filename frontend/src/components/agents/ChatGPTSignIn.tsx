import { useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '#/queries/scope'
import { Button } from '#/components/ui'
import { TextField } from '#/forms'

type Account = {
  state: 'pending' | 'connected' | 'disconnected' | 'denied'
  loginId?: string
  userCode?: string
  verificationUrl?: string
}

const POLL_MS = 3000

const FAILED =
  'Could not confirm sign-in status. Check the management key and reconnect to the runner.'

/** One call to the shared VM's Codex runner, outside the validated client facades. */
async function callRunner(managementKey: string, action: string, loginId?: string) {
  if (!window.isSecureContext) {
    throw new Error('insecure_context')
  }
  const r = await fetch('/personal-runner/codex', {
    method: 'POST',
    cache: 'no-store',
    credentials: 'omit',
    redirect: 'error',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + managementKey,
    },
    body: JSON.stringify({ action, loginId }),
  })
  if (!r.ok) {
    throw new Error('runner_refused')
  }
  const next = await r.json()
  if (
    !['pending', 'connected', 'disconnected', 'denied'].includes(next.state) ||
    (next.state === 'pending' &&
      (next.verificationUrl !== 'https://auth.openai.com/codex/device' ||
        typeof next.loginId !== 'string' ||
        typeof next.userCode !== 'string'))
  ) {
    throw new Error('runner_response_invalid')
  }
  return next as Account
}

export function ChatGPTSignIn() {
  const key = useRef<HTMLInputElement>(null)
  const scope = useServerScope()
  // Generations restart with each mount; this keeps an earlier mount's entry out of the key.
  const mount = useId()
  const [open, setOpen] = useState(false)
  const [account, setAccount] = useState<Account>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  // Each new key or sign-in step starts a generation; results of an older one are dropped.
  const [generation, setGeneration] = useState(0)
  // Counts requests and key edits; a response is kept only if nothing started after it.
  const startedIn = useRef(0)
  // The runner takes one action at a time, so this panel's calls run one after another. A
  // cancelled poll's result is dropped, but its call still finishes before the next starts.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const polling = open && account?.state === 'pending'
  const status = useQuery({
    // The management key is read from its field and never enters the cache key.
    queryKey: serverQueryKey(
      scope,
      'codex-login',
      mount,
      String(generation),
      account?.loginId ?? '',
    ),
    queryFn: () => run('status', account?.loginId),
    // App-wide reconciliation refetches enabled queries, so a failed or finished poll disables
    // itself rather than relying on the interval alone. No poll is queued behind a command.
    enabled: (query) =>
      polling && !busy && query.state.status !== 'error' && query.state.data?.state === 'pending',
    initialData: account,
    initialDataUpdatedAt: Date.now,
    staleTime: POLL_MS,
    retry: false,
    refetchInterval: (query) =>
      query.state.status === 'error' || query.state.data?.state !== 'pending' ? false : POLL_MS,
    // The login completes on the OpenAI tab, so polling continues while this one is hidden.
    refetchIntervalInBackground: true,
  })
  const pollFailed = polling && status.isError
  const shown = pollFailed ? undefined : polling ? status.data : account
  const shownMessage = pollFailed ? FAILED : message

  function run(action: string, loginId?: string) {
    const call = queue.current.then(() => callRunner(key.current?.value ?? '', action, loginId))
    queue.current = call.catch(() => undefined)
    return call
  }

  function startGeneration() {
    setGeneration((value) => value + 1)
    setAccount(undefined)
    setMessage('')
  }

  async function request(action: string, loginId?: string) {
    if (busy) {
      return
    }
    const current = startedIn.current + 1
    startedIn.current = current
    setBusy(true)
    try {
      const next = await run(action, loginId)
      if (startedIn.current === current) {
        // The new account starts its own polling generation, so no older poll can replace it.
        setGeneration((value) => value + 1)
        setAccount(next)
        setMessage('')
      }
    } catch {
      if (startedIn.current === current) {
        setAccount(undefined)
        setMessage(FAILED)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <Button
        aria-expanded={open}
        disabled={busy}
        onClick={() => {
          startedIn.current += 1
          startGeneration()
          setOpen(!open)
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
              startedIn.current += 1
              startGeneration()
            }}
          />
          <Button disabled={busy} onClick={() => void request('status')}>
            Check ChatGPT connection
          </Button>
          {shown?.state === 'connected' ? (
            <>
              <p role="status">Connected to ChatGPT</p>
              <Button disabled={busy} onClick={() => void request('disconnect')}>
                Disconnect ChatGPT
              </Button>
            </>
          ) : shown?.state === 'pending' ? (
            <>
              <p>
                Open{' '}
                <a href={shown.verificationUrl} target="_blank" rel="noreferrer">
                  OpenAI device verification
                </a>{' '}
                and enter <strong>{shown.userCode}</strong>.
              </p>
              <Button disabled={busy} onClick={() => void request('cancel', shown.loginId)}>
                Cancel sign-in
              </Button>
            </>
          ) : (
            <>
              <Button disabled={busy} onClick={() => void request('start')}>
                Sign in with ChatGPT
              </Button>
              {shown?.state === 'denied' && <p>Sign-in was declined or expired.</p>}
            </>
          )}
          {shownMessage && <p role="alert">{shownMessage}</p>}
        </fieldset>
      )}
    </section>
  )
}
