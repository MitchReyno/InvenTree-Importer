import { act, cleanup } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { captureClient, manualClient } from '@invimport/contracts/client'
import { Batch } from './components/batches/Batch'
import { ServerStateProvider } from './components/query/ServerStateProvider'
import { createServerQueryClient } from './queries/client'
import { serverQueryKey } from './queries/scope'
import { fixtureScope } from './test/render'
import { render } from './test/render'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import App from './App'
import { CaptureEditor } from './components/capture/CaptureEditor'
import { Batches } from './components/batches/Batches'
import type { Client } from './capture/client'
import { CaptureWorkspace } from './components/capture/CaptureWorkspace'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { ApiClientsProvider } from './components/clients/ApiClientsProvider'
import { BatchCommandsProvider } from './components/batches/BatchCommandsProvider'
import { batchCommands } from './test/batch-commands'

/** The revision behind a "<label>: Saved" status; the number is kept off the visible text. */
function savedRevision(label: string) {
  return screen
    .queryAllByRole('status')
    .find((item) => item.textContent === `${label}: Saved`)
    ?.getAttribute('data-revision')
}

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

const inboxWorkflow = {
  lots: 1,
  ready: 0,
  needs_review: 1,
  blocked: 0,
  approved: 0,
  open_questions: 0,
  active_jobs: 0,
  latest_round: null,
  thumbnail: null,
}

const response = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })

function headerRead(path: string) {
  const identity = {
    actor_id: fixture.actor_id,
    target_id: 'a0000000-0000-4000-8000-00000000000a',
    target_context_id: fixture.target_context_id,
  }
  if (path.endsWith('/connection-status')) {
    return response({
      ...identity,
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
    return response({
      ...identity,
      observed_at: new Date().toISOString(),
      work: [
        {
          kind: 'import',
          id: activityRunId,
          batch_id: batchId,
          stage: 'inventory',
          state: 'queued',
          steps: [{ name: 'approval', state: 'confirmed' }],
          steps_complete: false,
        },
      ],
      active_sessions: [],
      work_truncated: false,
      sessions_truncated: false,
      lane_occupied: false,
    })
  }
  return undefined
}

async function clickOriginalRun(user: ReturnType<typeof userEvent.setup>) {
  if (!screen.queryByRole('link', { name: 'Open original run' })) {
    await user.click(screen.getByRole('button', { name: 'Workflow activity' }))
  }
  await user.click(await screen.findByRole('link', { name: 'Open original run' }))
}

afterEach(() => {
  vi.restoreAllMocks()
  history.replaceState(null, '', location.pathname + location.search)
})

test('no-photo capture shows human provenance; the Review subject editor emits exact string scalars', async () => {
  const user = userEvent.setup()
  const edit = vi.fn(async () => undefined)
  render(
    <BatchCommandsProvider value={batchCommands({ edit, observe: vi.fn(async () => null) })}>
      <CaptureWorkspace batch={fixture} busy={false} />
    </BatchCommandsProvider>,
  )
  expect(screen.getByText('Human · Packet A')).toBeVisible()
  expect(screen.getByText('Original approx.20; human count differs.')).toBeVisible()
  expect(screen.queryByRole('button', { name: 'Edit lot Packet A' })).not.toBeInTheDocument()

  function Editor() {
    const [dirty, setDirty] = useState(false)
    return (
      <BatchCommandsProvider value={batchCommands({ observe: vi.fn(async () => null) })}>
        <CaptureEditor
          batch={fixture}
          selected={lotId}
          frozen={false}
          dirty={dirty}
          onDirty={setDirty}
          edit={edit}
        />
      </BatchCommandsProvider>
    )
  }

  render(<Editor />)
  const quantity = screen.getByRole('textbox', { name: /^Exact quantity \(pieces\)/ })
  expect(quantity).toHaveValue('0.000001')
  await user.clear(quantity)
  await user.type(quantity, '9999999999999.999999')
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
    const header = headerRead(path)
    if (header) {
      return header
    }
    if (path.endsWith('/processing-activity')) {
      return response({ jobs: [], lane_occupied: false, truncated: false })
    }
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
  await user.clear(screen.getByLabelText('Batch title'))
  await user.type(screen.getByLabelText('Batch title'), 'My unsaved title')
  await waitFor(() => expect(sent).toHaveLength(1))
  expect(await screen.findByRole('alert')).toHaveTextContent('another change was saved first')
  expect(screen.getByLabelText('Batch title')).toHaveValue('My unsaved title')
  expect(sent).toEqual([
    {
      expected_revision: '9007199254740993',
      change: {
        kind: 'batch_settings',
        title: 'My unsaved title',
        default_location: { mode: 'clear' },
        intent: {
          supplier: { absent: false, selection: { mode: 'unset' } },
          order: { reference: { mode: 'auto' }, purchase_date: { mode: 'auto' } },
          shared_tags: { manual: [], auto: false },
        },
        notes: { batch: null, order: null },
        drafts: [],
      },
    },
  ])
  await user.click(screen.getByRole('button', { name: 'Reload saved values and discard my edits' }))
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Other client saved' })).toBeVisible(),
  )
})

test('archive is read-only until explicit resume; no approval or write button is implied', async () => {
  const user = userEvent.setup()
  const edit = vi.fn(async () => undefined)
  render(
    <BatchCommandsProvider value={batchCommands({ edit, observe: vi.fn(async () => null) })}>
      <CaptureWorkspace batch={{ ...fixture, archived: true }} busy={false} />
    </BatchCommandsProvider>,
  )
  expect(screen.getByText(/Archived, not deleted/).closest('[role="status"]')).not.toBeNull()
  expect(screen.getByLabelText('Batch title')).toBeDisabled()
  expect(screen.queryByRole('button', { name: /Approve|Apply|Upload/ })).not.toBeInTheDocument()
  cleanup()
  const sent: unknown[] = []
  const client = captureClient(location.origin, 'a'.repeat(64), async (_input, init) => {
    if (init?.method && init.method !== 'GET') {
      sent.push(JSON.parse(String(init.body)))
      return response(fixture)
    }
    return response({ ...fixture, archived: true })
  })
  history.replaceState(null, '', `#${batchId}/capture`)
  render(
    <Batch
      id={batchId}
      route={`${batchId}/capture`}
      client={client}
      manual={reviewManual()}
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Resume archived batch' }))
  await waitFor(() =>
    expect(sent).toEqual([expect.objectContaining({ change: { kind: 'batch', archived: false } })]),
  )
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
    const header = headerRead(path)
    if (header) {
      return header
    }
    if (path.endsWith('/processing-activity')) {
      return response({ jobs: [], lane_occupied: false, truncated: false })
    }
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
    if (path.endsWith('/batches') || path.endsWith('/inbox')) {
      return response({
        batches: [
          { ...summary, workflow: inboxWorkflow },
          {
            ...summary,
            id: 'b0000000-0000-4000-8000-00000000000b',
            title: 'Archived packet',
            archived: true,
            workflow: inboxWorkflow,
          },
        ].filter(
          (batch) =>
            new URL(String(input)).searchParams.get('archived') === 'include' || !batch.archived,
        ),
        truncated: false,
      })
    }
    return response({ ...fixture, title: 'New manually counted bag' })
  })
  const user = userEvent.setup()
  render(<App />)
  expect(
    within(await screen.findByRole('region', { name: fixture.title })).getByRole('link', {
      name: 'Review 1 lot',
    }),
  ).toHaveAttribute('href', `#${batchId}/review/lots?filter=needs_review`)
  expect(screen.queryByText('Archived packet')).not.toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: 'Show archived' }))
  expect(await screen.findByText('Archived packet')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'New batch' }))
  await user.type(screen.getByLabelText('Batch title'), 'New manually counted bag')
  await user.type(screen.getByLabelText('Human note'), 'Counted at the bench, not inferred.')
  await user.click(screen.getByRole('button', { name: 'Create retained batch' }))
  await screen.findByRole('heading', { name: 'New manually counted bag' })
  expect(sent).toEqual([
    { title: 'New manually counted bag', note: 'Counted at the bench, not inferred.' },
  ])
})

