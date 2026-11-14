import { screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { test, expect, vi } from 'vitest'
import { render } from '#/test/render'
import type { SessionFailureDto } from '@invimport/contracts'
import { SessionFailureDetails } from './SessionFailureDetails'
import { SessionPanel } from '#/components/processing/SessionPanel'

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
test('details load lazily, open by keyboard, close and reuse the retained result', async () => {
  const load = vi.fn().mockResolvedValue(details)
  render(<SessionFailureDetails attemptId="attempt" failure={details} load={load} />)
  expect(load).not.toHaveBeenCalled()
  const button = screen.getByRole('button', { name: 'Show details' })
  button.focus()
  await userEvent.keyboard('{Enter}')
  expect(await screen.findByText('agent_tool_refused')).toBeVisible()
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
    session: vi.fn().mockResolvedValue({
      job_id: 'job',
      attempt_id: 'attempt',
      session_state: 'failed',
      failure: details,
      outbox: [],
      inbox: [],
      truncated: false,
    }),
  }
  // Only the job identity is read by this component.
  render(
    <SessionPanel
      batchId="batch"
      job={{ id: 'job' } as never}
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
