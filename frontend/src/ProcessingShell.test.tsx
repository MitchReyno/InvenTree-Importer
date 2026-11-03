import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { validate, type CaptureSnapshotDto, type ProcessingSnapshotDto } from '@invimport/contracts'
import App from './App'
import { fixtureScope, render } from './test/render'

const batch: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: fixtureScope.actorId,
  target_context_id: fixtureScope.targetContextId,
  title: 'Retained Processing route',
  revision: '1',
  updated_at: '2026-11-02T00:00:00Z',
  archived: false,
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  lots: [],
  parts: [],
  notes: [],
  observations: [],
  cursor: { stream_id: '30000000-0000-4000-8000-000000000003', sequence: '0' },
}
const snapshot: ProcessingSnapshotDto = {
  batch_id: batch.id,
  capture_revision: batch.revision,
  runner_status: 'fixture_only',
  cursor: batch.cursor,
  jobs: [],
}
const activity = {
  jobs: [
    {
      batch_id: batch.id,
      job_id: '40000000-0000-4000-8000-000000000004',
      attempt_id: '50000000-0000-4000-8000-000000000005',
      state: 'running',
      input_current: false,
      occupies_lane: true,
    },
  ],
  lane_occupied: true,
  truncated: false,
}
validate('CaptureSnapshot', batch)
validate('ProcessingSnapshot', snapshot)
validate('ProcessingActivity', activity)

function json(value: unknown) {
  return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })
}

function retainedApi(activityAvailable: boolean) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/bootstrap')) {
      return json({
        mode: 'development-key',
        banner: 'Single-operator development mode — not a verified human session',
        status: 'configured',
        actor_id: fixtureScope.actorId,
        target_id: fixtureScope.targetId,
        target_context_id: fixtureScope.targetContextId,
        mutation_enabled: false,
        permission_gate: 'deferred_T11',
        csrf_token: 'a'.repeat(64),
      })
    }
    if (path.endsWith('/connection-status')) {
      return json({
        actor_id: fixtureScope.actorId,
        target_id: fixtureScope.targetId,
        target_context_id: fixtureScope.targetContextId,
        target: {
          state: 'unconfigured',
          freshness: 'unobserved',
          observed_at: null,
          failure_code: null,
          navigation_url: null,
          label: null,
        },
      })
    }
    if (path.endsWith('/header-work')) {
      if (!activityAvailable) {
        throw new Error('owned_header_work_unavailable')
      }
      return json({
        actor_id: fixtureScope.actorId,
        target_id: fixtureScope.targetId,
        target_context_id: fixtureScope.targetContextId,
        observed_at: new Date().toISOString(),
        work: activity.jobs.map((job) => ({
          kind: 'processing',
          id: job.job_id,
          batch_id: job.batch_id,
          attempt_id: job.attempt_id,
          stage: 'reading',
          state: job.state,
          input_current: job.input_current,
          occupies_lane: job.occupies_lane,
          blocked_code: null,
          steps: [{ stage: 'reading', state: job.state }],
          steps_complete: false,
        })),
        active_sessions: [],
        work_truncated: false,
        sessions_truncated: false,
        lane_occupied: true,
      })
    }
    if (path.endsWith('/processing-activity')) {
      if (!activityAvailable) {
        throw new Error('owned_processing_activity_unavailable')
      }
      return json(activity)
    }
    if (path.endsWith('/activity')) {
      return json({ runs: [], truncated: false })
    }
    if (path.endsWith('/processing')) {
      return json(snapshot)
    }
    return json(batch)
  })
}

afterEach(() => {
  vi.restoreAllMocks()
  history.replaceState(null, '', location.pathname)
})

test('Processing deep link uses its own workspace and stale-input physical work remains globally occupied', async () => {
  location.hash = `${batch.id}/processing/reading`
  const transport = retainedApi(true)
  const user = userEvent.setup()
  render(<App />)
  const tabs = await screen.findByRole('navigation', { name: 'Processing steps' })
  const headerTrigger = screen.getByRole('button', { name: 'Workflow activity' })
  expect(tabs).toBeVisible()
  expect(screen.getByRole('link', { name: 'Reading' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('button', { name: 'Processing' })).toHaveAttribute('aria-current', 'page')
  expect(await screen.findByText(/Processing in progress/)).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Workflow activity' }))
  expect(screen.getByText(/Physical lane occupied/)).toBeVisible()
  expect(screen.getByRole('link', { name: 'Open processing' })).toHaveAttribute(
    'href',
    `#${batch.id}/processing/overview`,
  )
  expect(screen.queryByRole('heading', { name: 'Exact manual review' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Capture' }))
  await waitFor(() =>
    expect(screen.queryByRole('navigation', { name: 'Processing steps' })).not.toBeInTheDocument(),
  )
  expect(location.hash).toBe(`#${batch.id}/capture`)
  expect(screen.getByRole('button', { name: 'Workflow activity' })).toBe(headerTrigger)
  await user.click(screen.getByRole('button', { name: 'Processing' }))
  await screen.findByRole('navigation', { name: 'Processing steps' })
  expect(location.hash).toBe(`#${batch.id}/processing/overview`)
  expect(transport.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(
    true,
  )
})

test('an unavailable workflow read cannot claim idle or released capacity', async () => {
  location.hash = `${batch.id}/processing/overview`
  retainedApi(false)
  render(<App />)
  await screen.findByText('Workflow unavailable')
  expect(screen.queryByText('Idle')).not.toBeInTheDocument()
  expect(screen.queryByText(/Processing lane available/)).not.toBeInTheDocument()
})
