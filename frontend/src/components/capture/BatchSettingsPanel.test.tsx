import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Profiler, useState } from 'react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type {
  CaptureBatchSettingsChangeDto,
  CaptureObservationDto,
  CaptureSnapshotDto,
  OperatorReviewDto,
} from '@invimport/contracts'
import { IntakeRequestError } from '@invimport/contracts/client'
import type { SettingsPorts } from '#/capture/types'
import type { CatalogueClient } from '#/catalogue/types'
import { fixtureScope, render } from '#/test/render'
import { UpdateHealthContext } from '#/components/operations/LiveUpdates'
import { CaptureWorkspace } from './CaptureWorkspace'
import { ApiClientsProvider } from '#/components/clients/ApiClientsProvider'
import { BatchCommandsProvider } from '#/components/batches/BatchCommandsProvider'
import { batchCommands } from '#/test/batch-commands'

/** The revision behind a "<label>: Saved" status; the number is kept off the visible text. */
function savedRevision(label: string) {
  return screen
    .queryAllByRole('status')
    .find((item) => item.textContent === `${label}: Saved`)
    ?.getAttribute('data-revision')
}

const batch: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: '30000000-0000-4000-8000-000000000003',
  target_context_id: fixtureScope.targetContextId,
  title: 'Two packets',
  revision: '1',
  updated_at: '2026-11-03T00:00:00Z',
  archived: false,
  defaults: { quantity: { mode: 'unknown' }, location: { mode: 'clear' } },
  lots: [],
  parts: [],
  notes: [],
  observations: [],
  cursor: { stream_id: '50000000-0000-4000-8000-000000000005', sequence: '0' },
}
const review: OperatorReviewDto = {
  revision: '1',
  lots: [],
  retired_lots: [],
  instructions: [],
} as unknown as OperatorReviewDto

type Save = {
  change: CaptureBatchSettingsChangeDto
  revision: string
  key: string
  resolve: (snapshot: CaptureSnapshotDto) => void
  reject: (error: unknown) => void
}

let saves: Save[]
let instructs: { text: string; revision: string; key: string; resolve: () => void }[]

function nextSnapshot(base: CaptureSnapshotDto, save: Save): CaptureSnapshotDto {
  return { ...base, title: save.change.title, revision: (BigInt(save.revision) + 1n).toString() }
}

function Host({
  initial = batch,
  connected = true,
  read,
  onDirtyChange = () => undefined,
  catalogue,
  observe = async () => null,
  operatorReview = review,
  withoutReview = false,
  uploadLogo,
}: {
  initial?: CaptureSnapshotDto
  connected?: boolean
  read?: () => Promise<CaptureSnapshotDto>
  onDirtyChange?: (dirty: boolean) => void
  catalogue?: CatalogueClient
  observe?: (model: string, pk: string) => Promise<CaptureObservationDto | null>
  operatorReview?: OperatorReviewDto
  withoutReview?: boolean
  uploadLogo?: SettingsPorts['uploadLogo']
}) {
  const [current, setCurrent] = useState(initial)
  const ports: SettingsPorts = {
    connected,
    save: (change, revision, key) =>
      new Promise((resolve, reject) => saves.push({ change, revision, key, resolve, reject })),
    accept: (snapshot) => setCurrent(snapshot),
    read: read ?? (async () => current),
    instruct: (text, revision, key) =>
      new Promise((resolve) =>
        instructs.push({
          text,
          revision,
          key,
          resolve: () => resolve({ ...review, revision: (BigInt(revision) + 1n).toString() }),
        }),
      ),
    catalogue,
    uploadLogo,
  }
  return (
    <ApiClientsProvider value={{ operator: {} as never }}>
      <BatchCommandsProvider
        value={batchCommands({ edit: vi.fn(async () => true), observe: observe as never })}
      >
        <CaptureWorkspace
          batch={current}
          busy={false}
          operatorReview={withoutReview ? undefined : operatorReview}
          onDirtyChange={onDirtyChange}
          settings={ports}
        />
      </BatchCommandsProvider>
    </ApiClientsProvider>
  )
}

const settle = () => act(() => vi.advanceTimersByTimeAsync(0))

const idle = () => act(() => vi.advanceTimersByTimeAsync(500))

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  saves = []
  instructs = []
})
afterEach(() => vi.useRealTimers())

function setup(props: Parameters<typeof Host>[0] = {}) {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const view = render(<Host {...props} />)
  const panel = screen.getByRole('region', { name: 'Batch settings' })
  return { user, view, panel, title: within(panel).getByLabelText('Batch title') }
}

