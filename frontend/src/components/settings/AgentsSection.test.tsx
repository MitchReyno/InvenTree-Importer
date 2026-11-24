import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type {
  AgentSessionListDto,
  AgentSettingsDto,
  AgentSettingsUpdateDto,
  ProviderStatusDto,
} from '@invimport/contracts'
import { IntakeRequestError, type agentsClient } from '@invimport/contracts/client'
import { useQueryClient } from '@tanstack/react-query'
import { fixtureScope, render } from '#/test/render'
import { serverQueryKey } from '#/queries/scope'
import { createServerQueryClient } from '#/queries/client'
import { freshReads } from '#/queries/fresh-reads'
import { deferred } from '#/test/deferred'
import type { SettingsSectionId } from '#/navigation/app-route'
import { Settings } from './Settings'
import { resetRunnerQueue } from '#/components/agents/useChatGPTSignIn'
import { KEY_PAUSE_MS } from '#/components/agents/usePersonalClaudeCredential'
import { SETTLE_MS } from '#/components/agents/useProviderStatus'
import { agentSettings, agentSettingsUpdate } from '#/test/agent-settings'

// Readiness says whether this profile's sessions have web access; each test sets it.
const readiness = vi.hoisted(() => {
  const listeners = new Set<() => void>()
  let web: 'available' | 'unavailable' | undefined = 'available'
  return {
    get: () => web,
    set(next: typeof web) {
      web = next
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
})
vi.mock('#/debug/useReadiness', async () => {
  const { useSyncExternalStore } = await import('react')
  return {
    useReadiness: () => {
      const web = useSyncExternalStore(readiness.subscribe, readiness.get)
      return { data: web ? { web } : undefined }
    },
  }
})

const initialSelection = {
  provider: 'claude',
  authentication: 'subscription',
  model: 'sonnet',
} as const
const initial: AgentSettingsDto = agentSettings('7', {
  provider: 'claude',
  authentication: 'subscription',
  model: 'sonnet',
})

type Session = AgentSessionListDto['sessions'][number]

function session(overrides: Partial<Session>): Session {
  return {
    attempt_id: crypto.randomUUID(),
    job_id: crypto.randomUUID(),
    batch_id: 'batch-a',
    subject_id: null,
    stage: 'research',
    state: 'running',
    occupies_lane: false,
    queued_at: '2026-11-10T01:00:00.000Z',
    started_at: null,
    finished_at: null,
    session_state: null,
    latest_status: null,
    latest_on_job: true,
    paused: false,
    failure: null,
    ...overrides,
  } as Session
}

function client() {
  return {
    settings: vi.fn(async () => initial),
    saveSettings: vi.fn(
      async ({
        expected_revision: _,
        ...fields
      }: AgentSettingsUpdateDto): Promise<AgentSettingsDto> => ({
        ...fields,
        revision: '8',
      }),
    ),
    sessions: vi.fn(
      async (): Promise<AgentSessionListDto> =>
        ({
          sessions: [
            session({ occupies_lane: true }),
            session({ occupies_lane: true }),
            session({ occupies_lane: true }),
            session({ state: 'queued' }),
          ],
          next_before: null,
          sessions_supported: true,
          paused_batch_ids: [],
        }) as unknown as AgentSessionListDto,
    ),
    failure: vi.fn(),
    pause: vi.fn(),
    pauseAll: vi.fn(async (paused: boolean) => ({ paused, batch_ids: [] })),
    deliverInstructions: vi.fn(),
    providerStatus: vi.fn(async (): Promise<ProviderStatusDto> => providerStatus()),
  }
}

/** The read-only status: a saved Claude token and Codex signed out, unless a test says otherwise. */
function providerStatus(overrides: Partial<ProviderStatusDto> = {}): ProviderStatusDto {
  return {
    claude: { state: 'saved', saved_at: null, last_sign_in_failure: null },
    codex: { state: 'signed_out', last_sign_in_failure: null },
    read_at: '2026-11-24T05:00:00.000Z',
    ...overrides,
  }
}

type Api = ReturnType<typeof client>

/** Settings with its section held in state, as the route would hold it. */
function Harness({ api, dirty }: { api: Api; dirty?: (value: boolean) => void }) {
  const [section, setSection] = useState<SettingsSectionId>('agents')
  const queryClient = useQueryClient()

  return (
    <>
      <button
        onClick={() =>
          void queryClient.refetchQueries({
            queryKey: serverQueryKey(fixtureScope, 'agent-settings'),
          })
        }
      >
        Read settings again
      </button>
      <button onClick={() => setSection('inventree')}>Leave Agents</button>
      <button onClick={() => setSection('agents')}>Return to Agents</button>
      <Settings
        section={section}
        returnTo={undefined}
        agents={api as unknown as ReturnType<typeof agentsClient>}
        onDirtyChange={dirty ?? vi.fn()}
      />
    </>
  )
}

/** Settings already cached from an earlier visit. */
function Primed({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  useState(() => queryClient.setQueryData(serverQueryKey(fixtureScope, 'agent-settings'), initial))
  return children
}

async function renderAgents(api = client(), dirty?: (value: boolean) => void, ready = 'Claude') {
  render(<Harness api={api} dirty={dirty} />)
  if (ready === 'Claude') {
    await screen.findByRole('group', { name: 'Claude' })
  } else {
    await screen.findByRole('textbox', { name: ready })
  }
  return api
}

/** A provider card's status pill describes the card. */
function expectCard(provider: 'Claude' | 'Codex', status: string) {
  expect(screen.getByRole('group', { name: provider })).toHaveAccessibleDescription(status)
}

let send: Mock<typeof fetch>

beforeEach(() => {
  readiness.set('available')
  send = vi.fn<typeof fetch>()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('fetch', send)
})

afterEach(() => {
  resetRunnerQueue()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('provider cards read their sign-in status from the agent VM', () => {
  test('on opening, each card shows its status with no key asked for and no Not checked', async () => {
    const api = await renderAgents()
    await waitFor(() => expectCard('Claude', 'Token saved'))
    expectCard('Codex', 'Not signed in')
    expect(screen.queryByText('Not checked')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/management key/)).not.toBeInTheDocument()
    expect(api.providerStatus).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  test('Checking… while the first read runs', async () => {
    const api = client()
    api.providerStatus.mockImplementation(() => new Promise<ProviderStatusDto>(() => {}))
    await renderAgents(api)
    expectCard('Claude', 'Checking…')
    expectCard('Codex', 'Checking…')
  })

  test('an unreachable VM reads as unknown with its reason, never as signed out', async () => {
    const api = client()
    api.providerStatus.mockResolvedValue(
      providerStatus({
        claude: { state: 'unknown', reason: 'vm_unreachable', last_sign_in_failure: null },
        codex: { state: 'unknown', reason: 'vm_unreachable', last_sign_in_failure: null },
      }),
    )
    await renderAgents(api)
    await waitFor(() => expectCard('Claude', 'Can’t reach the agent VM'))
    expectCard('Codex', 'Can’t reach the agent VM')
    expect(screen.queryByText('No token')).not.toBeInTheDocument()
    expect(screen.queryByText('Not signed in')).not.toBeInTheDocument()
  })

  test('each provider’s status stands alone: one busy, the other known', async () => {
    const api = client()
    api.providerStatus.mockResolvedValue(
      providerStatus({ codex: { state: 'unknown', reason: 'busy', last_sign_in_failure: null } }),
    )
    await renderAgents(api)
    await waitFor(() => expectCard('Codex', 'Agent VM busy'))
    expectCard('Claude', 'Token saved')
  })

  test.each([
    ['guest_outdated', 'Agent VM needs an update'],
    ['timeout', 'Status timed out'],
  ] as const)('%s reads as %s', async (reason, word) => {
    const api = client()
    api.providerStatus.mockResolvedValue(
      providerStatus({ codex: { state: 'unknown', reason, last_sign_in_failure: null } }),
    )
    await renderAgents(api)
    await waitFor(() => expectCard('Codex', word))
  })

  test('a status still being read in the VM reads as Checking…, not as a failure', async () => {
    const api = client()
    const checking = { state: 'unknown', reason: 'checking', last_sign_in_failure: null }
    api.providerStatus.mockResolvedValue(
      providerStatus({ codex: checking as unknown as ProviderStatusDto['codex'] }),
    )
    await renderAgents(api)
    await waitFor(() => expectCard('Claude', 'Token saved'))
    expectCard('Codex', 'Checking…')
  })

  test('Check again reads the status again, showing Checking… until it lands', async () => {
    const api = client()
    await renderAgents(api)
    await waitFor(() => expectCard('Codex', 'Not signed in'))

    let answer: (value: ProviderStatusDto) => void = () => undefined

    api.providerStatus.mockImplementationOnce(
      () => new Promise<ProviderStatusDto>((resolve) => (answer = resolve)),
    )
    const codex = within(screen.getByRole('group', { name: 'Codex' }))
    fireEvent.click(codex.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expectCard('Codex', 'Checking…'))
    await act(async () =>
      answer(providerStatus({ codex: { state: 'signing_in', last_sign_in_failure: null } })),
    )
    expectCard('Codex', 'Signing in')
    expect(api.providerStatus).toHaveBeenCalledTimes(2)
  })

  test('a failed status read shows the status as unavailable, never signed out', async () => {
    const api = client()
    api.providerStatus.mockRejectedValue(new IntakeRequestError(503, 'unavailable'))
    await renderAgents(api)
    await waitFor(() => expectCard('Claude', 'Status unavailable'))
    expectCard('Codex', 'Status unavailable')
  })

  test('the last session’s sign-in failure shows on its own line, apart from the pill', async () => {
    const api = client()
    api.providerStatus.mockResolvedValue(
      providerStatus({
        claude: {
          state: 'saved',
          saved_at: null,
          last_sign_in_failure: {
            attempt_id: '70000000-0000-4000-8000-000000000007',
            failure_id: '71000000-0000-4000-8000-000000000007',
            failed_at: '2026-11-24T04:00:00.000Z',
          },
        },
      }),
    )
    await renderAgents(api)
    const claude = within(screen.getByRole('group', { name: 'Claude' }))
    expect(await claude.findByText(/Last session couldn’t sign in/)).toBeVisible()
    expectCard('Claude', 'Token saved')
    expect(
      within(screen.getByRole('group', { name: 'Codex' })).queryByText(/couldn’t sign in/),
    ).not.toBeInTheDocument()
  })
})

describe('sign-in dialogs update the card', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  async function enterKey(label: string, value = 'operator') {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
    await act(() => vi.advanceTimersByTimeAsync(KEY_PAUSE_MS))
  }

  test('removing the token in its dialog shows No token once the VM confirms, then follows the VM', async () => {
    const api = client()
    await renderAgents(api)
    await waitFor(() => expectCard('Claude', 'Token saved'))
    send
      .mockResolvedValueOnce(Response.json({ configured: true, revision: 'one' }))
      .mockResolvedValueOnce(Response.json({ configured: false, revision: 'two' }))
    fireEvent.click(screen.getByRole('button', { name: 'Subscription token…' }))
    await enterKey('Personal runner management key')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove token' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expectCard('Claude', 'No token')
    // A read within the server's reuse window may predate the change, so it doesn't replace it.
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Claude' })).getByRole('button', {
        name: 'Check again',
      }),
    )
    await act(() => vi.advanceTimersByTimeAsync(10))
    expectCard('Claude', 'No token')
    api.providerStatus.mockResolvedValue(
      providerStatus({ claude: { state: 'not_saved', last_sign_in_failure: null } }),
    )
    await act(() => vi.advanceTimersByTimeAsync(SETTLE_MS))
    await waitFor(() => expect(api.providerStatus).toHaveBeenCalledTimes(3))
    expectCard('Claude', 'No token')
  })

  test('a read asked for before the change settled never replaces what the VM confirmed', async () => {
    const api = client()
    const cache = createServerQueryClient()
    render(<Harness api={api} />, { cache })
    await waitFor(() => expectCard('Claude', 'Token saved'))
    send
      .mockResolvedValueOnce(Response.json({ configured: true, revision: 'one' }))
      .mockResolvedValueOnce(Response.json({ configured: false, revision: 'two' }))
    fireEvent.click(screen.getByRole('button', { name: 'Subscription token…' }))
    await enterKey('Personal runner management key')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove token' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const removedAt = Date.now()
    api.providerStatus.mockResolvedValue(
      providerStatus({ claude: { state: 'not_saved', last_sign_in_failure: null } }),
    )
    await act(() => vi.advanceTimersByTimeAsync(SETTLE_MS + 1000))
    expectCard('Claude', 'No token')
    // A slow read asked for just after the change answers last, with the VM as it was before.
    act(() => {
      cache.setQueryData(serverQueryKey(fixtureScope, 'provider-status'), {
        status: providerStatus(),
        requestedAt: removedAt + 1000,
      })
    })
    await act(() => vi.advanceTimersByTimeAsync(10))
    expectCard('Claude', 'No token')
  })

  test('leaving and returning within the window keeps the confirmed change and reads again after it', async () => {
    const api = client()
    await renderAgents(api)
    await waitFor(() => expectCard('Claude', 'Token saved'))
    send
      .mockResolvedValueOnce(Response.json({ configured: true, revision: 'one' }))
      .mockResolvedValueOnce(Response.json({ configured: false, revision: 'two' }))
    fireEvent.click(screen.getByRole('button', { name: 'Subscription token…' }))
    await enterKey('Personal runner management key')
    fireEvent.click(await screen.findByRole('button', { name: 'Remove token' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Leave Agents' }))
    fireEvent.click(screen.getByRole('button', { name: 'Return to Agents' }))
    await screen.findByRole('group', { name: 'Claude' })
    // The VM's reused read still says a token is saved; the card keeps what it confirmed.
    await act(() => vi.advanceTimersByTimeAsync(10))
    expectCard('Claude', 'No token')
    api.providerStatus.mockResolvedValue(
      providerStatus({ claude: { state: 'not_saved', last_sign_in_failure: null } }),
    )
    const before = api.providerStatus.mock.calls.length
    await act(() => vi.advanceTimersByTimeAsync(SETTLE_MS))
    await waitFor(() => expect(api.providerStatus.mock.calls.length).toBeGreaterThan(before))
    expectCard('Claude', 'No token')
  })

  test('a first read still running when the window ends is replaced by a new read', async () => {
    const api = client()

    let answer: (value: ProviderStatusDto) => void = () => undefined

    api.providerStatus.mockImplementationOnce(
      () => new Promise<ProviderStatusDto>((resolve) => (answer = resolve)),
    )
    await renderAgents(api)
    expectCard('Codex', 'Checking…')
    send
      .mockResolvedValueOnce(Response.json({ state: 'disconnected' }))
      .mockResolvedValueOnce(Response.json({ state: 'disconnected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
    await enterKey('Codex runner management key', 'key')
    // A start is a sign-in change, so the card waits for a read asked for after it.
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with ChatGPT' }))
    await act(() => vi.advanceTimersByTimeAsync(10))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    api.providerStatus.mockResolvedValue(
      providerStatus({ codex: { state: 'signing_in', last_sign_in_failure: null } }),
    )
    await act(() => vi.advanceTimersByTimeAsync(SETTLE_MS))
    await waitFor(() => expect(api.providerStatus).toHaveBeenCalledTimes(2))
    await act(async () => answer(providerStatus()))
    await waitFor(() => expectCard('Codex', 'Signing in'))
  })

  test('the Codex dialog closes once the VM confirms the account, and the card says Signed in', async () => {
    await renderAgents()
    await waitFor(() => expectCard('Codex', 'Not signed in'))
    send
      .mockResolvedValueOnce(Response.json({ state: 'disconnected' }))
      .mockResolvedValueOnce(
        Response.json({
          state: 'pending',
          loginId: 'device-1',
          userCode: 'TEST-CODE',
          verificationUrl: 'https://auth.openai.com/codex/device',
        }),
      )
      .mockResolvedValueOnce(Response.json({ state: 'connected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
    await enterKey('Codex runner management key', 'key')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with ChatGPT' }))
    expect(await screen.findByText('TEST-CODE')).toBeVisible()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expectCard('Codex', 'Signed in')
  })

  test('closing the Codex dialog mid-sign-in has the card read the VM again, not the dialog', async () => {
    const api = client()
    await renderAgents(api)
    await waitFor(() => expectCard('Codex', 'Not signed in'))
    send
      .mockResolvedValueOnce(Response.json({ state: 'disconnected' }))
      .mockResolvedValueOnce(
        Response.json({
          state: 'pending',
          loginId: 'device-1',
          userCode: 'TEST-CODE',
          verificationUrl: 'https://auth.openai.com/codex/device',
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          state: 'pending',
          loginId: 'device-1',
          userCode: 'TEST-CODE',
          verificationUrl: 'https://auth.openai.com/codex/device',
        }),
      )
      .mockResolvedValueOnce(Response.json({ state: 'disconnected' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
    await enterKey('Codex runner management key', 'key')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with ChatGPT' }))
    expect(await screen.findByText('TEST-CODE')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expectCard('Codex', 'Checking…')
    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(send.mock.calls.map(([, request]) => JSON.parse(String(request?.body)))).toEqual([
      { action: 'status' },
      { action: 'start' },
      { action: 'status', loginId: 'device-1' },
      { action: 'cancel', loginId: 'device-1' },
    ])
    api.providerStatus.mockResolvedValue(providerStatus())
    await act(() => vi.advanceTimersByTimeAsync(SETTLE_MS))
    await waitFor(() => expectCard('Codex', 'Not signed in'))
  })

  test('leaving the section while signing in finishes the sign-in once, and coming back polls nothing', async () => {
    send.mockResolvedValueOnce(Response.json({ state: 'disconnected' }))
    send.mockImplementation(async () =>
      Response.json({
        state: 'pending',
        loginId: 'device-1',
        userCode: 'TEST-CODE',
        verificationUrl: 'https://auth.openai.com/codex/device',
      }),
    )
    await renderAgents()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
    await enterKey('Codex runner management key', 'key')
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in with ChatGPT' }))
    expect(await screen.findByText('TEST-CODE')).toBeVisible()
    // The page behind the dialog is inert; navigation still leaves the section.
    fireEvent.click(screen.getByText('Leave Agents'))
    await act(() => vi.advanceTimersByTimeAsync(9000))
    fireEvent.click(screen.getByRole('button', { name: 'Return to Agents' }))
    await screen.findByRole('group', { name: 'Claude' })
    await act(() => vi.advanceTimersByTimeAsync(9000))
    const actions = send.mock.calls.map(([, request]) => JSON.parse(String(request?.body)).action)
    expect(actions).toEqual(['status', 'start', 'status', 'cancel'])
    for (const [, request] of send.mock.calls) {
      expect(new Headers(request?.headers).get('authorization')).toBe('Bearer key')
    }
  })

  test('after leaving and returning, a Codex command waits for the runner call still running', async () => {
    let answer: (value: Response) => void = () => undefined

    send
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
      .mockResolvedValueOnce(Response.json({ state: 'disconnected' }))
    await renderAgents()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
    await enterKey('Codex runner management key', 'key')
    expect(send).toHaveBeenCalledTimes(1)
    // The page behind the dialog is inert; navigation still leaves the section.
    fireEvent.click(screen.getByText('Leave Agents'))
    fireEvent.click(screen.getByRole('button', { name: 'Return to Agents' }))
    await screen.findByRole('group', { name: 'Claude' })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
    await enterKey('Codex runner management key', 'key')
    expect(send).toHaveBeenCalledTimes(1)
    await act(async () => answer(Response.json({ state: 'disconnected' })))
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    await screen.findByRole('button', { name: 'Sign in with ChatGPT' })
  })

  test('a Codex runner call outlasting the guest limits fails and frees the queue', async () => {
    send.mockImplementationOnce(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    send.mockResolvedValueOnce(Response.json({ state: 'disconnected' }))
    await renderAgents()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in to ChatGPT…' }))
    await enterKey('Codex runner management key', 'key')
    expect(send).toHaveBeenCalledTimes(1)
    // Still waiting well past one guest RPC limit, then failing once the full bound has passed.
    await act(() => vi.advanceTimersByTimeAsync(85_000))
    expect(screen.queryByRole('alert')).toBeNull()
    await act(() => vi.advanceTimersByTimeAsync(5_000))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm sign-in status')
    await enterKey('Codex runner management key', 'key again')
    await screen.findByRole('button', { name: 'Sign in with ChatGPT' })
    expect(send).toHaveBeenCalledTimes(2)
  })
})

/** A subsection's card, inside its region of the same name, to scope its own Save. */
const card = (name: string) => screen.getAllByRole('region', { name }).at(-1)!

/** Picks an option in a model picker, by searching for it first. */
function pick(picker: HTMLElement, option: string, search = option.split(' · ').at(-1)!) {
  fireEvent.change(picker, { target: { value: search } })
  fireEvent.click(screen.getByRole('option', { name: option }))
}

/** Waits past the autosave pause, for a save sent on its own. */
const autosaved = (assertion: () => void) => waitFor(assertion, { timeout: 3000 })

const bothOn = agentSettings(
  '7',
  { provider: 'claude', authentication: 'subscription', model: 'sonnet' },
  {
    providers: {
      claude: { enabled: true, authentication: 'subscription', default_model: 'sonnet' },
      codex: { enabled: true, authentication: 'api_key', default_model: 'gpt-6.1-sol' },
    },
    stage_selections: { research: { provider: 'codex', model: 'gpt-6-luna' } },
  },
)

test('each provider card saves its switch, sign-in and default model as they change, with the steps', async () => {
  const api = await renderAgents()
  const codex = screen.getByRole('group', { name: 'Codex' })
  fireEvent.click(within(codex).getByRole('switch', { name: 'On' }))
  fireEvent.click(within(codex).getByRole('button', { name: 'API key' }))
  expect(within(codex).getByText('OPENAI_API_KEY')).toBeVisible()
  expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
  pick(screen.getByRole('combobox', { name: 'Research' }), 'Codex · gpt-6.1-sol')
  await autosaved(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      agentSettingsUpdate(
        '7',
        { provider: 'claude', authentication: 'subscription', model: 'sonnet' },
        {
          providers: {
            claude: { enabled: true, authentication: 'subscription', default_model: 'sonnet' },
            codex: { enabled: true, authentication: 'api_key', default_model: 'gpt-6.1-sol' },
          },
          stage_selections: { research: { provider: 'codex', model: 'gpt-6.1-sol' } },
        },
      ),
    ),
  )
  expect(api.saveSettings).toHaveBeenCalledTimes(1)
  pick(within(codex).getByRole('combobox', { name: 'Default model' }), 'gpt-6-luna')
  await autosaved(() =>
    expect(api.saveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expected_revision: '8',
        providers: {
          claude: { enabled: true, authentication: 'subscription', default_model: 'sonnet' },
          codex: { enabled: true, authentication: 'api_key', default_model: 'gpt-6-luna' },
        },
      }),
    ),
  )
})

test('searching a step’s picker and picking Sonnet sets the step to Claude with it, and saves', async () => {
  const api = client()
  api.settings.mockResolvedValue(bothOn)
  await renderAgents(api)
  pick(screen.getByRole('combobox', { name: 'Research' }), 'Claude · sonnet', 'son')
  await autosaved(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        stage_selections: { research: { provider: 'claude', model: 'sonnet' } },
      }),
    ),
  )
})

test('a provider turned on with a default model picked in the same pause saves both', async () => {
  const api = client()
  api.settings.mockResolvedValue(
    agentSettings('7', initialSelection, {
      providers: {
        claude: { enabled: true, authentication: 'subscription', default_model: 'sonnet' },
        codex: { enabled: false, authentication: 'subscription', default_model: '' },
      },
    }),
  )
  await renderAgents(api)
  const codex = within(screen.getByRole('group', { name: 'Codex' }))
  pick(codex.getByRole('combobox', { name: 'Default model' }), 'gpt-6-astra')
  fireEvent.click(codex.getByRole('switch', { name: 'On' }))
  expect(codex.getByRole('switch', { name: 'On' })).toBeChecked()
  await autosaved(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({
          codex: { enabled: true, authentication: 'subscription', default_model: 'gpt-6-astra' },
        }),
      }),
    ),
  )
  expect(api.saveSettings).toHaveBeenCalledTimes(1)
})

test('on/off settings are switches and the default provider is a two-option segmented control', async () => {
  await renderAgents()
  expect(screen.getAllByRole('switch', { name: 'On' })).toHaveLength(2)
  expect(screen.getByRole('switch', { name: 'Suggest tags for new batches' })).toBeVisible()
  expect(screen.getByRole('switch', { name: 'Allow public web pages' })).toBeVisible()
  expect(screen.getByRole('switch', { name: 'Parts · up to 250' })).toBeVisible()
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  const defaultProvider = within(screen.getAllByRole('group', { name: 'Default provider' }).at(-1)!)
  expect(defaultProvider.getAllByRole('button').map((option) => option.textContent)).toEqual([
    'Claude',
    'Codex',
  ])
})

test('turning a provider off shows its steps on Default with a note, and saves at once', async () => {
  const api = client()
  api.settings.mockResolvedValue(bothOn)
  await renderAgents(api)
  const research = within(screen.getByRole('group', { name: 'Research' }))
  expect(research.getByText('Codex · gpt-6-luna')).toBeVisible()
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Codex' })).getByRole('switch', { name: 'On' }),
  )
  expect(research.getByText('Default · Claude sonnet')).toBeVisible()
  expect(research.getByText(/now uses Default/)).toBeVisible()
  expect(
    within(screen.getAllByRole('group', { name: 'Default provider' }).at(-1)!).getByRole('button', {
      name: 'Codex',
    }),
  ).toHaveAttribute('aria-disabled', 'true')
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: { ...bothOn.providers, codex: { ...bothOn.providers.codex, enabled: false } },
        stage_selections: {},
      }),
    ),
  )
})

test('on a fresh setup, Instructions save with no provider on', async () => {
  const api = client()
  api.settings.mockResolvedValue(agentSettings('0', null))
  await renderAgents(api, undefined, 'Instructions for every new batch')
  fireEvent.change(screen.getByRole('textbox', { name: 'Instructions for every new batch' }), {
    target: { value: 'Count reels by their labels.' },
  })
  fireEvent.click(within(card('Instructions')).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      agentSettingsUpdate('0', null, { new_batch_instructions: 'Count reels by their labels.' }),
    ),
  )
})

test('a save sends the loaded values for other subsections, and keeps their unsaved edits', async () => {
  const api = await renderAgents()
  const instructions = screen.getByRole('textbox', { name: 'Instructions for every new batch' })
  fireEvent.change(instructions, { target: { value: 'Draft, not saved yet' } })
  fireEvent.click(
    within(screen.getAllByRole('group', { name: 'Sessions at once' }).at(-1)!).getByRole('button', {
      name: 'One fewer',
    }),
  )
  await autosaved(() =>
    expect(api.saveSettings).toHaveBeenLastCalledWith(
      agentSettingsUpdate('7', initialSelection, { session_concurrency: 2 }),
    ),
  )
  expect(instructions).toHaveValue('Draft, not saved yet')
  fireEvent.click(within(card('Instructions')).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenLastCalledWith(
      agentSettingsUpdate('8', initialSelection, {
        session_concurrency: 2,
        new_batch_instructions: 'Draft, not saved yet',
      }),
    ),
  )
})

test('a description style over 500 characters shows the limit and sends nothing', async () => {
  const api = await renderAgents()
  const style = screen.getByRole('textbox', { name: 'Part description style' })
  fireEvent.change(style, { target: { value: 'x'.repeat(501) } })
  expect(screen.getByText(/501 of 500 characters: shorten it to save/)).toBeVisible()
  fireEvent.click(within(card('Descriptions and naming')).getByRole('button', { name: 'Save' }))
  await new Promise((done) => setTimeout(done, 20))
  expect(api.saveSettings).not.toHaveBeenCalled()
  expect(style).toHaveValue('x'.repeat(501))
})

test('picking a model holds the navigation guard until its save confirms', async () => {
  const dirty = vi.fn()
  await renderAgents(client(), dirty)
  pick(
    within(screen.getByRole('group', { name: 'Claude' })).getByRole('combobox', {
      name: 'Default model',
    }),
    'opus',
  )
  expect(dirty).toHaveBeenLastCalledWith(true, expect.any(Function))
  await autosaved(() => expect(dirty).toHaveBeenLastCalledWith(false, undefined))
})

test('pressing Save twice sends one save', async () => {
  const api = await renderAgents()
  fireEvent.change(screen.getByRole('textbox', { name: 'Instructions for every new batch' }), {
    target: { value: 'Mine' },
  })
  const save = within(card('Instructions')).getByRole('button', { name: 'Save' })
  fireEvent.click(save)
  fireEvent.click(save)
  await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(1))
  await new Promise((done) => setTimeout(done, 20))
  expect(api.saveSettings).toHaveBeenCalledTimes(1)
})

