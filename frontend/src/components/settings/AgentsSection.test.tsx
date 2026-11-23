import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type {
  AgentSessionListDto,
  AgentSettingsDto,
  AgentSettingsUpdateDto,
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

/** A provider card's status, as its credential panel shows it, describes the card. */
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

describe('the Claude card mirrors its credential panel', () => {
  function openClaude(key = 'operator') {
    fireEvent.click(screen.getByRole('button', { name: 'Personal Claude subscription' }))
    fireEvent.change(screen.getByLabelText('Personal runner management key'), {
      target: { value: key },
    })
  }

  test('Not checked, then Configured, then Unconfigured once the credential is removed', async () => {
    send
      .mockResolvedValueOnce(Response.json({ configured: true, revision: 'one' }))
      .mockResolvedValueOnce(Response.json({ configured: false, revision: 'two' }))
    await renderAgents()
    expectCard('Claude', 'Not checked')
    expectCard('Codex', 'Not checked')
    openClaude()
    fireEvent.click(screen.getByRole('button', { name: 'Check configuration' }))
    await waitFor(() => expectCard('Claude', 'Configured'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove token' }))
    await waitFor(() => expectCard('Claude', 'Unconfigured'))
  })

  test('a failed check reads Check failed, and a key edit keeps it while the panel shows its error', async () => {
    send.mockResolvedValueOnce(new Response(null, { status: 503 }))
    await renderAgents()
    openClaude()
    fireEvent.click(screen.getByRole('button', { name: 'Check configuration' }))
    await screen.findByRole('alert')
    expectCard('Claude', 'Check failed')
    fireEvent.change(screen.getByLabelText('Personal runner management key'), {
      target: { value: 'other' },
    })
    expect(screen.getByRole('alert')).toBeVisible()
    expectCard('Claude', 'Check failed')
  })

  test('a key edit after a result and a collapse each read Not checked', async () => {
    send
      .mockResolvedValueOnce(Response.json({ configured: true, revision: 'one' }))
      .mockResolvedValueOnce(Response.json({ configured: true, revision: 'one' }))
    await renderAgents()
    openClaude()
    fireEvent.click(screen.getByRole('button', { name: 'Check configuration' }))
    await waitFor(() => expectCard('Claude', 'Configured'))
    fireEvent.change(screen.getByLabelText('Personal runner management key'), {
      target: { value: 'other' },
    })
    expectCard('Claude', 'Not checked')
    fireEvent.click(screen.getByRole('button', { name: 'Check configuration' }))
    await waitFor(() => expectCard('Claude', 'Configured'))
    fireEvent.click(screen.getByRole('button', { name: 'Personal Claude subscription' }))
    expectCard('Claude', 'Not checked')
  })
})

describe('the Codex card mirrors its sign-in panel', () => {
  function challenge(loginId = 'device-1') {
    return Response.json({
      state: 'pending',
      loginId,
      userCode: 'TEST-CODE',
      verificationUrl: 'https://auth.openai.com/codex/device',
    })
  }

  async function startSignIn() {
    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT subscription' }))
    fireEvent.change(screen.getByLabelText('Codex runner management key'), {
      target: { value: 'key' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with ChatGPT' }))
    expect(await screen.findByText('TEST-CODE')).toBeTruthy()
  }

  test('Signing in, then Connected when the poll returns connected, then Not connected', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    send
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(Response.json({ state: 'connected' }))
      .mockResolvedValueOnce(Response.json({ state: 'disconnected' }))
    await renderAgents()
    await startSignIn()
    expectCard('Codex', 'Signing in')
    await act(() => vi.advanceTimersByTimeAsync(3000))
    await screen.findByText('Connected to ChatGPT')
    expectCard('Codex', 'Connected')
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect ChatGPT' }))
    await screen.findByRole('button', { name: 'Sign in with ChatGPT' })
    expectCard('Codex', 'Not connected')
  })

  test('a declined sign-in reads Declined and a failed request reads Check failed', async () => {
    send
      .mockResolvedValueOnce(Response.json({ state: 'denied' }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
    await renderAgents()
    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT subscription' }))
    fireEvent.change(screen.getByLabelText('Codex runner management key'), {
      target: { value: 'key' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Check ChatGPT connection' }))
    await screen.findByText('Sign-in was declined or expired.')
    expectCard('Codex', 'Declined')
    fireEvent.click(screen.getByRole('button', { name: 'Check ChatGPT connection' }))
    await screen.findByRole('alert')
    expectCard('Codex', 'Check failed')
  })

  test('collapsing the panel reads Not checked', async () => {
    send.mockResolvedValueOnce(challenge())
    await renderAgents()
    await startSignIn()
    fireEvent.click(screen.getByRole('button', { name: 'ChatGPT subscription' }))
    expectCard('Codex', 'Not checked')
  })

  test('a key edit while signing in reads Not checked, and a late poll for the old sign-in changes nothing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    let answer: (value: Response) => void = () => undefined

    send
      .mockResolvedValueOnce(challenge())
      .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
    await renderAgents()
    await startSignIn()
    await act(() => vi.advanceTimersByTimeAsync(3000))
    expect(send).toHaveBeenCalledTimes(2)
    fireEvent.change(screen.getByLabelText('Codex runner management key'), {
      target: { value: 'other key' },
    })
    expectCard('Codex', 'Not checked')
    await act(async () => answer(Response.json({ state: 'connected' })))
    expectCard('Codex', 'Not checked')
  })

  test('leaving the section while signing in stops the poll, and coming back sends no poll with an empty key', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    send.mockResolvedValue(challenge())
    await renderAgents()
    await startSignIn()
    fireEvent.click(screen.getByRole('button', { name: 'Leave Agents' }))
    await act(() => vi.advanceTimersByTimeAsync(9000))
    fireEvent.click(screen.getByRole('button', { name: 'Return to Agents' }))
    await screen.findByRole('group', { name: 'Claude' })
    await act(() => vi.advanceTimersByTimeAsync(9000))

    expect(send).toHaveBeenCalledTimes(1)
    for (const [, request] of send.mock.calls) {
      expect(new Headers(request?.headers).get('authorization')).toBe('Bearer key')
    }
    expectCard('Codex', 'Not checked')
  })
})

/** A subsection's card, inside its region of the same name, to scope its own Save. */
const card = (name: string) => screen.getAllByRole('region', { name }).at(-1)!

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

test('each provider card saves its switch and sign-in as they change, with the steps, and its model with Save', async () => {
  const api = await renderAgents()
  const codex = screen.getByRole('group', { name: 'Codex' })
  fireEvent.click(within(codex).getByRole('checkbox', { name: 'On' }))
  fireEvent.click(within(codex).getByRole('button', { name: 'API key' }))
  expect(within(codex).getByText('OPENAI_API_KEY')).toBeVisible()
  expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
  const research = screen.getByRole('group', { name: 'Research' })
  fireEvent.change(within(research).getByRole('combobox', { name: 'Research provider' }), {
    target: { value: 'codex' },
  })
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
  fireEvent.change(within(codex).getByRole('combobox', { name: 'Default model' }), {
    target: { value: 'gpt-6-luna' },
  })
  fireEvent.click(within(card('Providers')).getByRole('button', { name: 'Save' }))
  await waitFor(() =>
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

test('turning a provider off shows its steps on Default with a note, and saves at once', async () => {
  const api = client()
  api.settings.mockResolvedValue(bothOn)
  await renderAgents(api)
  const research = within(screen.getByRole('group', { name: 'Research' }))
  expect(research.getByRole('combobox', { name: 'Research provider' })).toHaveValue('codex')
  fireEvent.click(
    within(screen.getByRole('group', { name: 'Codex' })).getByRole('checkbox', { name: 'On' }),
  )
  expect(research.getByRole('combobox', { name: 'Research provider' })).toHaveValue('')
  expect(research.getByText(/now uses Default/)).toBeVisible()
  expect(screen.getByRole('radio', { name: 'Codex' })).toBeDisabled()
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

test('typing a model holds the navigation guard', async () => {
  const dirty = vi.fn()
  await renderAgents(client(), dirty)
  fireEvent.change(
    within(screen.getByRole('group', { name: 'Claude' })).getByRole('combobox', {
      name: 'Default model',
    }),
    { target: { value: 'opus' } },
  )
  expect(dirty).toHaveBeenLastCalledWith(true, expect.any(Function))
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
  fireEvent.change(codex.getByRole('combobox', { name: 'Default model' }), {
    target: { value: 'gpt-6-luna' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Read settings again' }))
  await waitFor(() => expect(api.settings).toHaveBeenCalledTimes(2))
  await new Promise((done) => setTimeout(done, 20))
  expect(claude.getByRole('checkbox', { name: 'On' })).toBeChecked()
  fireEvent.click(within(card('Providers')).getByRole('button', { name: 'Save' }))
  expect(await screen.findByText(/changed in another tab/)).toBeVisible()
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
    expect(screen.getByRole('checkbox', { name: 'Suggest tags for new batches' })).toBeChecked(),
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
  fireEvent.click(screen.getByRole('checkbox', { name: 'Suggest tags for new batches' }))
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

test('while a model Save is pending its fields are read-only, and the switches stay usable', async () => {
  const api = client()

  let finish: (value: AgentSettingsDto) => void = () => undefined

  api.saveSettings.mockImplementation(
    () => new Promise<AgentSettingsDto>((resolve) => (finish = resolve)),
  )
  await renderAgents(api)
  const claude = within(screen.getByRole('group', { name: 'Claude' }))
  const model = claude.getByRole('combobox', { name: 'Default model' })
  fireEvent.change(model, { target: { value: 'opus' } })
  fireEvent.click(within(card('Providers')).getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(api.saveSettings).toHaveBeenCalled())
  expect(model).toHaveAttribute('readonly')
  expect(claude.getByRole('button', { name: 'API key' })).not.toHaveAttribute('aria-disabled')
  await act(async () => finish({ ...initial, revision: '8' }))
  expect(model).not.toHaveAttribute('readonly')
})

test('an invalid default model is refused in the form and nothing is sent', async () => {
  const api = await renderAgents()
  const claude = within(screen.getByRole('group', { name: 'Claude' }))
  fireEvent.change(claude.getByRole('combobox', { name: 'Default model' }), {
    target: { value: '-bad' },
  })
  fireEvent.click(within(card('Providers')).getByRole('button', { name: 'Save' }))
  expect(await claude.findByText(/Choose a valid model ID for Claude/)).toBeVisible()
  expect(api.saveSettings).not.toHaveBeenCalled()
})

test('after leaving and returning, a Codex command waits for the runner call still running', async () => {
  let answer: (value: Response) => void = () => undefined

  send
    .mockImplementationOnce(() => new Promise<Response>((resolve) => (answer = resolve)))
    .mockResolvedValueOnce(Response.json({ state: 'disconnected' }))
  await renderAgents()
  fireEvent.click(screen.getByRole('button', { name: 'ChatGPT subscription' }))
  fireEvent.change(screen.getByLabelText('Codex runner management key'), {
    target: { value: 'key' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Check ChatGPT connection' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))

  fireEvent.click(screen.getByRole('button', { name: 'Leave Agents' }))
  fireEvent.click(screen.getByRole('button', { name: 'Return to Agents' }))
  await screen.findByRole('group', { name: 'Claude' })
  fireEvent.click(screen.getByRole('button', { name: 'ChatGPT subscription' }))
  fireEvent.change(screen.getByLabelText('Codex runner management key'), {
    target: { value: 'key' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Check ChatGPT connection' }))
  await new Promise((done) => setTimeout(done, 20))
  expect(send).toHaveBeenCalledTimes(1)

  await act(async () => answer(Response.json({ state: 'disconnected' })))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
  await screen.findByRole('button', { name: 'Sign in with ChatGPT' })
})

test('a Codex runner call outlasting the guest limits fails and frees the queue', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  send.mockImplementationOnce(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
      }),
  )
  send.mockResolvedValueOnce(Response.json({ state: 'disconnected' }))
  await renderAgents()
  fireEvent.click(screen.getByRole('button', { name: 'ChatGPT subscription' }))
  fireEvent.change(screen.getByLabelText('Codex runner management key'), {
    target: { value: 'key' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Check ChatGPT connection' }))
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1))

  // Still waiting well past one guest RPC limit, then failing once the full bound has passed.
  await act(() => vi.advanceTimersByTimeAsync(85_000))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.getByRole('group', { name: 'Codex' })).not.toHaveAccessibleDescription(
    'Check failed',
  )

  await act(() => vi.advanceTimersByTimeAsync(5_000))
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not confirm sign-in status')
  expectCard('Codex', 'Check failed')
  fireEvent.click(screen.getByRole('button', { name: 'Check ChatGPT connection' }))
  await screen.findByRole('button', { name: 'Sign in with ChatGPT' })
  expect(send).toHaveBeenCalledTimes(2)
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
  const publicPages = () => screen.getByRole('checkbox', { name: 'Allow public web pages' })

  const datasheets = () =>
    screen.getByRole('checkbox', { name: 'Prefer manufacturer datasheets over distributor pages' })

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
    expect(await screen.findByText(/changed in another tab/, {}, { timeout: 3000 })).toBeVisible()
    expect(datasheets()).not.toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: /Reload/ }))
    await waitFor(() => expect(datasheets()).toBeChecked())
  })
})
