import { act, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, test, expect, vi } from 'vitest'
import { render } from '#/test/render'
import {
  CLAUDE_ERROR_KINDS,
  CODEX_ERROR_KINDS,
  SESSION_FAILURE_CODES,
  failureCauseText,
  type SessionFailureCauseDto,
  type SessionFailureDto,
} from '@invimport/contracts'
import { SessionFailureDetails } from './SessionFailureDetails'
import { H, attemptHeader, history } from '#/test/session-history'
import { SessionPanel } from '#/components/processing/SessionPanel'
import { debugModeController } from '#/debug/debug-mode'

const details: SessionFailureDto = {
  id: 'failure',
  category: 'tool_policy',
  summary: 'An operation was refused.',
  details_available: true,
  attempt_id: 'attempt',
  lineage_id: 'lineage',
  turn: '2',
  timestamp: '2026-11-07T00:00:00Z',
  correlation_id: 'correlation',
  code: 'agent_tool_refused',
  stage: 'turn',
  provider: 'codex',
  model: null,
  cli_version: null,
  provider_session_id: null,
  causes: [],
  recovery: 'Check CLI configuration.',
  truncated: false,
}

// The technical details are a debug-mode disclosure; most tests here exercise it.
beforeEach(() => {
  window.localStorage.clear()
  act(() => debugModeController().setEnabled(true))
})

afterEach(() => {
  act(() => debugModeController().setEnabled(false))
})

test('with debug mode off, the cause leads in plain words, advice waits behind help and no code shows', async () => {
  act(() => debugModeController().setEnabled(false))
  const load = vi.fn().mockResolvedValue(details)
  render(
    <SessionFailureDetails
      attemptId="attempt"
      failure={{
        ...details,
        failed_at: '2026-11-07T00:00:00Z',
        cause: { code: 'agent_tool_refused', provider: 'codex' },
        last_status: { text: 'Fetching a page on a private address', at: '2026-11-07T00:00:00Z' },
      }}
      load={load}
    />,
  )

  expect(screen.getByText("Stopped: the agent tried a tool it isn't allowed to use")).toBeVisible()
  expect(screen.getByText('Last status: Fetching a page on a private address')).toBeVisible()
  expect(screen.queryByText('Check CLI configuration.')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'What to do' }))
  expect(await screen.findByText('Check CLI configuration.')).toBeVisible()
  expect(screen.queryByText(/agent_tool_refused/)).not.toBeInTheDocument()
  expect(screen.queryByText(/tool_policy/)).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Show details' })).not.toBeInTheDocument()
  expect(load).not.toHaveBeenCalled()
})

test('an overloaded Claude turn reads with its HTTP status, and its codes show only in debug mode', () => {
  const failure = {
    ...details,
    category: 'provider_network' as const,
    cause: {
      code: 'agent_turn_failed' as const,
      provider: 'claude' as const,
      provider_error: { kind: 'overloaded', result: null, http_status: 529 },
    },
  }
  act(() => debugModeController().setEnabled(false))
  const view = render(<SessionFailureDetails attemptId="attempt" failure={failure} />)
  expect(screen.getByText("Couldn't reach Claude: the API was overloaded (HTTP 529)")).toBeVisible()
  expect(screen.queryByText(/provider_network/)).not.toBeInTheDocument()
  view.unmount()

  act(() => debugModeController().setEnabled(true))
  render(<SessionFailureDetails attemptId="attempt" failure={failure} />)
  expect(screen.getByText('provider_network · agent_turn_failed · overloaded · 529')).toBeVisible()
})

test('a failure recorded without a cause says so rather than showing advice as the cause', () => {
  act(() => debugModeController().setEnabled(false))
  render(<SessionFailureDetails attemptId="attempt" failure={details} />)

  expect(screen.getByText('Failed · the cause wasn’t recorded')).toBeVisible()
  expect(screen.queryByText('Check CLI configuration.')).not.toBeInTheDocument()
  expect(screen.queryByText(details.summary)).not.toBeInTheDocument()
})

