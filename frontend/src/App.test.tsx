import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import App from './App'
import { CaptureWorkspace } from './components/capture/CaptureWorkspace'
import type { CaptureSnapshotDto } from '@invimport/contracts'

const batchId = '10000000-0000-4000-8000-000000000001'
const partId = '20000000-0000-4000-8000-000000000002'
const lotId = '30000000-0000-4000-8000-000000000003'
const fixture: CaptureSnapshotDto = {
  id: batchId,
  source_id: '40000000-0000-4000-8000-000000000004',
  title: 'Separate packets',
  revision: '9007199254740993',
  archived: false,
  updated_at: '2026-11-01T12:00:00Z',
  actor_id: '50000000-0000-4000-8000-000000000005',
  target_context_id: '60000000-0000-4000-8000-000000000006',
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  parts: [{ id: partId, label: 'Shared resistor', revision: '1', choice: { mode: 'unset' } }],
  lots: [
    {
      id: lotId,
      label: 'Packet A',
      revision: '3',
      contribution_key: '70000000-0000-4000-8000-000000000007',
      part_subject_id: partId,
      quantity: { mode: 'set', value: '0.000001' },
      location: { mode: 'inherit' },
    },
  ],
  observations: [],
  notes: [
    {
      id: '80000000-0000-4000-8000-000000000008',
      subject_id: lotId,
      text: 'Original approx.20; human count differs.',
      actor_id: '50000000-0000-4000-8000-000000000005',
      created_at: '2026-11-01T12:00:00Z',
      producer: 'human',
    },
  ],
  cursor: { stream_id: '90000000-0000-4000-8000-000000000009', sequence: '3' },
}
const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
afterEach(() => {
  vi.restoreAllMocks()
  location.hash = ''
})

test('no-photo capture shows human provenance, exact values and distinct lot identity; edits emit string scalars', async () => {
  const user = userEvent.setup()
  const edit = vi.fn(async () => undefined)
  render(
    <CaptureWorkspace batch={fixture} busy={false} edit={edit} observe={vi.fn(async () => null)} />,
  )
  expect(screen.getByText('Human · Packet A')).toBeVisible()
  expect(screen.getByText('Original approx.20; human count differs.')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Edit lot Packet A' }))
  const quantity = screen.getByRole('textbox', { name: /^Exact quantity \(pieces\)/ })
  expect(quantity).toHaveValue('0.000001')
  await user.clear(quantity)
  await user.type(quantity, '9999999999999.999999')
  expect(screen.getByRole('button', { name: 'Add lot' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Save human changes' }))
  expect(edit).toHaveBeenCalledWith({
    kind: 'lot',
    id: lotId,
    label: 'Packet A',
    part_subject_id: partId,
    quantity: { mode: 'set', value: '9999999999999.999999' },
    location: { mode: 'inherit' },
  })
})

test('refresh URL resumes server batch and a 412 preserves local inputs while showing current saved values', async () => {
  location.hash = batchId
  let reads = 0
  const sent: unknown[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/activity')) {
      return response({ runs: [], truncated: false })
    }
    if (path.endsWith('bootstrap')) {
      return response({
        mode: 'development-key',
        banner: 'Single-operator development mode — not a verified human session',
        status: 'configured',
        actor_id: fixture.actor_id,
        target_id: 'a0000000-0000-4000-8000-00000000000a',
        target_context_id: fixture.target_context_id,
        mutation_enabled: false,
        permission_gate: 'deferred_T11',
        csrf_token: 'a'.repeat(64),
      })
    }
    if (path.endsWith('/edits')) {
      sent.push(JSON.parse(String(init?.body)))
      return response(
        {
          code: 'revision_conflict',
          message: 'Conflict',
          recovery: 'refresh',
          correlation_id: 'test',
        },
        412,
      )
    }
    reads++
    return response(
      reads === 1
        ? fixture
        : { ...fixture, revision: '9007199254740994', title: 'Other client saved' },
    )
  })
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('heading', { name: 'Separate packets' })
  await user.click(screen.getByRole('button', { name: 'Batch title' }))
  await user.clear(screen.getByLabelText('Title'))
  await user.type(screen.getByLabelText('Title'), 'My unsaved title')
  await user.click(screen.getByRole('button', { name: 'Save human changes' }))
  await screen.findByText(/Another client saved first/)
  expect(screen.getByLabelText('Title')).toHaveValue('My unsaved title')
  expect(screen.getByText(/Current saved revision 9007199254740994/)).toBeVisible()
  expect(sent).toEqual([
    { expected_revision: '9007199254740993', change: { kind: 'batch', title: 'My unsaved title' } },
  ])
  await user.click(
    screen.getByRole('button', { name: 'Discard local edits and load saved values' }),
  )
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Other client saved' })).toBeVisible(),
  )
})

test('archive is read-only until explicit resume; no approval or write button is implied', async () => {
  const user = userEvent.setup()
  const edit = vi.fn(async () => undefined)
  render(
    <CaptureWorkspace
      batch={{ ...fixture, archived: true }}
      busy={false}
      edit={edit}
      observe={vi.fn(async () => null)}
    />,
  )
  expect(screen.getByRole('status')).toHaveTextContent('Archived, not deleted')
  expect(screen.getByRole('button', { name: 'Save shared defaults' })).toBeDisabled()
  expect(screen.queryByRole('button', { name: /Approve|Apply|Upload/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Resume archived batch' }))
  expect(edit).toHaveBeenCalledWith({ kind: 'batch', archived: false })
})

test('inbox resumes retained capture, filters archives and creates a batch with a human note', async () => {
  const sent: unknown[] = []
  const summary = {
    id: batchId,
    source_id: fixture.source_id,
    title: fixture.title,
    revision: fixture.revision,
    archived: false,
    updated_at: fixture.updated_at,
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/activity')) {
      return response({ runs: [], truncated: false })
    }
    if (path.endsWith('bootstrap')) {
      return response({
        mode: 'development-key',
        banner: 'Single-operator development mode — not a verified human session',
        status: 'configured',
        actor_id: fixture.actor_id,
        target_id: 'a0000000-0000-4000-8000-00000000000a',
        target_context_id: fixture.target_context_id,
        mutation_enabled: false,
        permission_gate: 'deferred_T11',
        csrf_token: 'a'.repeat(64),
      })
    }
    if (init?.method === 'POST') {
      sent.push(JSON.parse(String(init.body)))
      return response({ ...fixture, title: 'New manually counted bag' }, 201)
    }
    if (path.endsWith('/batches')) {
      return response({
        batches: [
          summary,
          {
            ...summary,
            id: 'b0000000-0000-4000-8000-00000000000b',
            title: 'Archived packet',
            archived: true,
          },
        ],
        truncated: false,
      })
    }
    return response({ ...fixture, title: 'New manually counted bag' })
  })
  const user = userEvent.setup()
  render(<App />)
  expect(await screen.findByRole('link', { name: 'Resume capture →' })).toHaveAttribute(
    'href',
    `#${batchId}`,
  )
  expect(screen.queryByText('Archived packet')).not.toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: 'Show archived' }))
  expect(screen.getByText('Archived packet')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'New batch' }))
  await user.type(screen.getByLabelText('Batch title'), 'New manually counted bag')
  await user.type(screen.getByLabelText('Human note'), 'Counted at the bench, not inferred.')
  await user.click(screen.getByRole('button', { name: 'Create retained batch' }))
  await screen.findByRole('heading', { name: 'New manually counted bag' })
  expect(sent).toEqual([
    { title: 'New manually counted bag', note: 'Counted at the bench, not inferred.' },
  ])
})
