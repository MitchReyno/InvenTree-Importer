import { act } from '@testing-library/react'
import type { ReactNode } from 'react'
import { captureClient, manualClient } from '@invimport/contracts/client'
import { Batch } from './components/batches/Batch'
import { ServerStateProvider } from './components/query/ServerStateProvider'
import { createServerQueryClient } from './queries/client'
import { serverQueryKey } from './queries/scope'
import { fixtureScope } from './test/render'
import { render } from './test/render'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import App from './App'
import { CaptureEditor } from './components/capture/CaptureEditor'
import { Batches } from './components/batches/Batches'
import type { Client } from './capture/client'
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
  history.replaceState(null, '', location.pathname + location.search)
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

const activityRunId = 'a0000000-0000-4000-8000-00000000000a'
const activityDestination = `${batchId}/results/${activityRunId}`

function navigationServer(conflict = false) {
  let saved = fixture
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname
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
    if (path.endsWith('/batches')) {
      return response({
        batches: [
          {
            id: batchId,
            source_id: fixture.source_id,
            title: fixture.title,
            revision: fixture.revision,
            archived: false,
            updated_at: fixture.updated_at,
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
  const title = await screen.findByLabelText('Title')
  await user.clear(title)
  await user.type(title, 'UNSAVED activity regression')
  await user.click(await screen.findByRole('link', { name: 'Open original run' }))
  expect(await screen.findByText(/Your unsaved input is preserved/)).toBeVisible()
  expect(screen.getByLabelText('Title')).toBe(title)
  expect(title).toHaveValue('UNSAVED activity regression')
  expect(location.hash).toBe(`#${batchId}/batch`)
  expect(screen.queryByRole('heading', { name: 'Retained results' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save human changes' }))
  await screen.findByText(/Another client saved first/)
  expect(title).toHaveValue('UNSAVED activity regression')
  await user.click(
    screen.getByRole('button', { name: 'Discard local edits and load saved values' }),
  )
  await waitFor(() => expect(screen.getByLabelText('Title')).toHaveValue('Another saved title'))
  expect(screen.queryByText(/Your unsaved input is preserved/)).not.toBeInTheDocument()
  await user.click(screen.getByRole('link', { name: 'Open original run' }))
  await screen.findByRole('heading', { name: 'Retained results' })
  expect(location.hash).toBe(`#${activityDestination}`)
  view.unmount()
})

test('hash and browser Back cannot discard dirty input; confirmed save permits retrying the history destination', async () => {
  history.replaceState(null, '', `#${activityDestination}`)
  history.pushState(null, '', `#${batchId}/batch`)
  navigationServer()
  const user = userEvent.setup()
  const view = render(<App />)
  const title = await screen.findByLabelText('Title')
  await user.clear(title)
  await user.type(title, 'UNSAVED history regression')
  const unload = new Event('beforeunload', { cancelable: true })
  expect(window.dispatchEvent(unload)).toBe(false)
  location.hash = activityDestination
  await screen.findByText(/Your unsaved input is preserved/)
  expect(location.hash).toBe(`#${batchId}/batch`)
  expect(screen.getByLabelText('Title')).toBe(title)
  history.back()
  await waitFor(() => expect(location.hash).toBe(`#${batchId}/batch`))
  expect(title).toHaveValue('UNSAVED history regression')
  expect(screen.queryByRole('heading', { name: 'Retained results' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save human changes' }))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Save human changes' })).toBeDisabled(),
  )
  expect(screen.queryByText(/Your unsaved input is preserved/)).not.toBeInTheDocument()
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true)
  history.back()
  await screen.findByRole('heading', { name: 'Retained results' })
  expect(location.hash).toBe(`#${activityDestination}`)
  view.unmount()
})

test('nonempty new-batch title and note survive global navigation; filters alone do not lock navigation', async () => {
  navigationServer()
  const user = userEvent.setup()
  const view = render(<App />)
  await screen.findByRole('link', { name: 'Resume capture →' })
  await user.click(screen.getByRole('checkbox', { name: 'Show archived' }))
  expect(window.dispatchEvent(new Event('beforeunload', { cancelable: true }))).toBe(true)
  await user.click(screen.getByRole('button', { name: 'New batch' }))
  const title = screen.getByLabelText('Batch title')
  const note = screen.getByLabelText('Human note')
  await user.type(title, 'UNSAVED new batch')
  await user.type(note, 'Human facts must survive the activity link.')
  await user.click(screen.getByRole('link', { name: 'Open original run' }))
  expect(await screen.findByText(/Your unsaved input is preserved/)).toBeVisible()
  expect(screen.getByLabelText('Batch title')).toBe(title)
  expect(title).toHaveValue('UNSAVED new batch')
  expect(note).toHaveValue('Human facts must survive the activity link.')
  expect(location.hash).toBe('')
  await user.click(screen.getByRole('button', { name: 'Discard new batch input' }))
  expect(screen.queryByText(/Your unsaved input is preserved/)).not.toBeInTheDocument()
  await user.click(screen.getByRole('link', { name: 'Open original run' }))
  await screen.findByRole('heading', { name: 'Retained results' })
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
    observe: vi.fn(async () => null),
  }
  const { rerender } = render(<CaptureEditor batch={fixture} {...props} />)
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
  await user.click(screen.getByRole('button', { name: 'Batch title' }))
  await user.clear(screen.getByLabelText('Title'))
  await user.type(screen.getByLabelText('Title'), 'Keep my human draft')
  await act(async () => {
    await cache.refetchQueries({ queryKey: serverQueryKey(fixtureScope, 'capture', batchId) })
  })
  expect(cache.getQueryData(serverQueryKey(fixtureScope, 'capture', batchId))).toEqual(
    expect.objectContaining({ revision: '9007199254740994' }),
  )
  expect(screen.getByLabelText('Title')).toHaveValue('Keep my human draft')
  expect(screen.getByText('Saved · revision 9007199254740993')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Save human changes' }))
  await screen.findByText(/Another client saved first/)
  expect(edits).toEqual([
    {
      expected_revision: '9007199254740993',
      change: { kind: 'batch', title: 'Keep my human draft' },
    },
  ])
  expect(screen.getByLabelText('Title')).toHaveValue('Keep my human draft')
})

test('an unavailable bootstrap refresh within the same scope preserves the mounted human draft', async () => {
  const cache = createServerQueryClient()
  let bootstrapAvailable = true
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const path = new URL(String(input)).pathname
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
  await user.click(screen.getByRole('button', { name: 'Batch title' }))
  await user.clear(screen.getByLabelText('Title'))
  await user.type(screen.getByLabelText('Title'), 'Keep this draft while offline')
  bootstrapAvailable = false
  await act(async () => {
    await cache.refetchQueries({ queryKey: ['bootstrap', location.origin] })
  })
  await screen.findByText(/Application connection unavailable/)
  expect(screen.getByLabelText('Title')).toHaveValue('Keep this draft while offline')
  expect(screen.getByRole('button', { name: 'Add lot' })).toBeDisabled()
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