test('an edit made over instructions changed elsewhere is a conflict and sends nothing', async () => {
  const api = client()
  api.settings
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce({ ...initial, revision: '9', new_batch_instructions: 'Theirs' })
  await renderAgents(api)
  const instructions = screen.getByRole('textbox', { name: 'Instructions for every new batch' })
  fireEvent.change(instructions, { target: { value: 'Mine' } })
  fireEvent.click(screen.getByRole('button', { name: 'Read settings again' }))
  await waitFor(() => expect(api.settings).toHaveBeenCalledTimes(2))
  fireEvent.click(within(card('Instructions')).getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(/changed in another tab/)).toBeVisible()
  expect(api.saveSettings).not.toHaveBeenCalled()
  expect(instructions).toHaveValue('Mine')
})

test('a Reload that fails keeps the conflict, the edit and the Reload action', async () => {
  const api = client()
  api.saveSettings.mockRejectedValue(new IntakeRequestError(409, 'revision_conflict'))
  api.settings.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('offline'))
  await renderAgents(api)
  const instructions = screen.getByRole('textbox', { name: 'Instructions for every new batch' })
  fireEvent.change(instructions, { target: { value: 'Mine' } })
  fireEvent.click(within(card('Instructions')).getByRole('button', { name: 'Save' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reload' }))
  expect(await screen.findByText(/couldn’t be loaded/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible()
  expect(instructions).toHaveValue('Mine')
})

test('a refresh never mixes into a Providers draft, and saving it is a conflict', async () => {
  const api = client()
  api.settings.mockResolvedValueOnce(bothOn).mockResolvedValueOnce({
    ...bothOn,
    revision: '9',
    providers: {
      ...bothOn.providers,
      claude: { ...bothOn.providers.claude, enabled: false },
    },
    default_provider: 'codex',
    stage_selections: {},
  })
  api.saveSettings.mockRejectedValue(new IntakeRequestError(412, 'revision_conflict'))
  await renderAgents(api)
  const claude = within(screen.getByRole('group', { name: 'Claude' }))
  const codex = within(screen.getByRole('group', { name: 'Codex' }))
  pick(codex.getByRole('combobox', { name: 'Default model' }), 'gpt-6-luna')
  fireEvent.click(screen.getByRole('button', { name: 'Read settings again' }))
  await waitFor(() => expect(api.settings).toHaveBeenCalledTimes(2))
  await new Promise((done) => setTimeout(done, 20))
  expect(claude.getByRole('switch', { name: 'On' })).toBeChecked()
  expect(
    (await screen.findAllByText(/changed in another tab/, {}, { timeout: 3000 }))[0],
  ).toBeVisible()
  // Sent under the revision the edit was made over, so the server refuses it.
  expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ expected_revision: '7' }))
})

test('a Reload answering late settles to the newest settings, not its own older answer', async () => {
  const api = client()

  let answer: (value: AgentSettingsDto) => void = () => undefined

  api.saveSettings.mockRejectedValueOnce(new IntakeRequestError(412, 'revision_conflict'))
  api.settings
    .mockResolvedValueOnce(initial)
    .mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)))
    .mockResolvedValueOnce({
      ...initial,
      revision: '9',
      session_concurrency: 2,
      new_batch_instructions: 'Newest',
    })
  await renderAgents(api)
  expect(await screen.findByText('3 of 3 in use · 1 queued')).toBeVisible()
  const instructions = screen.getByRole('textbox', { name: 'Instructions for every new batch' })
  fireEvent.change(instructions, { target: { value: 'Mine' } })
  fireEvent.click(within(card('Instructions')).getByRole('button', { name: 'Save' }))
  // Revision 7 answers the Reload late; a refresh loads 9 from elsewhere meanwhile.
  fireEvent.click(await screen.findByRole('button', { name: 'Reload' }))
  await waitFor(() => expect(api.settings).toHaveBeenCalledTimes(2))
  fireEvent.click(screen.getByRole('button', { name: 'Read settings again' }))
  await waitFor(() => expect(api.settings).toHaveBeenCalledTimes(3))
  await act(async () => {
    answer(initial)
    await new Promise((done) => setTimeout(done, 20))
  })
  expect(instructions).toHaveValue('Newest')
  expect(screen.getByText('3 of 2 in use · 1 queued')).toBeVisible()
})