test('details load lazily, open by keyboard, close and reuse the retained result', async () => {
  const load = vi.fn().mockResolvedValue(details)
  render(<SessionFailureDetails attemptId="attempt" failure={details} load={load} />)
  expect(load).not.toHaveBeenCalled()
  const button = screen.getByRole('button', { name: 'Show details' })
  button.focus()
  await userEvent.keyboard('{Enter}')
  expect(await screen.findByText('agent_tool_refused')).toBeVisible()
  expect(screen.getByRole('group', { name: 'Debug: Failure details' })).toBeVisible()
  expect(button).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getAllByText('Unavailable')).toHaveLength(3)
  await userEvent.keyboard('{Enter}')
  expect(screen.queryByRole('region', { name: 'Failure details' })).not.toBeInTheDocument()
  fireEvent.click(button)
  expect(load).toHaveBeenCalledTimes(1)
})
test('old sessions and failed reads show explicit unavailable states', async () => {
  const legacy = render(<SessionFailureDetails attemptId="legacy" />)
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
  expect(screen.getByText('Details were not retained for this session.')).toBeVisible()
  legacy.unmount()
  render(
    <SessionFailureDetails
      attemptId="attempt"
      failure={details}
      load={vi.fn().mockRejectedValue(new Error('unavailable'))}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
  expect(await screen.findByText('Failure details are currently unavailable.')).toBeVisible()
})
test('opening Processing details preserves the chat draft and never retries or sends', async () => {
  const chat = vi.fn()
  const fresh = vi.fn()
  const client = {
    chat,
    failure: vi.fn().mockResolvedValue(details),
    // The history read checks its ids; the failure details read returns the fixture.
    history: vi.fn().mockResolvedValue(
      history([], {
        attempts: [
          attemptHeader({
            state: 'failed',
            session_state: 'failed',
            failure: {
              id: H.failure,
              category: details.category,
              summary: details.summary,
              recovery: details.recovery,
              details_available: true,
            },
          }),
        ],
      }),
    ),
  }
  // Only the job identity is read by this component.
  render(
    <SessionPanel
      batchId="batch"
      job={{ id: H.job, stage: 'research', attempt_id: H.attempt } as never}
      client={client}
      startFresh={fresh}
    />,
  )
  const input = await screen.findByRole('textbox')
  fireEvent.change(input, { target: { value: 'Keep my draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
  await waitFor(() => expect(client.failure).toHaveBeenCalledOnce())
  expect(input).toHaveValue('Keep my draft')
  fireEvent.click(screen.getByRole('button', { name: 'Hide details' }))
  expect(chat).not.toHaveBeenCalled()
  expect(fresh).not.toHaveBeenCalled()
})

test('a changed server scope never reuses another account diagnostic', async () => {
  const { ServerScopeContext } = await import('#/context')
  const { fixtureScope } = await import('#/test/render')

  let finish: (value: SessionFailureDto) => void = () => {}

  const load = vi
    .fn()
    .mockResolvedValueOnce(details)
    .mockImplementationOnce(
      () =>
        new Promise<SessionFailureDto>((resolve) => {
          finish = resolve
        }),
    )

  const content = (actorId: string) => (
    <ServerScopeContext.Provider value={{ ...fixtureScope, actorId }}>
      <SessionFailureDetails attemptId="attempt" failure={details} load={load} />
    </ServerScopeContext.Provider>
  )

  const view = render(content('first-actor'))
  fireEvent.click(screen.getByRole('button', { name: 'Show details' }))
  expect(await screen.findByText('agent_tool_refused')).toBeVisible()
  view.rerender(content('second-actor'))
  expect(screen.queryByText('agent_tool_refused')).not.toBeInTheDocument()
  expect(screen.getByText('Loading failure details…')).toBeVisible()
  finish({ ...details, code: 'agent_login_required', category: 'authentication' })
  expect(await screen.findByText('agent_login_required')).toBeVisible()
  expect(load).toHaveBeenCalledTimes(2)
})

test("a failed turn's details name the provider's own error, and only when it reported one", async () => {
  const reported: SessionFailureDto = {
    ...details,
    category: 'provider_network',
    code: 'agent_turn_failed',
    provider_error: { kind: 'httpConnectionFailed', result: null, http_status: 503 },
  }
  const load = vi.fn().mockResolvedValue(reported)
  const { unmount } = render(
    <SessionFailureDetails attemptId="attempt" failure={reported} load={load} />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Show details' }))
  const term = await screen.findByText('Provider error')
  expect(term.nextElementSibling).toHaveTextContent('httpConnectionFailed · HTTP 503')
  unmount()

  render(
    <SessionFailureDetails
      attemptId="attempt"
      failure={details}
      load={vi.fn().mockResolvedValue(details)}
    />,
  )
  await userEvent.click(screen.getByRole('button', { name: 'Show details' }))
  await screen.findByText('agent_tool_refused')
  expect(screen.queryByText('Provider error')).not.toBeInTheDocument()
})

const recorded: SessionFailureCauseDto[] = [
  ...CLAUDE_ERROR_KINDS.map((kind) => ({
    code: 'agent_turn_failed' as const,
    provider: 'claude' as const,
    provider_error: { kind, result: null, http_status: 503 },
  })),
  ...CODEX_ERROR_KINDS.map((kind) => ({
    code: 'agent_turn_failed' as const,
    provider: 'codex' as const,
    provider_error: { kind, result: null, http_status: null },
  })),
  ...SESSION_FAILURE_CODES.map((code) => ({ code, provider: 'claude' as const })),
]

test.each(recorded)(
  'a failure recorded as $code $provider_error.kind leads with its own sentence, not the advice',
  (cause) => {
    act(() => debugModeController().setEnabled(false))
    render(<SessionFailureDetails attemptId="attempt" failure={{ ...details, cause }} />)

    expect(screen.getByText(failureCauseText(cause))).toBeVisible()
    expect(screen.queryByText('Failed · the cause wasn’t recorded')).not.toBeInTheDocument()
    expect(screen.queryByText(details.recovery)).not.toBeInTheDocument()
    if (cause.provider_error?.http_status) {
      expect(screen.getByText(/\(HTTP 503\)$/)).toBeVisible()
    }
  },
)