test('the panel has the simplified fields, no explicit save and the disabled PO directly below supplier', async () => {
  const { panel } = setup()
  expect(within(panel).queryByRole('button', { name: /^Save/ })).not.toBeInTheDocument()
  expect(
    within(panel).queryByRole('button', { name: /Discard Batch settings/ }),
  ).not.toBeInTheDocument()
  expect(within(panel).queryByText(/Quantity/)).not.toBeInTheDocument()
  expect(within(panel).queryByLabelText(/Note relates to/)).not.toBeInTheDocument()
  expect(within(panel).queryByLabelText(/Capture tags mode/)).not.toBeInTheDocument()
  const supplier = within(panel).getByRole('combobox', { name: 'Supplier' })
  const po = within(panel).getByRole('checkbox', { name: 'Create a purchase order in InvenTree' })
  const tags = within(panel).getByRole('textbox', { name: 'Add a tag to every Part' })
  expect(po).toHaveAttribute('aria-disabled', 'true')
  expect(po).toHaveAccessibleDescription(/Purchase-order creation is not yet available/)
  expect(supplier.compareDocumentPosition(po) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(po.compareDocumentPosition(tags) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(within(panel).getByRole('combobox', { name: 'Default location' })).toBeVisible()
  expect(within(panel).getByRole('textbox', { name: 'Custom instructions' })).toBeVisible()
})

test('typing waits for the idle debounce, then sends one complete batch_settings command', async () => {
  const dirty = vi.fn()
  const { user, title } = setup({ onDirtyChange: dirty })
  await user.type(title, ' draft')
  expect(dirty).toHaveBeenLastCalledWith(true)
  await act(() => vi.advanceTimersByTimeAsync(400))
  expect(saves).toHaveLength(0)
  await idle()
  expect(saves).toHaveLength(1)
  expect(saves[0]).toMatchObject({
    revision: '1',
    change: {
      kind: 'batch_settings',
      title: 'Two packets draft',
      default_location: { mode: 'clear' },
      notes: { batch: null, order: null },
      drafts: [],
    },
  })
  expect(saves[0].change.intent.order).toEqual({
    reference: { mode: 'auto' },
    purchase_date: { mode: 'auto' },
  })
  await act(async () => saves[0].resolve(nextSnapshot(batch, saves[0])))
  await settle()
  expect(savedRevision('Batch settings')).toBe('2')
  expect(dirty).toHaveBeenLastCalledWith(false)
})

test('blur flushes a valid edit immediately and focus survives the acknowledgement', async () => {
  const { user, title } = setup()
  await user.type(title, '!')
  await user.tab()
  await settle()
  expect(saves).toHaveLength(1)
  await user.click(title)
  await act(async () => saves[0].resolve(nextSnapshot(batch, saves[0])))
  await act(() => vi.advanceTimersByTimeAsync(5000))
  expect(screen.getByLabelText('Batch title')).toBe(title)
  expect(title).toHaveFocus()
  expect(title).toHaveValue('Two packets!')
})

test('a blank title is retained with feedback and never sent', async () => {
  const { user, title } = setup()
  await user.clear(title)
  await act(() => vi.advanceTimersByTimeAsync(2000))
  expect(saves).toHaveLength(0)
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a batch title.')
  expect(screen.getAllByRole('status').map((item) => item.textContent)).toContain(
    'Batch settings: Not saved · fix the highlighted fields',
  )
  await user.type(title, 'Renamed')
  await idle()
  expect(saves.map((item) => item.change.title)).toEqual(['Renamed'])
})

test('newer input during an in-flight save is sent later against the acknowledged revision', async () => {
  const { user, title } = setup()
  await user.type(title, ' A')
  await idle()
  await user.type(title, 'B')
  await idle()
  expect(saves).toHaveLength(1)
  await act(async () => saves[0].resolve(nextSnapshot(batch, saves[0])))
  await settle()
  expect(title).toHaveValue('Two packets AB')
  expect(savedRevision('Batch settings')).not.toBe('2')
  expect(saves[1]).toMatchObject({ revision: '2', change: { title: 'Two packets AB' } })
  expect(saves[1].key).not.toBe(saves[0].key)
})

test('IME composition pauses autosave until the composed text is complete', async () => {
  const { title } = setup()
  fireEvent.compositionStart(title)
  fireEvent.change(title, { target: { value: 'Two packets で' } })
  await act(() => vi.advanceTimersByTimeAsync(2000))
  expect(saves).toHaveLength(0)
  fireEvent.change(title, { target: { value: 'Two packets 電子' } })
  fireEvent.compositionEnd(title)
  await idle()
  expect(saves.map((item) => item.change.title)).toEqual(['Two packets 電子'])
})

test('an uncertain acknowledgement freezes the exact request and offers exact retry only', async () => {
  const { user, title } = setup()
  await user.type(title, ' A')
  await idle()
  await act(async () => saves[0].reject(new TypeError('network')))
  await settle()
  expect(screen.getByRole('alert')).toHaveTextContent('Save not confirmed')
  await user.type(title, 'B')
  await idle()
  expect(saves).toHaveLength(1)
  await user.click(screen.getByRole('button', { name: 'Retry the same save' }))
  await settle()
  expect(saves[1]).toEqual({ ...saves[0], resolve: saves[1].resolve, reject: saves[1].reject })
  expect(title).toHaveValue('Two packets AB')
})

test('a conflict keeps local input and only an explicit choice sends it over the newer revision', async () => {
  const newer = { ...batch, revision: '5', title: 'Other operator' }
  const { user, title } = setup({ read: async () => newer })
  await user.type(title, ' A')
  await idle()
  await act(async () => saves[0].reject(new IntakeRequestError(412, 'revision_conflict')))
  await settle()
  expect(screen.getByRole('alert')).toHaveTextContent('another change was saved first')
  expect(title).toHaveValue('Two packets A')
  await act(() => vi.advanceTimersByTimeAsync(5000))
  expect(saves).toHaveLength(1)
  await user.click(
    screen.getByRole('button', { name: 'Keep my edits and save them over the newer version' }),
  )
  await settle()
  expect(saves[1]).toMatchObject({ revision: '5', change: { title: 'Two packets A' } })
})

test('custom instructions save separately in the same serialized revision queue', async () => {
  const { user, title, panel } = setup()
  await user.type(title, ' A')
  await user.type(within(panel).getByRole('textbox', { name: 'Custom instructions' }), 'Keep lots')
  await idle()
  expect(saves).toHaveLength(1)
  expect(instructs).toHaveLength(0)
  await act(async () => saves[0].resolve(nextSnapshot(batch, saves[0])))
  await settle()
  expect(instructs).toEqual([expect.objectContaining({ text: 'Keep lots', revision: '2' })])
  expect(savedRevision('Batch settings')).toBe('2')
  expect(screen.getAllByRole('status').map((item) => item.textContent)).toContain(
    'Custom instructions: Saving…',
  )
})

test('a disconnected API disables fields, keeps drafts and reads before resuming', async () => {
  const read = vi.fn(async () => batch)
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const view = render(<Host read={read} />)
  const title = screen.getByLabelText('Batch title')
  await user.type(title, ' A')
  view.rerender(<Host read={read} connected={false} />)
  await idle()
  expect(saves).toHaveLength(0)
  expect(screen.getByLabelText('Batch title')).toBeDisabled()
  expect(screen.getByLabelText('Batch title')).toHaveValue('Two packets A')
  expect(screen.getByText(/Application connection unavailable/)).toBeVisible()
  read.mockClear()
  view.rerender(<Host read={read} connected />)
  await settle()
  expect(read).toHaveBeenCalledOnce()
  expect(saves.map((item) => item.change.title)).toEqual(['Two packets A'])
})

test('a clean panel follows newer saved values but a dirty one keeps its draft', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

  function Polling({ value }: { value: CaptureSnapshotDto }) {
    return <Host key="host" initial={value} />
  }

  const view = render(<Polling value={batch} />)
  expect(screen.getByLabelText('Batch title')).toHaveValue('Two packets')
  view.unmount()
  const ports = {
    connected: true,
    save: vi.fn(() => new Promise<CaptureSnapshotDto>(() => undefined)),
    accept: vi.fn(),
    read: vi.fn(async () => batch),
  }
  const shown = render(
    <BatchCommandsProvider value={batchCommands({ edit: vi.fn(), observe: vi.fn() })}>
      <CaptureWorkspace batch={batch} busy={false} settings={ports} />
    </BatchCommandsProvider>,
  )
  const newer = { ...batch, revision: '3', title: 'Renamed elsewhere' }
  shown.rerender(
    <BatchCommandsProvider value={batchCommands({ edit: vi.fn(), observe: vi.fn() })}>
      <CaptureWorkspace batch={newer} busy={false} settings={ports} />
    </BatchCommandsProvider>,
  )
  await settle()
  expect(screen.getByLabelText('Batch title')).toHaveValue('Renamed elsewhere')
  await user.type(screen.getByLabelText('Batch title'), ' mine')
  shown.rerender(
    <BatchCommandsProvider value={batchCommands({ edit: vi.fn(), observe: vi.fn() })}>
      <CaptureWorkspace
        batch={{ ...newer, revision: '4', title: 'Third' }}
        busy={false}
        settings={ports}
      />
    </BatchCommandsProvider>,
  )
  await settle()
  expect(screen.getByLabelText('Batch title')).toHaveValue('Renamed elsewhere mine')
})

test('batch notes are always shown, autosave, and clearing them sends a tombstone', async () => {
  const { user } = setup()
  // Batch settings owns the field; Capture draws it in the evidence card.
  const notes = screen.getByRole('textbox', { name: 'Notes for the whole batch' })
  expect(notes).toHaveAccessibleDescription(
    'Plain language is fine. Agents read these notes while they work.',
  )
  await user.type(notes, 'Two bags')
  await idle()
  expect(saves[0].change.notes).toEqual({ batch: 'Two bags', order: null })
  await act(async () => saves[0].resolve(nextSnapshot(batch, saves[0])))
  await settle()
  await user.clear(notes)
  await idle()
  expect(saves[1].change.notes).toEqual({ batch: null, order: null })
})

test('a fuzzy supplier suggestion is observed before retention; No supplier keeps it recoverable', async () => {
  const supplier = {
    kind: 'supplier' as const,
    pk: '7',
    name: 'Mouser Electronics',
    description: '',
    manufacturer: false,
  }
  const catalogue = {
    candidates: vi.fn(async () => ({
      model: 'supplier' as const,
      target_context_id: fixtureScope.targetContextId,
      candidates: [supplier],
      coverage: { loaded: 1, total: 1, truncated: false },
    })),
    search: vi.fn(async (_id: string, model: 'location' | 'supplier', q: string) => ({
      model,
      target_context_id: fixtureScope.targetContextId,
      query: q,
      results: [],
      coverage: { loaded: 0, total: 0, truncated: false },
      exact_id: { status: 'not_requested' as const },
    })),
  } as unknown as CatalogueClient
  const observation = {
    id: '70000000-0000-4000-8000-000000000007',
    model: 'company',
    pk: '7',
    target_context_id: fixtureScope.targetContextId,
    label: 'Mouser Electronics',
    mapping: { kind: 'company', supplier: true },
  } as unknown as CaptureObservationDto
  const observe = vi.fn(async () => observation)
  const { user, panel } = setup({ catalogue, observe })
  await user.type(within(panel).getByRole('combobox', { name: 'Supplier' }), 'Mousr')
  await user.click(await screen.findByRole('option', { name: /Mouser Electronics · #7/ }))
  await settle()
  expect(observe).toHaveBeenCalledWith('company', '7')
  expect(saves[0].change.intent.supplier).toEqual({
    absent: false,
    selection: {
      mode: 'existing',
      reference: {
        observation_id: observation.id,
        target_context_id: fixtureScope.targetContextId,
        model: 'company',
        pk: '7',
      },
    },
  })
  await act(async () => saves[0].resolve(nextSnapshot(batch, saves[0])))
  await settle()
  await user.click(within(panel).getByRole('checkbox', { name: 'No supplier' }))
  await settle()
  expect(saves[1].change.intent.supplier).toMatchObject({
    absent: true,
    selection: { mode: 'existing' },
  })
  expect(within(panel).getByRole('combobox', { name: 'Supplier' })).toBeDisabled()
})

test('socket-only failure with HTTP fallback keeps settings editable and saving', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(
    <UpdateHealthContext.Provider value={{ state: 'polling', observedAt: null, truncated: false }}>
      <Host />
    </UpdateHealthContext.Provider>,
  )
  const title = screen.getByLabelText('Batch title')
  expect(title).toBeEnabled()
  await user.type(title, ' A')
  await idle()
  expect(saves.map((item) => item.change.title)).toEqual(['Two packets A'])
})

test('a target-only failure disables search but not title autosave or the current selection', async () => {
  const catalogue = {
    candidates: vi.fn(async () => {
      throw new IntakeRequestError(503, 'catalogue_unavailable')
    }),
    search: vi.fn(async () => {
      throw new IntakeRequestError(503, 'catalogue_unavailable')
    }),
  } as unknown as CatalogueClient
  const { user, title, panel } = setup({ catalogue })
  expect(await within(panel).findByText(/Supplier search unavailable/)).toBeVisible()
  expect(within(panel).getByText(/Default location search unavailable/)).toBeVisible()
  expect(within(panel).queryByText(/No matches/)).not.toBeInTheDocument()
  await user.type(title, ' A')
  await idle()
  expect(saves.map((item) => item.change.title)).toEqual(['Two packets A'])
})

test('lot overrides stay visible and link to the pinned Review subject', () => {
  const lotId = '60000000-0000-4000-8000-000000000009'
  setup({
    initial: {
      ...batch,
      lots: [
        {
          id: lotId,
          label: 'Packet A',
          revision: '1',
          contribution_key: '80000000-0000-4000-8000-000000000008',
          part_subject_id: null,
          quantity: { mode: 'set', value: '3' },
          location: { mode: 'clear' },
        },
      ],
    },
  })
  // The override and the Proposed lots glance both open the lot in Review.
  const links = screen.getAllByRole('link', { name: 'Packet A' })
  expect(links.length).toBeGreaterThan(0)
  for (const link of links) {
    expect(link).toHaveAttribute('href', `#${batch.id}/review/lots/${lotId}`)
  }
  expect(screen.getByText(/1 lot overrides this:/)).toHaveTextContent(
    '1 lot overrides this: Packet A.',
  )
})

const savedInstruction = {
  group_id: null,
  text: 'Keep date codes apart.',
  version: '4',
  actor_id: batch.actor_id,
  created_at: '2026-11-03T00:00:00Z',
}

test('saved instructions that load after Capture populate the clean textbox', async () => {
  const view = render(<Host withoutReview />)
  expect(screen.queryByRole('textbox', { name: 'Custom instructions' })).not.toBeInTheDocument()
  view.rerender(
    <Host operatorReview={{ ...review, instructions: [savedInstruction] } as OperatorReviewDto} />,
  )
  await settle()
  expect(screen.getByRole('textbox', { name: 'Custom instructions' })).toHaveValue(
    'Keep date codes apart.',
  )
})

test('composed instructions are saved and stay dirty while composing', async () => {
  const dirty = vi.fn()
  const { title, panel } = setup({ onDirtyChange: dirty })
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  await user.type(title, ' A')
  await idle()
  const text = within(panel).getByRole('textbox', { name: 'Custom instructions' })
  fireEvent.compositionStart(text)
  fireEvent.change(text, { target: { value: '電子' } })
  await act(async () => saves[0].resolve(nextSnapshot(batch, saves[0])))
  await settle()
  expect(dirty).toHaveBeenLastCalledWith(true)
  await act(() => vi.advanceTimersByTimeAsync(2000))
  expect(instructs).toHaveLength(0)
  fireEvent.compositionEnd(text)
  await idle()
  expect(instructs.map((item) => item.text)).toEqual(['電子'])
})

test('a rerender during reconnection cannot release writes before the read completes', async () => {
  let finish = () => undefined as void

  const read = vi.fn(
    () =>
      new Promise<CaptureSnapshotDto>((resolve) => {
        finish = () => resolve(batch)
      }),
  )
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const view = render(<Host read={read} />)
  await user.type(screen.getByLabelText('Batch title'), ' A')
  view.rerender(<Host read={read} connected={false} />)
  view.rerender(<Host read={read} connected />)
  view.rerender(<Host read={read} connected />)
  await idle()
  expect(saves).toHaveLength(0)
  expect(read).toHaveBeenCalledOnce()
  await act(async () => finish())
  await settle()
  expect(saves.map((item) => item.change.title)).toEqual(['Two packets A'])
})

test('a refused logo is reported and a replacement file can be chosen', async () => {
  const uploadLogo = vi.fn(async () => {
    throw new IntakeRequestError(415, 'unsupported_media')
  })
  const dirty = vi.fn()
  const { user, panel } = setup({ uploadLogo, onDirtyChange: dirty })
  const supplier = within(panel).getByRole('combobox', { name: 'Supplier' })
  await user.type(supplier, 'Rare Parts')
  await user.click(await screen.findByRole('option', { name: 'New supplier “Rare Parts”' }))
  await settle()
  await act(async () => saves[0].resolve(nextSnapshot(batch, saves[0])))
  await settle()
  const file = new File(['png'], 'logo.png', { type: 'image/png' })
  await user.upload(within(panel).getByLabelText('Supplier logo (optional)'), file)
  await settle()
  expect(uploadLogo).toHaveBeenCalledOnce()
  expect(await within(panel).findByText(/The logo was refused/)).toBeVisible()
  expect(within(panel).getByLabelText('Supplier logo (optional)')).toBeEnabled()
  expect(dirty).toHaveBeenLastCalledWith(false)
})

test('an unconfirmed logo upload says so until the same upload is retried', async () => {
  const uploadLogo = vi
    .fn()
    .mockRejectedValueOnce(new Error('lost'))
    .mockResolvedValueOnce({ evidence_id: 'e-logo', version: { id: 'v-logo' } })
  const dirty = vi.fn()
  const { user, panel } = setup({ uploadLogo, onDirtyChange: dirty })
  const supplier = within(panel).getByRole('combobox', { name: 'Supplier' })
  await user.type(supplier, 'Rare Parts')
  await user.click(await screen.findByRole('option', { name: 'New supplier “Rare Parts”' }))
  await settle()
  await act(async () => saves[0].resolve(nextSnapshot(batch, saves[0])))
  await settle()
  const file = new File(['png'], 'logo.png', { type: 'image/png' })
  await user.upload(within(panel).getByLabelText('Supplier logo (optional)'), file)
  await settle()
  const unconfirmed = 'Logo upload not confirmed. Retry the same upload or reload saved values.'
  expect(await within(panel).findByText(unconfirmed)).toBeVisible()
  expect(dirty).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'Retry the same save' }))
  await settle()
  expect(uploadLogo).toHaveBeenCalledTimes(2)
  expect(uploadLogo.mock.calls[1][3]).toBe(uploadLogo.mock.calls[0][3])
  expect(within(panel).queryByText(unconfirmed)).not.toBeInTheDocument()
})