test('after a failed read the forms stay closed over cached settings until a read succeeds', async () => {
  const api = client()
  api.settings.mockRejectedValueOnce(new Error('offline'))
  render(
    <Primed>
      <Harness api={api} />
    </Primed>,
  )
  expect(await screen.findByText(/Settings unavailable/)).toBeVisible()
  // The cached settings show read-only: nothing in them can be focused or edited.
  expect(
    screen.getByRole('textbox', { name: 'Instructions for every new batch' }).closest('[inert]'),
  ).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() =>
    expect(
      screen.getByRole('textbox', { name: 'Instructions for every new batch' }).closest('[inert]'),
    ).toBeNull(),
  )
})

test('a first visit shows each subsection’s skeleton, not a loading line, until the settings land', async () => {
  const api = client()
  const read = deferred<AgentSettingsDto>()
  api.settings.mockReturnValueOnce(read.promise)
  render(<Harness api={api} />)

  expect(screen.queryByText(/Loading saved settings|Waiting for the saved settings/)).toBeNull()
  expect(screen.getByRole('status')).toHaveTextContent('Loading')
  expect(screen.queryByRole('textbox', { name: 'Instructions for every new batch' })).toBeNull()

  await act(async () => {
    read.resolve(initial)
    await read.promise
  })
  expect(
    await screen.findByRole('textbox', { name: 'Instructions for every new batch' }),
  ).toBeVisible()
})