const activityRunId = 'a0000000-0000-4000-8000-00000000000a'
const activityDestination = `${batchId}/changes/added/${activityRunId}`

function navigationServer(conflict = false, gate?: Promise<void>) {
  let saved = fixture
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname
    const header = headerRead(path)
    if (header) {
      return header
    }
    if (path.endsWith('/processing-activity')) {
      return response({ jobs: [], lane_occupied: false, truncated: false })
    }
    if (path.endsWith('/bootstrap')) {
      return response({
        mode: 'development-key',
        banner: 'Single-operator development mode — not a verified human session',
        status: 'configured',
        actor_id: fixture.actor_id,
        target_id: activityRunId,
        target_context_id: fixture.target_context_id,
        mutation_enabled: false,
        permission_gate: 'deferred_T11',
        csrf_token: 'a'.repeat(64),
      })
    }
    if (path.endsWith('/activity')) {
      return response({
        runs: [{ batch_id: batchId, run_id: activityRunId, state: 'queued' }],
        truncated: false,
      })
    }
    if (path.endsWith('/batches') || path.endsWith('/inbox')) {
      return response({
        batches: [
          {
            id: batchId,
            source_id: fixture.source_id,
            title: fixture.title,
            revision: fixture.revision,
            archived: false,
            updated_at: fixture.updated_at,
            workflow: inboxWorkflow,
          },
        ],
        truncated: false,
      })
    }
    if (path.endsWith('/manual')) {
      return response({
        batch_id: batchId,
        revision: saved.revision,
        supported: true,
        capability: 'owned-fake-stock/1',
        lots: [{ lot_id: lotId, reviewed: false, issues: [] }],
        runs: [],
        preparations: [],
        preparations_truncated: false,
        cursor: saved.cursor,
      })
    }
    if (path.endsWith('/edits')) {
      const body = JSON.parse(String(init?.body))
      await gate
      saved = {
        ...fixture,
        title: conflict ? 'Another saved title' : body.change.title,
        revision: '9007199254740994',
      }
      if (conflict) {
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
    }
    return response(saved)
  })
}

