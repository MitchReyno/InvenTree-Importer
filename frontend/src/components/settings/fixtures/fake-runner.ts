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
}

/** The read-only status the intake API reports, from the fake VM's state. */
export function fakeProviderStatus() {
  return {
    claude: fakeVm.claudeSaved
      ? {
          state: 'saved' as const,
          saved_at: fakeVm.claudeSavedAt,
          last_sign_in_failure: {
            attempt_id: '70000000-0000-4000-8000-000000000007',
            failure_id: '71000000-0000-4000-8000-000000000007',
            failed_at: '2026-11-23T21:40:00.000Z',
          },
        }
      : { state: 'not_saved' as const, last_sign_in_failure: null },
    codex: {
      state: { disconnected: 'signed_out', pending: 'signing_in', connected: 'signed_in' }[
        fakeVm.codex
      ] as 'signed_out' | 'signing_in' | 'signed_in',
      last_sign_in_failure: null,
    },
    read_at: new Date().toISOString(),
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
    }
  }
  if (fakeVm.codex === 'pending') {
    return challenge
  }
  return { state: fakeVm.codex }
}

let installed = false

/** Answers the dialogs' `/personal-runner/*` calls in the fixture page; others pass through. */
export function installFakeRunner() {
  if (installed) {
    return
  }
  installed = true
  const real = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = new URL(url, window.location.href).pathname
    if (path !== '/personal-runner/claude' && path !== '/personal-runner/codex') {
      return real(input, init)
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
    const body = JSON.parse(String(init?.body ?? '{}'))
    const answer = path.endsWith('claude') ? claude(body) : codex(body)
    return Response.json(answer)
  }
}