test('a return visit shows the cached settings read-only at once, and editable once read', async () => {
  const api = client()
  const read = deferred<AgentSettingsDto>()
  api.settings.mockReturnValueOnce(read.promise)
  render(
    <Primed>
      <Harness api={api} />
    </Primed>,
  )
  const cached = screen.getByRole('textbox', { name: 'Instructions for every new batch' })
  expect(cached.closest('[inert]')).not.toBeNull()
  expect(screen.getByText('Showing saved data while it updates')).toBeInTheDocument()

  await act(async () => {
    read.resolve(initial)
    await read.promise
  })
  await waitFor(() =>
    expect(
      screen.getByRole('textbox', { name: 'Instructions for every new batch' }).closest('[inert]'),
    ).toBeNull(),
  )
})

test('an edit made before a change from elsewhere is refused, keeping the edit and Reload', async () => {
  const api = client()
  api.settings
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce({ ...initial, revision: '9', auto_tags_default: true })
  api.saveSettings.mockRejectedValue(new IntakeRequestError(412, 'revision_conflict'))
  await renderAgents(api)
  const instructions = screen.getByRole('textbox', { name: 'Instructions for every new batch' })
  fireEvent.change(instructions, { target: { value: 'Mine' } })
  fireEvent.click(screen.getByRole('button', { name: 'Read settings again' }))
  // The other tab's change has reached the page before Save.
  await waitFor(() =>
    expect(screen.getByRole('switch', { name: 'Suggest tags for new batches' })).toBeChecked(),
  )
  fireEvent.click(within(card('Instructions')).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ expected_revision: '7', new_batch_instructions: 'Mine' }),
    ),
  )
  expect(await screen.findByText(/changed in another tab/)).toBeVisible()
  expect(instructions).toHaveValue('Mine')
  expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible()
})