test('app-wide activity navigation preserves the dirty editor instance; explicit discard releases navigation', async () => {
  history.replaceState(null, '', `#${batchId}/batch`)
  navigationServer(true)
  const user = userEvent.setup()
  const view = render(<App />)
  const title = await screen.findByLabelText('Batch title')
  await user.clear(title)
  const workflowTrigger = screen.getByRole('button', { name: 'Workflow activity' })
  await user.type(title, 'UNSAVED activity regression')
  await clickOriginalRun(user)
  expect(await screen.findByText(/Your unsaved input is preserved/)).toBeVisible()
  expect(screen.getByLabelText('Batch title')).toBe(title)
  expect(screen.getByRole('button', { name: 'Workflow activity' })).toBe(workflowTrigger)
  expect(title).toHaveValue('UNSAVED activity regression')
  expect(location.hash).toBe(`#${batchId}/batch`)
  expect(screen.queryByRole('heading', { name: 'Added' })).not.toBeInTheDocument()
  await screen.findByText(/another change was saved first/)
  expect(title).toHaveValue('UNSAVED activity regression')
  await user.click(screen.getByRole('button', { name: 'Reload saved values and discard my edits' }))
  await waitFor(() =>
    expect(screen.getByLabelText('Batch title')).toHaveValue('Another saved title'),
  )
  expect(screen.queryByText(/Your unsaved input is preserved/)).not.toBeInTheDocument()
  await clickOriginalRun(user)
  await screen.findByRole('heading', { name: 'Added' })
  expect(location.hash).toBe(`#${activityDestination}`)
  view.unmount()
})

test('hash and browser Back cannot discard dirty input; confirmed save permits retrying the history destination', async () => {
  history.replaceState(null, '', `#${activityDestination}`)
  history.pushState(null, '', `#${batchId}/batch`)

  let release = () => undefined as void

  navigationServer(
    false,
    new Promise<void>((resolve) => {
      release = resolve
    }),
  )
  const user = userEvent.setup()
  const view = render(<App />)
  const title = await screen.findByLabelText('Batch title')
  await user.clear(title)
  await user.type(title, 'UNSAVED history regression')
  const unload = new Event('beforeunload', { cancelable: true })
  expect(window.dispatchEvent(unload)).toBe(false)
  location.hash = activityDestination
  await screen.findByText(/Your unsaved input is preserved/)
  expect(location.hash).toBe(`#${batchId}/batch`)
  expect(screen.getByLabelText('Batch title')).toBe(title)
  history.back()
  await waitFor(() => expect(location.hash).toBe(`#${batchId}/batch`))
  expect(title).toHaveValue('UNSAVED history regression')
  expect(screen.queryByRole('heading', { name: 'Added' })).not.toBeInTheDocument()
  await screen.findByText('Batch settings: Saving…')
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(false)
  release()
  await waitFor(() => expect(savedRevision('Batch settings')).toBe('9007199254740994'))
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true)
  history.back()
  await screen.findByRole('heading', { name: 'Added' })
  expect(location.hash).toBe(`#${activityDestination}`)
  view.unmount()
})

test('nonempty new-batch title and note survive global navigation; filters alone do not lock navigation', async () => {
  navigationServer()
  const user = userEvent.setup()
  const view = render(<App />)
  await screen.findByRole('searchbox', { name: 'Search retained batches' })
  await user.click(screen.getByRole('checkbox', { name: 'Show archived' }))
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true)
  await user.click(screen.getByRole('button', { name: 'New batch' }))
  const title = screen.getByLabelText('Batch title')
  const note = screen.getByLabelText('Human note')
  await user.type(title, 'UNSAVED new batch')
  await user.type(note, 'Human facts must survive the activity link.')
  await clickOriginalRun(user)
  expect(await screen.findByText(/Your unsaved input is preserved/)).toBeVisible()
  expect(screen.getByLabelText('Batch title')).toBe(title)
  expect(title).toHaveValue('UNSAVED new batch')
  expect(note).toHaveValue('Human facts must survive the activity link.')
  expect(location.hash).toBe('')
  await user.click(screen.getByRole('button', { name: 'Discard new batch input' }))
  expect(screen.queryByText(/Your unsaved input is preserved/)).not.toBeInTheDocument()
  await clickOriginalRun(user)
  await screen.findByRole('heading', { name: 'Added' })
  view.unmount()
})

test('capture form reports input dirty synchronously and preserves exact draft across newer snapshots', async () => {
  const user = userEvent.setup()
  const onDirty = vi.fn()
  const edit = vi.fn(async () => undefined)
  const props = {
    selected: lotId,
    frozen: false,
    dirty: true,
    onDirty,
    edit,
  }
  const { rerender } = render(<CaptureEditor batch={fixture} {...props} />, {
    commands: { observe: vi.fn(async () => null) },
  })
  const label = screen.getByRole('textbox', { name: 'Lot label' })
  fireEvent.change(label, { target: { value: 'My retained draft' } })
  expect(onDirty).toHaveBeenLastCalledWith(true)

  rerender(
    <CaptureEditor
      batch={{
        ...fixture,
        revision: '9007199254740994',
        lots: [{ ...fixture.lots[0], label: 'Other saved label' }],
      }}
      {...props}
    />,
  )
  expect(label).toHaveValue('My retained draft')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Quantity mode' }), 'unknown')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Location selection' }), 'clear')
  await user.click(screen.getByRole('button', { name: 'Save human changes' }))
  await waitFor(() =>
    expect(edit).toHaveBeenCalledWith({
      kind: 'lot',
      id: lotId,
      label: 'My retained draft',
      part_subject_id: partId,
      quantity: { mode: 'unknown' },
      location: { mode: 'clear' },
    }),
  )
})

