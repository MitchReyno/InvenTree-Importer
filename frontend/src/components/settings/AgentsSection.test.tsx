import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest'
import type { AgentSessionListDto, AgentSettingsDto } from '@invimport/contracts'
import { IntakeRequestError, type agentsClient } from '@invimport/contracts/client'
import { useQueryClient } from '@tanstack/react-query'
import { fixtureScope, render } from '#/test/render'
import { serverQueryKey } from '#/queries/scope'
import type { SettingsSectionId } from '#/navigation/app-route'
import { Settings } from './Settings'
import { resetRunnerQueue } from '#/components/agents/useChatGPTSignIn'

const initial: AgentSettingsDto = {
  revision: '7',
  selection: { provider: 'claude', authentication: 'subscription', model: 'sonnet' },
  session_concurrency: 3,
}

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
      async (input: {
        selection: AgentSettingsDto['selection']
        session_concurrency: number
      }): Promise<AgentSettingsDto> => ({
        revision: '8',
        selection: input.selection,
        session_concurrency: input.session_concurrency,
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

async function renderAgents(api = client(), dirty?: (value: boolean) => void) {
  render(<Harness api={api} dirty={dirty} />)
  await screen.findByRole('radiogroup', { name: 'Provider' })
  return api
}

/** The card's status is its radio's description, not part of its name. */
function expectCard(provider: 'Claude' | 'Codex', status: string) {
  expect(screen.getByRole('radio', { name: provider })).toHaveAccessibleDescription(status)
}

let send: Mock<typeof fetch>

beforeEach(() => {
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
    await screen.findByRole('radiogroup', { name: 'Provider' })
    await act(() => vi.advanceTimersByTimeAsync(9000))

    expect(send).toHaveBeenCalledTimes(1)
    for (const [, request] of send.mock.calls) {
      expect(new Headers(request?.headers).get('authorization')).toBe('Bearer key')
    }
    expectCard('Codex', 'Not checked')
  })
})

test('provider is an option card, sign-in a segmented control, and the stepper sets sessions at once', async () => {
  const api = await renderAgents()
  expect(screen.getByRole('radio', { name: 'Claude' })).toBeChecked()
  fireEvent.click(screen.getByRole('radio', { name: 'Codex' }))
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('')
  expect(screen.getByText(/codex login/)).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'API key' }))
  expect(screen.getByText('OPENAI_API_KEY')).toBeVisible()
  expect(screen.queryByLabelText('API key')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), {
    target: { value: 'gpt-6-luna' },
  })
  const sessions = screen.getAllByRole('group', { name: 'Sessions at once' })[0]
  fireEvent.click(within(sessions).getByRole('button', { name: 'One fewer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(api.saveSettings).toHaveBeenCalledWith({
      expected_revision: '7',
      selection: { provider: 'codex', authentication: 'api_key', model: 'gpt-6-luna' },
      session_concurrency: 2,
    }),
  )
})

test('changing a segmented or stepper value reports unsaved input to the navigation guard', async () => {
  const dirty = vi.fn()
  await renderAgents(client(), dirty)
  fireEvent.click(screen.getByRole('button', { name: 'API key' }))
  expect(dirty).toHaveBeenLastCalledWith(true)
  dirty.mockClear()
  fireEvent.click(
    within(screen.getAllByRole('group', { name: 'Sessions at once' })[0]).getByRole('button', {
      name: 'One more',
    }),
  )
  expect(dirty).toHaveBeenLastCalledWith(true)
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

test('a stale revision is refused as a conflict, keeps the edit and offers Reload', async () => {
  const api = client()
  api.saveSettings.mockRejectedValue(new IntakeRequestError(409, 'revision_conflict'))
  api.settings
    .mockResolvedValueOnce(initial)
    .mockResolvedValueOnce({ ...initial, revision: '9', session_concurrency: 5 })
  await renderAgents(api)
  fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), { target: { value: 'opus' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByText(/changed in another tab/)).toBeVisible()
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('opus')
  fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('sonnet'))
  expect(
    within(screen.getAllByRole('group', { name: 'Sessions at once' })[0]).getByRole('status'),
  ).toHaveTextContent('5')
  expect(await screen.findByText('3 of 5 in use · 1 queued')).toBeVisible()
})

test('after a save the slot meter compares slot use with the saved limit', async () => {
  await renderAgents()
  expect(await screen.findByText('3 of 3 in use · 1 queued')).toBeVisible()
  const sessions = screen.getAllByRole('group', { name: 'Sessions at once' })[0]
  fireEvent.click(within(sessions).getByRole('button', { name: 'One fewer' }))
  expect(screen.getByText('3 of 3 in use · 1 queued')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  expect(await screen.findByText('3 of 2 in use · 1 queued')).toBeVisible()
  expect(within(sessions).getByRole('status')).toHaveTextContent('2')
})

test('while a save is pending the sign-in method and the stepper show they are unavailable', async () => {
  const api = client()

  let finish: (value: AgentSettingsDto) => void = () => undefined

  api.saveSettings.mockImplementation(
    () => new Promise<AgentSettingsDto>((resolve) => (finish = resolve)),
  )
  await renderAgents(api)
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(api.saveSettings).toHaveBeenCalled())
  const sessions = screen.getAllByRole('group', { name: 'Sessions at once' })[0]

  expect(screen.getByRole('button', { name: 'API key' })).toHaveAttribute('aria-disabled', 'true')
  expect(within(sessions).getByRole('button', { name: 'One more' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await act(async () => finish({ ...initial, revision: '8' }))
  expect(screen.getByRole('button', { name: 'API key' })).not.toHaveAttribute('aria-disabled')
})

test('the model field is described by its presets help and, when invalid, its error', async () => {
  await renderAgents()
  const model = screen.getByRole('combobox', { name: 'Model' })

  expect(model).toHaveAccessibleDescription(/Presets do not verify account access/)
  fireEvent.change(model, { target: { value: '-bad' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(model).toHaveAccessibleDescription(/Choose a valid model ID/))
  expect(model).toHaveAccessibleDescription(/Presets do not verify account access/)
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
  await screen.findByRole('radiogroup', { name: 'Provider' })
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
  expect(screen.getByRole('radio', { name: 'Codex' })).not.toHaveAccessibleDescription(
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

  const sessions = screen.getAllByRole('group', { name: 'Sessions at once' })[0]
  fireEvent.click(within(sessions).getByRole('button', { name: 'One fewer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('3 of 2 in use · 1 queued')).toBeVisible()
  await act(async () => {
    answerStale(initial)
    await new Promise((done) => setTimeout(done, 20))
  })

  expect(screen.getByText('3 of 2 in use · 1 queued')).toBeVisible()
})
