/**
 * The fixture's stand-in for the agent VM: the read-only provider status, and the management
 * endpoints the sign-in dialogs call. Staged for the demo: any management key works, a Claude
 * token saves when its shape is right, and a ChatGPT sign-in is confirmed on the second poll.
 */
export const fakeVm = {
  claudeSaved: true,
  claudeSavedAt: '2026-11-24T02:10:00.000Z' as string | null,
  claudeRevision: 1,
  codex: 'disconnected' as 'disconnected' | 'pending' | 'connected',
  polls: 0,
  /** When the VM last checked Codex, and when a check it is running finishes. */
  codexCheckedAt: Date.now() - 4 * 60_000,
  codexCheckEndsAt: 0,
  /** A sign-in change forgot the last check, and none has finished since. */
  codexForgotten: false,
}

/** How long the fake VM's Codex check takes, like `account/read` on the real one. */
const CODEX_CHECK_MS = 1500

/** Check again: the fake VM starts a Codex check unless one is running. */
export function fakeCodexCheck() {
  if (Date.now() >= fakeVm.codexCheckEndsAt) {
    fakeVm.codexCheckEndsAt = Date.now() + CODEX_CHECK_MS
  }
}

/** The read-only status the intake API reports, from the fake VM's state. */
export function fakeProviderStatus() {
  const now = Date.now()
  if (fakeVm.codexCheckEndsAt && now >= fakeVm.codexCheckEndsAt) {
    fakeVm.codexCheckedAt = fakeVm.codexCheckEndsAt
    fakeVm.codexCheckEndsAt = 0
    fakeVm.codexForgotten = false
  }
  const checkedAt = new Date(now).toISOString()
  const codexState = { disconnected: 'signed_out', pending: 'signing_in', connected: 'signed_in' }[
    fakeVm.codex
  ] as 'signed_out' | 'signing_in' | 'signed_in'
  const codexChecking = fakeVm.codexForgotten && fakeVm.codex === 'connected'
  return {
    claude: fakeVm.claudeSaved
      ? {
          state: 'saved' as const,
          saved_at: fakeVm.claudeSavedAt,
          checked_at: checkedAt,
          last_sign_in_failure: {
            attempt_id: '70000000-0000-4000-8000-000000000007',
            failure_id: '71000000-0000-4000-8000-000000000007',
            failed_at: '2026-11-23T21:40:00.000Z',
          },
        }
      : { state: 'not_saved' as const, checked_at: checkedAt, last_sign_in_failure: null },
    codex: codexChecking
      ? { state: 'unknown' as const, reason: 'checking' as const, last_sign_in_failure: null }
      : {
          state: codexState,
          // A pending login is read from memory, so it is as of now.
          checked_at: new Date(fakeVm.codex === 'pending' ? now : fakeVm.codexCheckedAt).toISOString(),
          refreshing: fakeVm.codexCheckEndsAt > now,
          last_sign_in_failure: null,
        },
    read_at: checkedAt,
  }
}

const challenge = {
  state: 'pending',
  loginId: 'fixture-login',
  userCode: 'BENCH-4821',
  verificationUrl: 'https://auth.openai.com/codex/device',
}

function claude(body: { action: string; token?: string }) {
  if (body.action === 'save') {
    fakeVm.claudeSaved = true
    fakeVm.claudeSavedAt = new Date().toISOString()
    fakeVm.claudeRevision += 1
  } else if (body.action === 'remove') {
    fakeVm.claudeSaved = false
    fakeVm.claudeRevision += 1
  }
  return { configured: fakeVm.claudeSaved, revision: String(fakeVm.claudeRevision) }
}

function codex(body: { action: string }) {
  if (body.action === 'start') {
    fakeVm.codex = 'pending'
    fakeVm.polls = 0
  } else if (body.action === 'cancel' || body.action === 'disconnect') {
    fakeVm.codex = 'disconnected'
  } else if (fakeVm.codex === 'pending') {
    fakeVm.polls += 1
    if (fakeVm.polls >= 2) {
      fakeVm.codex = 'connected'
      // Like the real VM, a sign-in forgets the last check, so the next reads say checking.
      fakeVm.codexForgotten = true
      fakeVm.codexCheckEndsAt = Date.now() + CODEX_CHECK_MS
    }
  }
  if (fakeVm.codex === 'pending') {
    return challenge
  }
  return { state: fakeVm.codex }
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') {
    return input
  }
  return input instanceof URL ? input.href : input.url
}

/**
 * Answers the dialogs' `/personal-runner/*` calls in the fixture page; others pass through.
 * Returns the uninstall.
 */
export function installFakeRunner() {
  const original = window.fetch
  const real = original.bind(window)
  window.fetch = async (input, init) => {
    const path = new URL(requestUrl(input), window.location.href).pathname
    if (path !== '/personal-runner/claude' && path !== '/personal-runner/codex') {
      return real(input, init)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    const body = JSON.parse(String(init?.body ?? '{}'))
    const answer = path.endsWith('claude') ? claude(body) : codex(body)
    return Response.json(answer)
  }
  return () => {
    window.fetch = original
  }
}