test('new batch form retains payload and delivery key after an uncertain acknowledgement', async () => {
  const user = userEvent.setup()
  const create = vi.fn().mockRejectedValue(new Error('connection_lost'))
  const client = {
    create,
    list: async () => ({
      batches: [{ ...fixture, title: 'Existing retained batch' }],
      truncated: false,
    }),
  } as unknown as Client
  const onDirtyChange = vi.fn()
  render(<Batches client={client} onDirtyChange={onDirtyChange} />)
  await screen.findByRole('heading', { name: 'Existing retained batch' })
  await user.click(screen.getByRole('button', { name: 'New batch' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Batch title' }), {
    target: { value: 'Original bag' },
  })
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.type(screen.getByRole('textbox', { name: 'Human note' }), 'Keep this note')
  await user.click(screen.getByRole('button', { name: 'Create retained batch' }))
  await screen.findByRole('alert')
  expect(screen.getByRole('textbox', { name: 'Batch title' })).toHaveValue('Original bag')
  expect(onDirtyChange).not.toHaveBeenCalledWith(false)
  await user.click(screen.getByRole('button', { name: 'Create retained batch' }))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(2))
  expect(create.mock.calls[0]).toEqual(create.mock.calls[1])
  expect(create.mock.calls[0][0]).toEqual({ title: 'Original bag', note: 'Keep this note' })
  await user.click(screen.getByRole('button', { name: 'Discard new batch input' }))
  expect(onDirtyChange).toHaveBeenLastCalledWith(false)
  await user.click(screen.getByRole('button', { name: 'New batch' }))
  await user.type(screen.getByRole('textbox', { name: 'Batch title' }), 'Original bag')
  await user.type(screen.getByRole('textbox', { name: 'Human note' }), 'Keep this note')
  await user.click(screen.getByRole('button', { name: 'Create retained batch' }))
  await waitFor(() => expect(create).toHaveBeenCalledTimes(3))
  expect(create.mock.calls[2]).toEqual(create.mock.calls[0])
})

test('a refreshed query cache cannot replace Capture input or its accepted edit revision', async () => {
  const cache = createServerQueryClient()
  const edits: unknown[] = []
  let reads = 0

  const transport: typeof fetch = async (input, init) => {
    if (new URL(String(input)).pathname.endsWith('/edits')) {
      edits.push(JSON.parse(String(init?.body)))
      return response(
        {
          code: 'revision_conflict',
          message: 'Other client saved',
          recovery: 'refresh',
          correlation_id: 'owned-query-fixture',
        },
        412,
      )
    }
    reads += 1
    return response(
      reads === 1
        ? fixture
        : { ...fixture, title: 'New server title', revision: '9007199254740994' },
    )
  }

  const client = captureClient(location.origin, 'a'.repeat(64), transport)
  const manual = manualClient(location.origin, 'a'.repeat(64), async () => {
    throw new Error('unexpected_manual_transport')
  })

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServerStateProvider scope={fixtureScope} client={cache}>
        {children}
      </ServerStateProvider>
    )
  }

  const user = userEvent.setup()
  render(
    <Batch id={batchId} route={batchId} client={client} manual={manual} onDirtyChange={vi.fn()} />,
    { wrapper: Wrapper },
  )
  await screen.findByRole('heading', { name: 'Separate packets' })
  await user.clear(screen.getByLabelText('Batch title'))
  await user.type(screen.getByLabelText('Batch title'), 'Keep my human draft')
  await act(async () => {
    await cache.refetchQueries({ queryKey: serverQueryKey(fixtureScope, 'capture', batchId) })
  })
  expect(cache.getQueryData(serverQueryKey(fixtureScope, 'capture', batchId))).toEqual(
    expect.objectContaining({ revision: '9007199254740994' }),
  )
  expect(screen.getByLabelText('Batch title')).toHaveValue('Keep my human draft')
  await screen.findByText(/another change was saved first/)
  expect(edits).toEqual([
    expect.objectContaining({
      expected_revision: '9007199254740993',
      change: expect.objectContaining({ kind: 'batch_settings', title: 'Keep my human draft' }),
    }),
  ])
  expect(screen.getByLabelText('Batch title')).toHaveValue('Keep my human draft')
})