test('changing a sign-in and back within the pause sends nothing and leaves nothing unsaved', async () => {
  const dirty = vi.fn()
  const api = await renderAgents(client(), dirty)
  const claude = within(screen.getByRole('group', { name: 'Claude' }))
  fireEvent.click(claude.getByRole('button', { name: 'API key' }))
  expect(dirty).toHaveBeenLastCalledWith(true, expect.any(Function))
  fireEvent.click(claude.getByRole('button', { name: 'Subscription' }))
  await autosaved(() => expect(dirty).toHaveBeenLastCalledWith(false, undefined))
  expect(api.saveSettings).not.toHaveBeenCalled()
})

test('a save answering after leaving Agents never releases the guard', async () => {
  const dirty = vi.fn()
  const api = client()

  let finish: (value: AgentSettingsDto) => void = () => undefined

  api.saveSettings.mockImplementation(
    () => new Promise<AgentSettingsDto>((resolve) => (finish = resolve)),
  )
  await renderAgents(api, dirty)
  fireEvent.change(screen.getByRole('textbox', { name: 'Instructions for every new batch' }), {
    target: { value: 'Mine' },
  })
  fireEvent.click(within(card('Instructions')).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(api.saveSettings).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'Leave Agents' }))
  dirty.mockClear()
  await act(async () => {
    finish({ ...initial, revision: '8', new_batch_instructions: 'Mine' })
    await new Promise((done) => setTimeout(done, 20))
  })
  expect(dirty).not.toHaveBeenCalledWith(false)
})

