import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serverQueryKey } from '#/queries/scope'
import { useServerScope } from '#/context'
import { KEY_PAUSE_MS } from './usePersonalClaudeCredential'

type Account = {
  state: 'pending' | 'connected' | 'disconnected' | 'denied'
  loginId?: string
  userCode?: string
  verificationUrl?: string
}

const POLL_MS = 3000

/**
 * The runner takes one action at a time, and `/personal-runner/codex` is one same-origin endpoint,
 * so every dialog shares one queue. It outlives the dialog, because a closing dialog's final poll
 * and cancel run after it has gone; a reopened dialog's command waits for them.
 */
let runnerQueue: Promise<unknown> = Promise.resolve()

/** Gives tests a fresh queue, so a call one test leaves pending can't hold up the next. */
export function resetRunnerQueue() {
  runnerQueue = Promise.resolve()
}

// The guest gives each Codex RPC 20 s, and an action makes up to four in turn (a disconnect, or a
// start with an existing account), so a call fails only after those and a margin.
const GUEST_RPC_LIMIT_MS = 20_000
const MOST_GUEST_RPCS = 4
const RUNNER_TIMEOUT_MS = GUEST_RPC_LIMIT_MS * MOST_GUEST_RPCS + 10_000

const FAILED =
  'Could not confirm sign-in status. Check the management key and reconnect to the runner.'

/**
 * One opening of the dialog, or one key typed in it. A queued call of a generation that has
 * ended is never sent, and its answer is ignored.
 */
type Generation = { ended: boolean }

/** A call dropped before sending because its generation ended. */
class DroppedCall extends Error {
  constructor() {
    super('runner_call_dropped')
  }
}

/** One call to the shared VM's Codex runner, outside the validated client facades. */
async function callRunner(managementKey: string, action: string, loginId?: string) {
  if (!window.isSecureContext) {
    throw new Error('insecure_context')
  }
  // A timer rather than `AbortSignal.timeout`, so the bound follows the page's clock in tests too.
  // It covers reading the answer as well as sending the request.
  const deadline = new AbortController()
  const timer = setTimeout(
    () => deadline.abort(new DOMException('runner_timeout', 'TimeoutError')),
    RUNNER_TIMEOUT_MS,
  )
  try {
    return await sendRunnerCall(managementKey, action, loginId, deadline.signal)
  } finally {
    clearTimeout(timer)
  }
}