test('an unavailable bootstrap refresh within the same scope preserves the mounted human draft', async () => {
  const cache = createServerQueryClient()
  let bootstrapAvailable = true
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname
    const header = headerRead(path)
    if (header) {
      return header
    }
    if (path.endsWith('/processing-activity')) {
      return response({ jobs: [], lane_occupied: false, truncated: false })
    }
    if (path.endsWith('/bootstrap')) {
      if (!bootstrapAvailable) {
        throw new Error('owned_bootstrap_unavailable')
      }
      return response({
        mode: 'development-key',
        banner: 'Single-operator development mode — not a verified human session',
        status: 'configured',
        actor_id: fixture.actor_id,
        target_id: fixtureScope.targetId,
        target_context_id: fixture.target_context_id,
        mutation_enabled: false,
        permission_gate: 'deferred_T11',
        csrf_token: 'a'.repeat(64),
      })
    }
    if (path.endsWith('/activity')) {
      return response({ runs: [], truncated: false })
    }
    return response(fixture)
  })
  location.hash = batchId

  function Wrapper({ children }: { children: ReactNode }) {
    return <ServerStateProvider client={cache}>{children}</ServerStateProvider>
  }

  const user = userEvent.setup()
  render(<App />, { wrapper: Wrapper })
  await screen.findByRole('heading', { name: 'Separate packets' })
  await user.clear(screen.getByLabelText('Batch title'))
  await user.type(screen.getByLabelText('Batch title'), 'Keep this draft while offline')
  bootstrapAvailable = false
  await act(async () => {
    await cache.refetchQueries({ queryKey: ['bootstrap', location.origin] })
  })
  await screen.findByText(/Showing the last development context/)
  expect(screen.getByLabelText('Batch title')).toHaveValue('Keep this draft while offline')
})

test('a batch-list refresh cannot unmount an automatically opened form with human input', async () => {
  const cache = createServerQueryClient()
  let reads = 0

  const transport: typeof fetch = async (_input, init) => {
    if (init?.method === 'POST') {
      throw new Error('unexpected_create_during_read')
    }
    reads += 1
    return response({
      batches:
        reads === 1
          ? []
          : [
              {
                id: fixture.id,
                source_id: fixture.source_id,
                title: fixture.title,
                revision: fixture.revision,
                archived: fixture.archived,
                updated_at: fixture.updated_at,
              },
            ],
      truncated: false,
    })
  }

  const client = captureClient(location.origin, 'a'.repeat(64), transport)

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServerStateProvider scope={fixtureScope} client={cache}>
        {children}
      </ServerStateProvider>
    )
  }

  const dirty = vi.fn()
  const user = userEvent.setup()
  render(<Batches client={client} onDirtyChange={dirty} />, { wrapper: Wrapper })
  await screen.findByRole('textbox', { name: 'Batch title' })
  await user.type(screen.getByRole('textbox', { name: 'Batch title' }), 'Unsaved new bag')
  await user.type(
    screen.getByRole('textbox', { name: 'Human note' }),
    'Keep this draft across list refresh',
  )
  await act(async () => {
    await cache.refetchQueries({ queryKey: serverQueryKey(fixtureScope, 'batches') })
  })
  expect(await screen.findByRole('heading', { name: fixture.title })).toBeVisible()
  expect(screen.getByRole('textbox', { name: 'Batch title' })).toHaveValue('Unsaved new bag')
  expect(screen.getByRole('textbox', { name: 'Human note' })).toHaveValue(
    'Keep this draft across list refresh',
  )
  expect(dirty).toHaveBeenLastCalledWith(true)
  expect(reads).toBe(2)
})

test('following an inbox workflow filter opens Review through the actual App router', async () => {
  navigationServer()
  const user = userEvent.setup()
  render(<App />)
  await user.click(await screen.findByRole('link', { name: 'Review 1 lot' }))
  expect(await screen.findByRole('heading', { name: 'Review selected lots' })).toBeVisible()
  // Review then opens on the first lot.
  await waitFor(() =>
    expect(location.hash).toBe(`#${batchId}/review/lots/${lotId}?filter=needs_review`),
  )
  expect(
    within(screen.getByRole('navigation', { name: 'Batch' })).getByRole('link', {
      name: /^Review/,
    }),
  ).toHaveAttribute('aria-current', 'page')
})

test('uncertain composite settings save retries identical revision, payload and key; changed input requires reconciliation', async () => {
  const user = userEvent.setup()
  const requests: { body: string; key: string | null }[] = []

  const transport: typeof fetch = async (input, init) => {
    if (new URL(String(input)).pathname.endsWith('/edits')) {
      requests.push({
        body: String(init?.body),
        key: new Headers(init?.headers).get('Idempotency-Key'),
      })
      throw new Error('acknowledgement_lost')
    }
    return response(fixture)
  }

  const client = captureClient(location.origin, 'a'.repeat(64), transport)
  const manual = manualClient(location.origin, 'a'.repeat(64), async () => {
    throw new Error('unexpected_manual_call')
  })
  const dirty = vi.fn()
  render(
    <Batch id={batchId} route={batchId} client={client} manual={manual} onDirtyChange={dirty} />,
  )
  const title = await screen.findByLabelText('Batch title')
  await user.type(title, ' draft')
  await waitFor(() => expect(requests).toHaveLength(1))
  await screen.findByText(/Save not confirmed/)
  await user.click(screen.getByRole('button', { name: 'Retry the same save' }))
  await waitFor(() => expect(requests).toHaveLength(2))
  expect(requests[0].key).toBeTruthy()
  expect(requests[1]).toEqual(requests[0])
  await user.type(title, ' changed')
  await new Promise((resolve) => setTimeout(resolve, 700))
  expect(requests).toHaveLength(2)
  expect(title).toHaveValue('Separate packets draft changed')
  expect(dirty).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'Reload saved values and discard my edits' }))
  await waitFor(() => expect(screen.getByLabelText('Batch title')).toHaveValue('Separate packets'))
  await user.type(screen.getByLabelText('Batch title'), ' new intent')
  await waitFor(() => expect(requests).toHaveLength(3))
  expect(requests[2].key).not.toBe(requests[0].key)
})