test('after an unconfirmed save, undoing the edit keeps the guard and Reload', async () => {
  const dirty = vi.fn()
  const api = client()
  api.saveSettings.mockRejectedValue(new Error('offline'))
  await renderAgents(api, dirty)
  const instructions = screen.getByRole('textbox', { name: 'Instructions for every new batch' })
  fireEvent.change(instructions, { target: { value: 'Mine' } })
  fireEvent.click(within(card('Instructions')).getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(/wasn’t confirmed/)).toBeVisible()
  fireEvent.change(instructions, { target: { value: '' } })
  expect(dirty).toHaveBeenLastCalledWith(true, expect.any(Function))
  expect(screen.getByRole('button', { name: 'Reload' })).toBeVisible()
})

test('Saved clears once the subsection is edited again', async () => {
  await renderAgents()
  const instructions = screen.getByRole('textbox', { name: 'Instructions for every new batch' })
  fireEvent.change(instructions, { target: { value: 'Mine' } })
  fireEvent.click(within(card('Instructions')).getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(/start with these instructions/)).toBeVisible()
  fireEvent.change(instructions, { target: { value: 'Mine, again' } })
  expect(screen.queryByText(/start with these instructions/)).toBeNull()
})

test('the Part description style saves its own text, and a conflict Reload restores the saved one', async () => {
  const api = client()
  api.saveSettings
    .mockResolvedValueOnce({ ...initial, revision: '8', part_description_style: 'Type, value' })
    .mockRejectedValueOnce(new IntakeRequestError(412, 'revision_conflict'))
  api.settings.mockResolvedValueOnce(initial).mockResolvedValueOnce({
    ...initial,
    revision: '9',
    part_description_style: 'Theirs',
  })
  await renderAgents(api)
  const style = screen.getByRole('textbox', { name: 'Part description style' })
  fireEvent.change(style, { target: { value: 'Type, value' } })

  const save = () =>
    fireEvent.click(within(card('Descriptions and naming')).getByRole('button', { name: 'Save' }))

  save()
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenLastCalledWith(
      agentSettingsUpdate('7', initialSelection, { part_description_style: 'Type, value' }),
    ),
  )
  fireEvent.change(style, { target: { value: 'Mine' } })
  save()
  expect(await screen.findByText(/changed in another tab/)).toBeVisible()
  expect(style).toHaveValue('Mine')
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
  await waitFor(() => expect(style).toHaveValue('Theirs'))
})