test('composing in one field resumes the other lane once composition ends', async () => {
  const { title, panel, user } = setup()
  await user.type(title, ' A')
  await idle()
  const text = within(panel).getByRole('textbox', { name: 'Custom instructions' })
  await user.type(text, 'Keep apart')
  await idle()
  expect(instructs).toHaveLength(0)
  fireEvent.compositionStart(title)
  await act(async () => saves[0].resolve(nextSnapshot(batch, saves[0])))
  await act(() => vi.advanceTimersByTimeAsync(2000))
  expect(instructs).toHaveLength(0)
  fireEvent.change(title, { target: { value: 'Two packets A 電子' } })
  fireEvent.compositionEnd(title)
  await settle()
  expect(instructs.map((item) => item.text)).toEqual(['Keep apart'])
})

test('a reconnection read that settles after unmount never releases the old drafts', async () => {
  let finish = () => undefined as void

  const read = vi.fn(
    () =>
      new Promise<CaptureSnapshotDto>((resolve) => {
        finish = () => resolve(batch)
      }),
  )
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const view = render(<Host read={read} />)
  view.rerender(<Host read={read} connected={false} />)
  await user.type(screen.getByLabelText('Batch title'), ' offline')
  view.rerender(<Host read={read} connected />)
  view.unmount()
  await act(async () => finish())
  await act(() => vi.advanceTimersByTimeAsync(3000))
  expect(saves).toHaveLength(0)
})