test('a locally refused lot context in the Review editor remains correctable before any delivery intent', async () => {
  const user = userEvent.setup()
  const edits: unknown[] = []

  const transport: typeof fetch = async (input, init) => {
    if (new URL(String(input)).pathname.endsWith('/edits')) {
      edits.push(JSON.parse(String(init?.body)))
      return response({ ...fixture, revision: '9007199254740994' })
    }
    return response(fixture)
  }

  const client = captureClient(location.origin, 'a'.repeat(64), transport)
  const manual = manualClient(location.origin, 'a'.repeat(64), async (input) => {
    if (new URL(String(input)).pathname.endsWith('/manual')) {
      return response({
        batch_id: batchId,
        revision: fixture.revision,
        supported: true,
        capability: 'owned-fake-stock/1',
        lots: [{ lot_id: lotId, reviewed: false, issues: [] }],
        runs: [],
        preparations: [],
        preparations_truncated: false,
        cursor: fixture.cursor,
      })
    }
    throw new Error('unexpected_manual_call')
  })
  const route = `${batchId}/review/lots/${lotId}?edit=${lotId}`
  history.replaceState(null, '', `#${route}`)
  render(
    <Batch id={batchId} route={route} client={client} manual={manual} onDirtyChange={vi.fn()} />,
  )
  const lot = await screen.findByRole('region', { name: 'Lot: Packet A' })
  await user.selectOptions(within(lot).getByLabelText('Capture tags mode'), 'set')
  const tags = within(lot).getByLabelText(/^Capture tags \(one per line\)/)
  await user.type(tags, 'same\nsame')
  await user.click(within(lot).getByRole('button', { name: 'Save human changes' }))
  await screen.findByText(/No request was sent/)
  expect(edits).toHaveLength(0)
  await user.clear(tags)
  await user.type(tags, 'corrected\n')
  await user.click(within(lot).getByRole('button', { name: 'Save human changes' }))
  await waitFor(() => expect(edits).toHaveLength(1))
  expect(edits[0]).toEqual(
    expect.objectContaining({
      change: expect.objectContaining({
        context: expect.objectContaining({ tags: { mode: 'set', value: ['corrected'] } }),
      }),
    }),
  )
})

function reviewManual() {
  return manualClient(location.origin, 'a'.repeat(64), async (input) => {
    if (new URL(String(input)).pathname.endsWith('/manual')) {
      return response({
        batch_id: batchId,
        revision: fixture.revision,
        supported: true,
        capability: 'owned-fake-stock/1',
        lots: [{ lot_id: lotId, reviewed: false, issues: [] }],
        runs: [],
        preparations: [],
        preparations_truncated: false,
        cursor: fixture.cursor,
      })
    }
    throw new Error('unexpected_manual_call')
  })
}

test('legacy Capture subject links open the same subject in Review', async () => {
  const client = captureClient(location.origin, 'a'.repeat(64), async () => response(fixture))
  for (const [subject, expected] of [
    [lotId, `#${batchId}/review/lots/${lotId}?edit=${lotId}`],
    [partId, `#${batchId}/review/lots?edit=${partId}`],
  ]) {
    history.replaceState(null, '', `#${batchId}/${subject}`)
    const view = render(
      <Batch
        id={batchId}
        route={`${batchId}/${subject}`}
        client={client}
        manual={reviewManual()}
        onDirtyChange={vi.fn()}
      />,
    )
    await waitFor(() => expect(location.hash).toBe(expected))
    view.unmount()
  }
})

test('old approval, results, review and processing links redirect with their query intact', async () => {
  const client = captureClient(location.origin, 'a'.repeat(64), async () => response(fixture))
  const preparation = '70000000-0000-4000-8000-000000000007'
  for (const [legacy, expected] of [
    [`approve/${preparation}?view=all`, `changes/ready/${preparation}?view=all`],
    ['results', 'changes/added'],
    [`review/${lotId}?source=S&version=V&page=2`, `review/lots/${lotId}?source=S&version=V&page=2`],
    ['processing/identifying/q1', 'processing/examine/q1'],
  ]) {
    history.replaceState(null, '', `#${batchId}/${legacy}`)
    const view = render(
      <Batch
        id={batchId}
        route={`${batchId}/${legacy}`}
        client={client}
        manual={reviewManual()}
        onDirtyChange={vi.fn()}
      />,
    )
    await waitFor(() => expect(location.hash).toBe(`#${batchId}/${expected}`))
    view.unmount()
  }
})

