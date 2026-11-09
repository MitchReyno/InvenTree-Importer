import { useId, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { serverQueryKey, useServerScope } from '#/queries/scope'
import type { ProviderStatus } from './provider-status'

type Account = {
  state: 'pending' | 'connected' | 'disconnected' | 'denied'
  loginId?: string
  userCode?: string
  verificationUrl?: string
}

const POLL_MS = 3000

const CARD_STATUS: Record<Account['state'], ProviderStatus> = {
  connected: 'Connected',
  pending: 'Signing in',
  disconnected: 'Not connected',
  denied: 'Declined',
}

/**
 * The runner takes one action at a time, and `/personal-runner/codex` is one same-origin endpoint,
 * so every panel shares one queue. It outlives the panel, because leaving the Settings section
 * unmounts the panel while a call can still be running; a remounted panel's command waits for it.
 */
let runnerQueue: Promise<unknown> = Promise.resolve()

/** Gives tests a fresh queue, so a call one test leaves pending can't hold up the next. */
export function resetRunnerQueue() {
  runnerQueue = Promise.resolve()
}

// The guest gives each Codex RPC 20 s, and a disconnect makes up to four in turn (initialize,
// logout, then two account reads), so a call fails only after those and a margin.
const GUEST_RPC_LIMIT_MS = 20_000
const MOST_GUEST_RPCS = 4
const RUNNER_TIMEOUT_MS = GUEST_RPC_LIMIT_MS * MOST_GUEST_RPCS + 10_000

const FAILED =
  'Could not confirm sign-in status. Check the management key and reconnect to the runner.'

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

/**
 * The ChatGPT sign-in panel's state, runner queue and sign-in poll. The Agents settings section
 * holds it, so the provider card shows the same status as the panel without an Effect, and the
 * poll stops when the section unmounts.
 */
export function useChatGPTSignIn() {
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
  // A status call can end the login, so a replayed poll adopts the call still running for it.
  const statusCall = useRef<{ id: string; call: Promise<Account> } | null>(null)
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
    queryFn: () => pollStatus(`${generation}:${account?.loginId ?? ''}`, account?.loginId),
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
  // As when every poll was a request, commands wait for this login's poll: it can end the login.
  const blocked = busy || status.isFetching
  const pollFailed = polling && status.isError
  const shown = pollFailed ? undefined : polling ? status.data : account
  const shownMessage = pollFailed ? FAILED : message

  /** Queues a runner call with the key typed now. */
  function run(action: string, loginId?: string) {
    const managementKey = key.current?.value ?? ''
    const call = runnerQueue.then(() => callRunner(managementKey, action, loginId))
    runnerQueue = call.catch(() => undefined)
    return call
  }

  function pollStatus(id: string, loginId?: string) {
    if (statusCall.current?.id === id) {
      return statusCall.current.call
    }
    const call = run('status', loginId)
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

  function startGeneration() {
    setGeneration((value) => value + 1)
    setAccount(undefined)
    setMessage('')
  }

  async function request(action: string, loginId?: string) {
    if (blocked) {
      return
    }
    setBusy(true)
    try {
      const next = await run(action, loginId)
      // The new account starts its own polling generation, so no older poll can replace it.
      setGeneration((value) => value + 1)
      setAccount(next)
      setMessage('')
    } catch {
      setAccount(undefined)
      setMessage(FAILED)
    } finally {
      setBusy(false)
    }
  }

  function toggle() {
    startGeneration()
    setOpen(!open)
  }

  let card: ProviderStatus = 'Not checked'
  if (shownMessage) {
    card = 'Check failed'
  } else if (shown) {
    card = CARD_STATUS[shown.state]
  }

  // A new key starts a generation, so a poll for the old one can't change what shows.
  return {
    key,
    open,
    busy,
    blocked,
    shown,
    shownMessage,
    request,
    toggle,
    editKey: startGeneration,
    card,
  }
}

export type ChatGPTSignInState = ReturnType<typeof useChatGPTSignIn>