async function sendRunnerCall(
  managementKey: string,
  action: string,
  loginId: string | undefined,
  signal: AbortSignal,
) {
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
    signal,
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

/** Queues a runner call; it is sent only if `generation` is still current when its turn comes. */
function queueCall(
  generation: Generation,
  managementKey: string,
  action: string,
  loginId?: string,
) {
  const call = runnerQueue.then(() => {
    if (generation.ended) {
      throw new DroppedCall()
    }
    return callRunner(managementKey, action, loginId)
  })
  runnerQueue = call.catch(() => undefined)
  return call
}

/**
 * Closing mid-sign-in: one final protected poll completes a login already approved, and a login
 * still pending is cancelled, so the read-only status never reports it as signing in for good.
 * Both take one turn of the queue, so a reopened dialog's first read sees the outcome.
 */
function finishLogin(managementKey: string, loginId: string) {
  const call = runnerQueue.then(async () => {
    const final = await callRunner(managementKey, 'status', loginId)
    if (final.state === 'pending') {
      await callRunner(managementKey, 'cancel', loginId)
    }
  })
  runnerQueue = call.catch(() => undefined)
  return call
}

type Options = {
  /** The VM confirmed the ChatGPT account after a sign-in: the dialog closes by itself. */
  onConfirmed: () => void
  /** The sign-in may have changed, for the VM's status to report. */
  onChanged: () => void
}

/**
 * The ChatGPT sign-in dialog's state, runner queue and sign-in poll. Each key typed starts a
 * generation, read with the protected status after a pause. Editing the key or closing the dialog
 * ends it: queued calls aren't sent, the poll stops and late answers are ignored.
 */
export function useChatGPTSignIn({ onConfirmed, onChanged }: Options) {
  // Held only while the dialog is open, for the calls this generation queues.
  const key = useRef('')
  const generation = useRef<Generation>({ ended: false })
  const pause = useRef<ReturnType<typeof setTimeout>>(undefined)
  // The login a closing dialog must finish or cancel.
  const pendingLogin = useRef<string | undefined>(undefined)
  const callbacks = useRef({ onConfirmed, onChanged })
  useLayoutEffect(() => {
    callbacks.current = { onConfirmed, onChanged }
  })
  const scope = useServerScope()
  // Generations restart with each mount; this keeps an earlier mount's entry out of the key.
  const mount = useId()
  const [epoch, setEpoch] = useState(0)
  const [account, setAccount] = useState<Account>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  // A status call can end the login, so a replayed poll adopts the call still running for it.
  const statusCall = useRef<{ id: string; call: Promise<Account> } | null>(null)
  const polling = account?.state === 'pending'
  const status = useQuery({
    // The management key is read from the hook and never enters the cache key.
    queryKey: serverQueryKey(scope, 'codex-login', mount, String(epoch), account?.loginId ?? ''),
    queryFn: () => pollStatus(`${epoch}:${account?.loginId ?? ''}`, account?.loginId),
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

  // The dialog is open while mounted. Closing ends its generation, drops the key, and finishes
  // or cancels a login still pending with one final poll.
  useEffect(() => {
    const current: Generation = { ended: false }
    generation.current = current
    const held = key
    const waiting = pause
    const login = pendingLogin
    const notify = callbacks
    return () => {
      current.ended = true
      clearTimeout(waiting.current)
      const finalKey = held.current
      held.current = ''
      const loginId = login.current
      login.current = undefined
      if (loginId) {
        notify.current.onChanged()
        void finishLogin(finalKey, loginId)
          .catch(() => undefined)
          .finally(() => notify.current.onChanged())
      }
    }
  }, [])

  // Commands wait for this login's poll, which can end the login.
  const blocked = busy || status.isFetching
  const pollFailed = polling && status.isError
  const shown = pollFailed ? undefined : polling ? status.data : account
  const shownMessage = pollFailed ? FAILED : message

  function pollStatus(id: string, loginId?: string) {
    if (statusCall.current?.id === id) {
      return statusCall.current.call
    }
    const mine = generation.current
    const call = queueCall(mine, key.current, 'status', loginId).then((next) => {
      if (!mine.ended) {
        adopt(next)
      }
      return next
    })
    const entry = { id, call }
    statusCall.current = entry
    void call
      .catch(() => undefined)
      .finally(() => {
        if (statusCall.current === entry) {
          statusCall.current = null
        }
      })
    return call
  }

  /** Records what the runner reported; a login confirmed after signing in closes the dialog. */
  function adopt(next: Account) {
    const wasSigningIn = pendingLogin.current !== undefined
    pendingLogin.current = next.state === 'pending' ? next.loginId : undefined
    if (wasSigningIn && next.state === 'connected') {
      callbacks.current.onConfirmed()
    }
  }

  async function request(action: string, loginId?: string) {
    if (blocked) {
      return
    }
    const mine = generation.current
    setBusy(true)
    try {
      const next = await queueCall(mine, key.current, action, loginId)
      if (mine.ended) {
        return
      }
      adopt(next)
      // The new account starts its own polling generation, so no older poll can replace it.
      setEpoch((value) => value + 1)
      setAccount(next)
      setMessage('')
      if (action !== 'status') {
        callbacks.current.onChanged()
      }
    } catch {
      if (!mine.ended) {
        setAccount(undefined)
        setMessage(FAILED)
      }
    } finally {
      if (!mine.ended) {
        setBusy(false)
      }
    }
  }

  /** A new key ends the generation: its queued calls aren't sent and its poll stops. */
  function editKey(value: string) {
    generation.current.ended = true
    const next: Generation = { ended: false }
    generation.current = next
    key.current = value
    pendingLogin.current = undefined
    clearTimeout(pause.current)
    setEpoch((current) => current + 1)
    setAccount(undefined)
    setMessage('')
    setBusy(false)
    if (value) {
      pause.current = setTimeout(() => {
        if (generation.current === next) {
          void latestRequest.current('status')
        }
      }, KEY_PAUSE_MS)
    }
  }

  // The key's pause ends after later renders; it reads the protected status through the newest one.
  const latestRequest = useRef(request)
  useLayoutEffect(() => {
    latestRequest.current = request
  })

  return {
    busy,
    blocked,
    shown,
    shownMessage,
    request,
    editKey,
  }
}