test('Changes returns to the preparation last shown across other tabs, without a history entry', async () => {
  const client = captureClient(location.origin, 'a'.repeat(64), async () => response(fixture))
  const shown = '70000000-0000-4000-8000-000000000007'
  const newer = '70000000-0000-4000-8000-000000000008'
  const manual = reviewManual()
  vi.spyOn(manual, 'workspace').mockResolvedValue({
    ...(await manual.workspace(batchId)),
    preparations: [newer, shown].map(
      (id) => ({ id, effects: [], selected_lot_ids: [], remaining_lot_ids: [] }) as never,
    ),
  })
  const props = { id: batchId, client, manual, onDirtyChange: vi.fn() }
  history.replaceState(null, '', `#${batchId}/changes/ready/${shown}`)
  const view = render(<Batch {...props} route={`${batchId}/changes/ready/${shown}`} />)
  view.rerender(<Batch {...props} route={`${batchId}/capture`} />)
  history.replaceState(null, '', `#${batchId}/changes/ready`)
  const entries = history.length
  view.rerender(<Batch {...props} route={`${batchId}/changes/ready`} />)

  await waitFor(() => expect(location.hash).toBe(`#${batchId}/changes/ready/${shown}`))
  expect(history.length).toBe(entries)
})

test('Review offers manual lot and Part creation; a dirty editor cannot be closed silently', async () => {
  const user = userEvent.setup()
  const client = captureClient(location.origin, 'a'.repeat(64), async () => response(fixture))
  const route = `${batchId}/review/lots`
  history.replaceState(null, '', `#${route}`)
  render(
    <Batch
      id={batchId}
      route={route}
      client={client}
      manual={reviewManual()}
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Add physical lot' }))
  const editor = screen.getByRole('region', { name: 'Add a physical lot' })
  // Review opens on the first lot, which stays in the URL.
  expect(location.hash).toBe(`#${route}/${lotId}?edit=add_lot`)
  await user.type(within(editor).getByLabelText('Lot label'), 'Packet C')
  expect(
    within(editor).getByRole('button', { name: /Close editor · save or discard first/ }),
  ).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Add shared Part proposal' })).toBeVisible()
})

test('Compare matches with no candidates opens the shared Part editor in Review', async () => {
  const user = userEvent.setup()
  const client = captureClient(location.origin, 'a'.repeat(64), async () => response(fixture))
  const route = `${batchId}/review/lots/${lotId}`
  history.replaceState(null, '', `#${route}`)
  render(
    <Batch
      id={batchId}
      route={route}
      client={client}
      manual={reviewManual()}
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Compare matches' }))
  await user.click(
    screen.getByRole('button', { name: 'Read an existing Part in the shared Part editor' }),
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Shared Part: Shared resistor' })).toBeVisible()
  expect(location.hash).toBe(`#${route}?edit=${partId}`)
})

test('a shared Part linked to no lot can be reopened from Review', async () => {
  const user = userEvent.setup()
  const unlinked = { ...fixture, lots: [] }
  const client = captureClient(location.origin, 'a'.repeat(64), async () => response(unlinked))
  const route = `${batchId}/review/lots`
  history.replaceState(null, '', `#${route}`)
  render(
    <Batch
      id={batchId}
      route={route}
      client={client}
      manual={reviewManual()}
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(
    await screen.findByRole('button', { name: 'Edit unlinked shared Part: Shared resistor' }),
  )
  expect(screen.getByRole('region', { name: 'Shared Part: Shared resistor' })).toBeVisible()
  expect(location.hash).toBe(`#${route}?edit=${partId}`)
})

test('a dirty Review subject editor fences sibling lot commands that would remount it', async () => {
  const user = userEvent.setup()
  const client = captureClient(location.origin, 'a'.repeat(64), async () => response(fixture))
  const route = `${batchId}/review/lots/${lotId}?edit=add_lot`
  history.replaceState(null, '', `#${route}`)
  render(
    <Batch
      id={batchId}
      route={route}
      client={client}
      manual={reviewManual()}
      onDirtyChange={vi.fn()}
    />,
  )
  const editor = await screen.findByRole('region', { name: 'Add a physical lot' })
  await user.click(await screen.findByRole('button', { name: 'Edit lot values' }))
  const quick = screen.getByRole('form', { name: 'Edit Packet A' })
  expect(within(quick).getByLabelText('Quantity')).toBeEnabled()
  await user.type(within(editor).getByLabelText('Lot label'), 'Packet C')
  expect(within(quick).getByLabelText('Quantity')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Add shared Part proposal' })).toBeDisabled()
})

test('stale application observations disable settings until a fresh read', async () => {
  const cache = createServerQueryClient()
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const client = captureClient(location.origin, 'a'.repeat(64), async () => response(fixture))

    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <ServerStateProvider scope={fixtureScope} client={cache}>
          {children}
        </ServerStateProvider>
      )
    }

    render(
      <Batch
        id={batchId}
        route={batchId}
        client={client}
        manual={reviewManual()}
        onDirtyChange={vi.fn()}
      />,
      { wrapper: Wrapper },
    )
    const title = await screen.findByLabelText('Batch title')
    expect(title).toBeEnabled()
    await act(() => vi.advanceTimersByTimeAsync(65_000))
    expect(screen.getByLabelText('Batch title')).toBeDisabled()
    await act(async () => {
      await cache.refetchQueries({ queryKey: serverQueryKey(fixtureScope, 'capture', batchId) })
      await vi.advanceTimersByTimeAsync(5_000)
    })
    await waitFor(() => expect(screen.getByLabelText('Batch title')).toBeEnabled())
  } finally {
    vi.useRealTimers()
  }
})

test('a failed attention refresh withholds the old running counts and says so', async () => {
  const cache = createServerQueryClient()

  const transport: typeof fetch = async () => response(fixture)

  const client = captureClient(location.origin, 'a'.repeat(64), transport)
  const manual = manualClient(location.origin, 'a'.repeat(64), async () => {
    throw new Error('unexpected_manual_transport')
  })
  const counts = { questions: 0, failed: 0, jobs: 2, ready: 0, running: 2 }
  const none = { questions: 0, failed: 0, jobs: 0, ready: 0, running: 0 }
  const read = vi
    .fn()
    .mockResolvedValueOnce({
      batch_id: fixture.id,
      revision: fixture.revision,
      processing: {
        questions: 0,
        failed: 0,
        running: 2,
        steps: { examine: counts, research: none, images: none, inventory: none },
      },
      review: { to_check: 0, changed_after_review: 0, needs_answer: 0, to_decide: 0, records: 0 },
      changes: { ready: 0, failed: 0, uncertain: 0, runs: 0 },
      items: [],
      items_truncated: false,
    })
    .mockRejectedValue(new Error('attention_unavailable'))

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ServerStateProvider scope={fixtureScope} client={cache}>
        {children}
      </ServerStateProvider>
    )
  }

  render(
    <ApiClientsProvider value={{ attention: { read } }}>
      <Batch
        id={fixture.id}
        route={fixture.id}
        client={client}
        manual={manual}
        onDirtyChange={vi.fn()}
      />
    </ApiClientsProvider>,
    { wrapper: Wrapper },
  )
  const tabs = within(await screen.findByRole('navigation', { name: 'Batch' }))
  await tabs.findByRole('link', { name: 'Processing, running' })

  await act(async () => {
    await cache.refetchQueries({ queryKey: serverQueryKey(fixtureScope, 'attention', fixture.id) })
  })

  expect(await screen.findByText('Needs you unavailable')).toBeInTheDocument()
  expect(tabs.getByRole('link', { name: 'Processing' })).toBeInTheDocument()
})