function supplierCatalogue() {
  const record = (pk: string, name: string) => ({
    kind: 'supplier' as const,
    pk,
    name,
    description: '',
    manufacturer: false,
  })

  return {
    candidates: vi.fn(async () => ({
      model: 'supplier' as const,
      target_context_id: fixtureScope.targetContextId,
      candidates: [record('7', 'Mouser Electronics'), record('8', 'Digi-Key')],
      coverage: { loaded: 2, total: 2, truncated: false },
    })),
    search: vi.fn(async (_id: string, model: 'location' | 'supplier', q: string) => ({
      model,
      target_context_id: fixtureScope.targetContextId,
      query: q,
      results: [],
      coverage: { loaded: 0, total: 0, truncated: false },
      exact_id: { status: 'not_requested' as const },
    })),
  } as unknown as CatalogueClient
}

function observation(pk: string): CaptureObservationDto {
  return {
    id: `70000000-0000-4000-8000-${pk.padStart(12, '0')}`,
    model: 'company',
    pk,
    target_context_id: fixtureScope.targetContextId,
    label: `Supplier ${pk}`,
    mapping: { kind: 'company', supplier: true },
  } as unknown as CaptureObservationDto
}

test('a late supplier observation never overrides a newer No supplier or newer selection', async () => {
  const pending = new Map<string, (value: CaptureObservationDto) => void>()
  const observe = vi.fn(
    (_model: string, pk: string) =>
      new Promise<CaptureObservationDto | null>((resolve) => pending.set(pk, resolve)),
  )
  const { user, panel } = setup({ catalogue: supplierCatalogue(), observe })
  const picker = within(panel).getByRole('combobox', { name: 'Supplier' })
  await user.type(picker, 'Mous')
  await user.click(await screen.findByRole('option', { name: /Mouser Electronics · #7/ }))
  await user.click(within(panel).getByRole('checkbox', { name: 'No supplier' }))
  await act(async () => pending.get('7')!(observation('7')))
  await idle()
  expect(saves.map((item) => item.change.intent.supplier)).toEqual([
    { absent: true, selection: { mode: 'unset' } },
  ])
  await act(async () => saves[0].resolve(nextSnapshot(batch, saves[0])))
  await user.click(within(panel).getByRole('checkbox', { name: 'No supplier' }))
  await idle()
  await act(async () => saves[1].resolve(nextSnapshot(batch, saves[1])))
  await user.type(picker, 'Mous')
  await user.click(await screen.findByRole('option', { name: /Mouser Electronics · #7/ }))
  await user.type(picker, 'Digi')
  await user.click(await screen.findByRole('option', { name: /Digi-Key · #8/ }))
  await act(async () => pending.get('8')!(observation('8')))
  await act(async () => pending.get('7')!(observation('7')))
  await idle()
  expect(saves.at(-1)!.change.intent.supplier).toMatchObject({
    absent: false,
    selection: { mode: 'existing', reference: { pk: '8' } },
  })
})

test('a late location observation keeps a supplier draft created while it was pending', async () => {
  let release = () => undefined as void

  const location = {
    kind: 'location' as const,
    pk: '41',
    name: 'Drawer',
    description: '',
    path: 'Bench/Drawer',
    parent_pk: null,
    structural: false,
  }
  const catalogue = {
    candidates: vi.fn(async (_id: string, model: 'location' | 'supplier') => ({
      model,
      target_context_id: fixtureScope.targetContextId,
      candidates: model === 'location' ? [location] : [],
      coverage: { loaded: 1, total: 1, truncated: false },
    })),
    search: supplierCatalogue().search,
  } as unknown as CatalogueClient
  const observe = vi.fn(
    (model: string, pk: string) =>
      new Promise<CaptureObservationDto | null>((resolve) => {
        release = () =>
          resolve({ ...observation(pk), model, mapping: { kind: 'location' } } as never)
      }),
  )
  const { user, panel } = setup({ catalogue, observe })
  await user.type(within(panel).getByRole('combobox', { name: 'Default location' }), 'Draw')
  await user.click(await screen.findByRole('option', { name: /Drawer/ }))
  await user.type(within(panel).getByRole('combobox', { name: 'Supplier' }), 'Rare Parts')
  await user.click(await screen.findByRole('option', { name: 'New supplier “Rare Parts”' }))
  await act(async () => release())
  await idle()
  for (let index = 0; index < saves.length; index += 1) {
    await act(async () => saves[index].resolve(nextSnapshot(batch, saves[index])))
    await idle()
  }
  const last = saves.at(-1)!.change
  expect(last.default_location).toMatchObject({ mode: 'set', value: { pk: '41' } })
  expect(last.intent.supplier.selection.mode).toBe('draft')
  expect(last.drafts.map((item) => item.kind)).toEqual(['company'])
})

test('typed tag text protects navigation before it is added', async () => {
  const dirty = vi.fn()
  const { user, panel } = setup({ onDirtyChange: dirty })
  const tag = within(panel).getByRole('textbox', { name: 'Add a tag to every Part' })
  await user.type(tag, 'bench')
  expect(dirty).toHaveBeenLastCalledWith(true)
  expect(saves).toHaveLength(0)
  await user.clear(tag)
  expect(dirty).toHaveBeenLastCalledWith(false)
  await user.type(tag, 'bench{Enter}')
  await settle()
  expect(saves[0].change.intent.shared_tags.manual).toEqual(['bench'])
  await act(async () => saves[0].resolve(nextSnapshot(batch, saves[0])))
  await settle()
  expect(dirty).toHaveBeenLastCalledWith(false)
})

test('instructions that arrive later become the saved baseline, so clearing them is sent', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const view = render(<Host />)
  view.rerender(
    <Host operatorReview={{ ...review, instructions: [savedInstruction] } as OperatorReviewDto} />,
  )
  await settle()
  const text = screen.getByRole('textbox', { name: 'Custom instructions' })
  expect(text).toHaveValue('Keep date codes apart.')
  await user.clear(text)
  await idle()
  expect(instructs.map((item) => item.text)).toEqual([''])
})

test('unsent drafts can be discarded locally while the connection is unavailable', async () => {
  const dirty = vi.fn()
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const view = render(<Host onDirtyChange={dirty} />)
  // Typing without leaving the field keeps the edit unsent; leaving it would flush the save.
  await user.type(screen.getByRole('textbox', { name: 'Custom instructions' }), 'Draft')
  view.rerender(<Host onDirtyChange={dirty} connected={false} />)
  await idle()
  expect(screen.getByRole('textbox', { name: 'Custom instructions' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Discard unsent settings edits' }))
  expect(screen.getByRole('textbox', { name: 'Custom instructions' })).toHaveValue('')
  expect(dirty).toHaveBeenLastCalledWith(false)
  expect(saves).toHaveLength(0)
  expect(instructs).toHaveLength(0)
})

test('a locally discarded unsent title returns to the saved value', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const view = render(<Host />)
  await user.type(screen.getByLabelText('Batch title'), ' offline')
  view.rerender(<Host connected={false} />)
  await user.click(screen.getByRole('button', { name: 'Discard unsent settings edits' }))
  expect(screen.getByLabelText('Batch title')).toHaveValue('Two packets')
  view.rerender(<Host />)
  await act(() => vi.advanceTimersByTimeAsync(3000))
  expect(saves).toHaveLength(0)
})

test('a newer saved instruction from elsewhere replaces an acknowledged local edit without resending it', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const view = render(<Host />)
  const text = screen.getByRole('textbox', { name: 'Custom instructions' })
  await user.type(text, 'Mine')
  await idle()
  await act(async () => instructs[0].resolve())
  await settle()
  const external = { ...savedInstruction, text: 'From another client', version: '9' }
  view.rerender(
    <Host
      operatorReview={{ ...review, revision: '3', instructions: [external] } as OperatorReviewDto}
    />,
  )
  await act(() => vi.advanceTimersByTimeAsync(3000))
  expect(text).toHaveValue('From another client')
  expect(instructs.map((item) => item.text)).toEqual(['Mine'])
})

test('local discard while disconnected also clears tag text not yet added', async () => {
  const dirty = vi.fn()
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const view = render(<Host onDirtyChange={dirty} />)
  const tag = screen.getByRole('textbox', { name: 'Add a tag to every Part' })
  await user.type(tag, 'bench{Enter}')
  await settle()
  await act(async () => saves[0].resolve(nextSnapshot(batch, saves[0])))
  await settle()
  // A refused duplicate keeps its text pending, even after the disconnect blurs the input.
  await user.type(tag, 'Bench{Enter}')
  view.rerender(<Host onDirtyChange={dirty} connected={false} />)
  await user.click(screen.getByRole('button', { name: 'Discard unsent settings edits' }))
  expect(screen.getByRole('textbox', { name: 'Add a tag to every Part' })).toHaveValue('')
  expect(dirty).toHaveBeenLastCalledWith(false)
  expect(saves).toHaveLength(1)
})

test('typed tag text reaches the navigation owner before the next render commits', () => {
  const log: string[] = []
  render(
    <Profiler id="capture" onRender={() => log.push('commit')}>
      <Host onDirtyChange={(dirty) => log.push(`dirty:${dirty}`)} />
    </Profiler>,
  )
  log.length = 0
  fireEvent.change(screen.getByRole('textbox', { name: 'Add a tag to every Part' }), {
    target: { value: 'b' },
  })
  expect(log[0]).toBe('dirty:true')
})

test('local discard restores the acknowledged instructions even when the follow-up read failed', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const read = vi.fn(async () => {
    throw new TypeError('offline')
  })
  const view = render(<Host read={read} />)
  const text = screen.getByRole('textbox', { name: 'Custom instructions' })
  await user.type(text, 'Saved text')
  await idle()
  await act(async () => instructs[0].resolve())
  await settle()
  await user.type(text, ' unsent')
  view.rerender(<Host read={read} connected={false} />)
  await user.click(screen.getByRole('button', { name: 'Discard unsent settings edits' }))
  expect(screen.getByRole('textbox', { name: 'Custom instructions' })).toHaveValue('Saved text')
})

test('a newer snapshot after an instruction acknowledgement keeps text being composed', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const read = vi.fn(async () => ({ ...batch, title: 'External saved title', revision: '5' }))
  render(<Host read={read} />)
  const text = screen.getByRole('textbox', { name: 'Custom instructions' })
  await user.type(text, 'Keep apart')
  await idle()
  const title = screen.getByLabelText('Batch title')
  fireEvent.compositionStart(title)
  fireEvent.change(title, { target: { value: 'In-progress IME title' } })
  await act(async () => instructs[0].resolve())
  await settle()
  expect(read).toHaveBeenCalled()
  expect(title).toHaveValue('In-progress IME title')
  fireEvent.compositionEnd(title)
  await idle()
  expect(title).toHaveValue('In-progress IME title')
})

test('a read started before a second disconnect is dropped, and reconnection reads again', async () => {
  const finish: Array<() => void> = []
  const read = vi.fn(
    () =>
      new Promise<CaptureSnapshotDto>((resolve) => {
        finish.push(() => resolve(batch))
      }),
  )
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const view = render(<Host read={read} />)
  await user.type(screen.getByLabelText('Batch title'), ' A')
  view.rerender(<Host read={read} connected={false} />)
  view.rerender(<Host read={read} connected />)
  view.rerender(<Host read={read} connected={false} />)
  view.rerender(<Host read={read} connected />)
  await idle()
  expect(read).toHaveBeenCalledTimes(2)
  await act(async () => finish[0]())
  await settle()
  expect(saves).toHaveLength(0)
  await act(async () => finish[1]())
  await settle()
  expect(saves.map((item) => item.change.title)).toEqual(['Two packets A'])
})

test('unmounting while a failed reconnection read waits to retry leaves no timer behind', async () => {
  const read = vi.fn(async () => Promise.reject(new Error('down')))
  const scheduled = vi.spyOn(globalThis, 'setTimeout')
  const cleared = vi.spyOn(globalThis, 'clearTimeout')
  const view = render(<Host read={read} />)
  view.rerender(<Host read={read} connected={false} />)
  view.rerender(<Host read={read} connected />)
  await settle()
  expect(read).toHaveBeenCalledOnce()
  const retryAt = scheduled.mock.calls.findIndex(([, delay]) => delay === 2000)
  expect(retryAt).toBeGreaterThanOrEqual(0)
  view.unmount()
  expect(cleared).toHaveBeenCalledWith(scheduled.mock.results[retryAt].value)
  await act(() => vi.advanceTimersByTimeAsync(5000))
  expect(read).toHaveBeenCalledOnce()
})

test('the instructions lane registers when the review projection arrives after Capture', async () => {
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  const view = render(<Host withoutReview />)
  view.rerender(<Host operatorReview={review} />)
  await settle()
  await user.type(screen.getByRole('textbox', { name: 'Custom instructions' }), 'Keep reels apart.')
  await act(() => vi.advanceTimersByTimeAsync(2000))
  expect(instructs.map((item) => item.text)).toEqual(['Keep reels apart.'])
})