test('when Reload keeps failing, Discard drops the edit and releases the guard', async () => {
  const dirty = vi.fn()
  const api = client()
  api.saveSettings.mockRejectedValue(new Error('offline'))
  api.settings.mockResolvedValueOnce(initial).mockRejectedValue(new Error('offline'))
  await renderAgents(api, dirty)
  const instructions = screen.getByRole('textbox', { name: 'Instructions for every new batch' })
  fireEvent.change(instructions, { target: { value: 'Mine' } })
  fireEvent.click(within(card('Instructions')).getByRole('button', { name: 'Save' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reload' }))
  expect(await screen.findByText(/couldn’t be loaded/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Discard my edit' }))
  expect(instructions).toHaveValue('')
  expect(dirty).toHaveBeenLastCalledWith(false, undefined)
  expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull()
})

test('a text Save waits for a running autosave, then saves on its revision', async () => {
  const api = client()

  let finish: (value: AgentSettingsDto) => void = () => undefined

  api.saveSettings
    .mockImplementationOnce(() => new Promise<AgentSettingsDto>((resolve) => (finish = resolve)))
    .mockImplementationOnce(async (input) => {
      const { expected_revision: _, save_id: _saveId, ...fields } = input
      return { ...fields, revision: '9' }
    })
  await renderAgents(api)
  fireEvent.click(
    within(screen.getAllByRole('group', { name: 'Sessions at once' }).at(-1)!).getByRole('button', {
      name: 'One fewer',
    }),
  )
  await autosaved(() => expect(api.saveSettings).toHaveBeenCalledTimes(1))
  const instructions = screen.getByRole('textbox', { name: 'Instructions for every new batch' })
  fireEvent.change(instructions, { target: { value: 'Mine' } })
  const save = within(card('Instructions')).getByRole('button', { name: 'Save' })
  expect(save).toHaveAttribute('aria-disabled', 'true')
  // The draft can still be discarded while it waits.
  expect(
    within(card('Instructions')).getByRole('button', { name: 'Discard my edit' }),
  ).not.toHaveAttribute('aria-disabled')
  fireEvent.click(save)
  expect(api.saveSettings).toHaveBeenCalledTimes(1)
  await act(async () => finish({ ...initial, revision: '8', session_concurrency: 2 }))
  fireEvent.click(within(card('Instructions')).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenLastCalledWith(
      agentSettingsUpdate('8', initialSelection, {
        session_concurrency: 2,
        new_batch_instructions: 'Mine',
      }),
    ),
  )
})

test('Suggest tags for new batches saves on its own', async () => {
  const api = await renderAgents()
  fireEvent.click(screen.getByRole('switch', { name: 'Suggest tags for new batches' }))
  await autosaved(() =>
    expect(api.saveSettings).toHaveBeenCalledWith(
      agentSettingsUpdate('7', initialSelection, { auto_tags_default: true }),
    ),
  )
})

test('editing a segmented control or the stepper reports unsaved input until their saves confirm', async () => {
  const dirty = vi.fn()
  const api = await renderAgents(client(), dirty)
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Claude' })).getByRole('button', { name: 'API key' }),
  )
  expect(dirty).toHaveBeenLastCalledWith(true, expect.any(Function))
  fireEvent.click(
    within(screen.getAllByRole('group', { name: 'Sessions at once' }).at(-1)!).getByRole('button', {
      name: 'One more',
    }),
  )
  expect(dirty).toHaveBeenLastCalledWith(true, expect.any(Function))
  await autosaved(() => expect(api.saveSettings).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false, undefined))
})

test('the slot meter reads the agent sessions list and links to it', async () => {
  await renderAgents()

  expect(await screen.findByText('3 of 3 in use · 1 queued')).toBeVisible()
  expect(screen.getByRole('link', { name: 'See sessions' })).toHaveAttribute('href', '#agents')
})

test('Pause all agents uses the pause command the Agents page uses', async () => {
  const api = await renderAgents()
  fireEvent.click(await screen.findByRole('button', { name: 'Pause all agents' }))

  await waitFor(() => expect(api.pauseAll).toHaveBeenCalledWith(true))
  await waitFor(() => expect(api.sessions).toHaveBeenCalledTimes(2))
})

test('Pause all agents waits for a list read started after the last live hint, and is checked again when pressed', async () => {
  const api = client()
  const paused = await api.sessions()
  api.sessions.mockResolvedValue({ ...paused, paused_batch_ids: ['batch-a'] })
  const cache = createServerQueryClient()
  render(<Harness api={api} />, { cache })
  await screen.findByRole('group', { name: 'Claude' })
  const pause = await screen.findByRole('button', { name: 'Pause all agents' })
  const resume = screen.getByRole('button', { name: 'Resume all agents' })
  await waitFor(() => expect(pause).not.toHaveAttribute('aria-disabled'))
  const registry = freshReads(cache)
  const key = serverQueryKey(fixtureScope, 'agent-sessions', 'newest')

  // A hint arrives: during the reconciliation delay the settled read predates it.
  act(() => registry.noteHint())
  expect(pause).toHaveAttribute('aria-disabled', 'true')
  expect(pause).toHaveAccessibleDescription('Updating…')
  fireEvent.click(pause)
  expect(api.pauseAll).not.toHaveBeenCalled()

  // Reconciliation queued behind a read that started before the hint: that read is not enough.
  const before = deferred<AgentSessionListDto>()
  const list = await api.sessions()
  api.sessions.mockReturnValueOnce(before.promise)
  act(() => {
    void cache.refetchQueries({ queryKey: key })
  })
  act(() => registry.noteHint())
  await act(async () => {
    before.resolve(list)
    await before.promise
  })
  expect(pause).toHaveAttribute('aria-disabled', 'true')
  expect(resume).toHaveAttribute('aria-disabled', 'true')

  // The reconciliation's own read lands, and Pause all is available again.
  await act(async () => {
    await cache.invalidateQueries({ queryKey: key })
  })
  await waitFor(() => expect(pause).not.toHaveAttribute('aria-disabled'))

  // A hint between the last render and the press is caught when pressed.
  await act(async () => {
    registry.noteHint()
    pause.click()
    resume.click()
  })
  expect(api.pauseAll).not.toHaveBeenCalled()
  expect(screen.queryByText(/Pausing failed/)).not.toBeInTheDocument()
  expect(pause).toHaveAccessibleDescription('Updating…')

  await act(async () => {
    await cache.invalidateQueries({ queryKey: key })
  })
  await waitFor(() => expect(pause).not.toHaveAttribute('aria-disabled'))
  fireEvent.click(pause)
  await waitFor(() => expect(api.pauseAll).toHaveBeenCalledWith(true))
})

test('Resume all agents waits for a list read started after the last live hint', async () => {
  const api = client()
  const list = await api.sessions()
  api.sessions.mockResolvedValue({ ...list, paused_batch_ids: ['batch-a'] })
  const cache = createServerQueryClient()
  render(<Harness api={api} />, { cache })
  const resume = await screen.findByRole('button', { name: 'Resume all agents' })
  await waitFor(() => expect(resume).not.toHaveAttribute('aria-disabled'))

  act(() => freshReads(cache).noteHint())
  expect(resume).toHaveAccessibleDescription('Updating…')
  fireEvent.click(resume)
  expect(api.pauseAll).not.toHaveBeenCalled()

  await act(async () => {
    await cache.invalidateQueries({ queryKey: serverQueryKey(fixtureScope, 'agent-sessions') })
  })
  await waitFor(() => expect(resume).not.toHaveAttribute('aria-disabled'))
  fireEvent.click(resume)
  await waitFor(() => expect(api.pauseAll).toHaveBeenCalledWith(false))
})

test('a stale revision is refused as a conflict, keeps the edit and offers Reload', async () => {
  const api = client()
  api.saveSettings.mockRejectedValue(new IntakeRequestError(409, 'revision_conflict'))
  api.settings
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce({ ...initial, revision: '9', session_concurrency: 5 })
  await renderAgents(api)
  const instructions = screen.getByRole('textbox', { name: 'Instructions for every new batch' })
  fireEvent.change(instructions, { target: { value: 'Mine' } })
  fireEvent.click(within(card('Instructions')).getByRole('button', { name: 'Save' }))

  expect(await screen.findByText(/changed in another tab/)).toBeVisible()
  expect(instructions).toHaveValue('Mine')
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
  await waitFor(() => expect(instructions).toHaveValue(''))
  expect(await screen.findByText('3 of 5 in use · 1 queued')).toBeVisible()
})

test('after a save the slot meter compares slot use with the saved limit', async () => {
  await renderAgents()
  expect(await screen.findByText('3 of 3 in use · 1 queued')).toBeVisible()
  const sessions = screen.getAllByRole('group', { name: 'Sessions at once' }).at(-1)!
  fireEvent.click(within(sessions).getByRole('button', { name: 'One fewer' }))
  expect(screen.getByText('3 of 3 in use · 1 queued')).toBeVisible()

  expect(await screen.findByText('3 of 2 in use · 1 queued', {}, { timeout: 3000 })).toBeVisible()
  expect(within(sessions).getByRole('status')).toHaveTextContent('2')
})

test('a settings read that was already running cannot replace a confirmed save', async () => {
  const api = client()

  let answerStale: (value: AgentSettingsDto) => void = () => undefined

  api.settings
    .mockResolvedValueOnce(initial)
    .mockImplementationOnce(() => new Promise((resolve) => (answerStale = resolve)))
  await renderAgents(api)
  expect(await screen.findByText('3 of 3 in use · 1 queued')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Read settings again' }))
  await waitFor(() => expect(api.settings).toHaveBeenCalledTimes(2))

  const sessions = screen.getAllByRole('group', { name: 'Sessions at once' }).at(-1)!
  fireEvent.click(within(sessions).getByRole('button', { name: 'One fewer' }))
  expect(await screen.findByText('3 of 2 in use · 1 queued', {}, { timeout: 3000 })).toBeVisible()
  await act(async () => {
    answerStale(initial)
    await new Promise((done) => setTimeout(done, 20))
  })

  expect(screen.getByText('3 of 2 in use · 1 queued')).toBeVisible()
})

describe('Web research', () => {
  const publicPages = () => screen.getByRole('switch', { name: 'Allow public web pages' })

  const datasheets = () =>
    screen.getByRole('switch', { name: 'Prefer manufacturer datasheets over distributor pages' })

  test('both settings start on, explain provider search and save as they change', async () => {
    const api = await renderAgents()
    expect(publicPages()).toBeChecked()
    expect(datasheets()).toBeChecked()
    expect(screen.getByRole('group', { name: 'Web research' })).toHaveAccessibleDescription(
      /sessions in the VM.*Provider web search stays on either way/,
    )
    fireEvent.click(publicPages())
    await autosaved(() =>
      expect(api.saveSettings).toHaveBeenCalledWith(
        agentSettingsUpdate('7', initialSelection, {
          web: { public_pages: false, prefer_datasheets: true },
        }),
      ),
    )
  })

  for (const saved of [
    { public_pages: false, prefer_datasheets: true },
    { public_pages: true, prefer_datasheets: false },
  ]) {
    test(`a profile without web access shows the saved ${JSON.stringify(saved)}, disabled`, async () => {
      readiness.set('unavailable')
      const user = userEvent.setup()
      const api = client()
      api.settings.mockResolvedValue({ ...initial, web: saved })
      await renderAgents(api)
      for (const [box, checked] of [
        [publicPages(), saved.public_pages],
        [datasheets(), saved.prefer_datasheets],
      ] as const) {
        expect(box).toHaveAttribute('aria-disabled', 'true')
        expect(box).toHaveAccessibleDescription(/no web access/)
        expect((box as HTMLInputElement).checked).toBe(checked)
        await user.click(box)
        expect((box as HTMLInputElement).checked).toBe(checked)
      }
      expect(within(card('Web research')).queryByRole('button', { name: 'Save' })).toBeNull()
      // These settings work elsewhere, so they don't claim to be coming later.
      expect(within(card('Web research')).getByText('Not for this profile')).toBeVisible()
      expect(within(card('Web research')).queryByText('Coming later')).toBeNull()
      expect(api.saveSettings).not.toHaveBeenCalled()
    })
  }

  test('a change made before readiness says there is no web access saves, and the disabled settings show it', async () => {
    readiness.set(undefined)
    const dirty = vi.fn()
    const api = await renderAgents(client(), dirty)
    fireEvent.click(publicPages())
    await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true, expect.any(Function)))
    act(() => readiness.set('unavailable'))
    await autosaved(() => expect(api.saveSettings).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(publicPages()).not.toBeChecked())
    expect(publicPages()).toHaveAttribute('aria-disabled', 'true')
    expect(dirty).toHaveBeenLastCalledWith(false, undefined)
  })

  test('a save over settings changed elsewhere is a conflict that keeps the edit', async () => {
    const api = client()
    api.saveSettings.mockRejectedValue(new IntakeRequestError(412, 'revision_conflict'))
    api.settings.mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, revision: '9' })
    await renderAgents(api)
    fireEvent.click(datasheets())
    expect(
      (await screen.findAllByText(/changed in another tab/, {}, { timeout: 3000 }))[0],
    ).toBeVisible()
    expect(datasheets()).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: /Reload/ }))
    await waitFor(() => expect(datasheets()).toBeChecked())
  })
})