test('a settings section route opens that Settings section and never reads a batch called "settings"', async () => {
  history.replaceState(null, '', '#settings/inventree')
  const requested: string[] = []
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname
    requested.push(path)
    return headerRead(path) ?? navigationFallback(path)
  })
  render(<App />)

  expect(await screen.findByRole('heading', { level: 2, name: 'InvenTree' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'InvenTree' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('link', { name: 'Back to Batches' })).toHaveAttribute('href', '#')
  expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent(
    'Batches/Settings',
  )
  expect(requested.some((path) => path.includes('/batches/settings'))).toBe(false)
})

test('Settings opened from a batch tab goes back to it, across sections, and the guard holds unsaved settings', async () => {
  history.replaceState(null, '', '#agents')
  const settings = {
    revision: '7',
    selection: { provider: 'claude', authentication: 'subscription', model: 'sonnet' },
    session_concurrency: 3,
  }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/agent-settings')) {
      return response(settings)
    }
    if (path.endsWith('/agent-sessions')) {
      return response({
        sessions: [],
        next_before: null,
        sessions_supported: true,
        paused_batch_ids: [],
      })
    }
    return headerRead(path) ?? navigationFallback(path)
  })
  render(<App />)
  await screen.findByRole('link', { name: 'Agent settings' })

  await act(async () => {
    location.hash = '#settings'
  })
  expect(await screen.findByRole('link', { name: 'Back to Agents' })).toHaveAttribute(
    'href',
    '#agents',
  )
  await act(async () => {
    location.hash = '#settings/appearance'
  })
  expect(await screen.findByRole('radiogroup', { name: 'Theme' })).toBeVisible()
  expect(screen.getByRole('link', { name: 'Back to Agents' })).toBeVisible()

  await act(async () => {
    location.hash = '#settings/agents'
  })
  fireEvent.change(await screen.findByRole('combobox', { name: 'Model' }), {
    target: { value: 'opus' },
  })
  fireEvent.click(screen.getByRole('link', { name: 'Back to Agents' }))
  expect(await screen.findByText(/Your unsaved input is preserved/)).toBeVisible()
  expect(location.hash).toBe('#settings/agents')
  expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('opus')
})

/** Bootstrap and empty reads for routes that open no batch. */
function navigationFallback(path: string) {
  if (path.endsWith('/bootstrap')) {
    return response({
      mode: 'development-key',
      banner: 'Single-operator development mode — not a verified human session',
      status: 'configured',
      actor_id: fixture.actor_id,
      target_id: activityRunId,
      target_context_id: fixture.target_context_id,
      mutation_enabled: false,
      permission_gate: 'deferred_T11',
      csrf_token: 'a'.repeat(64),
    })
  }
  return response({ code: 'not_found', message: 'Not found', correlation_id: 'test' }, 404)
}
