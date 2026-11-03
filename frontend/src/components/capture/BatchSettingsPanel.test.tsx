import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { render } from '../../test/render'
import { CaptureWorkspace } from './CaptureWorkspace'

const batch: CaptureSnapshotDto = {
  id: '10000000-0000-4000-8000-000000000001',
  source_id: '20000000-0000-4000-8000-000000000002',
  actor_id: '30000000-0000-4000-8000-000000000003',
  target_context_id: '40000000-0000-4000-8000-000000000004',
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

test('one always-visible panel saves title, defaults, context and note atomically without PO intent', async () => {
  const user = userEvent.setup()
  const edit = vi.fn(async () => undefined)
  render(
    <CaptureWorkspace batch={batch} busy={false} edit={edit} observe={vi.fn(async () => null)} />,
  )
  const panel = screen.getByRole('region', { name: 'Batch settings' })
  expect(screen.queryByRole('heading', { name: 'Shared details' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Batch defaults' })).not.toBeInTheDocument()
  const po = within(panel).getByRole('checkbox', { name: /Create a purchase order/ })
  expect(po).toBeDisabled()
  await user.clear(within(panel).getByLabelText('Batch title'))
  await user.type(within(panel).getByLabelText('Batch title'), 'Packet comparison')
  await user.selectOptions(within(panel).getByLabelText('Purchase date mode'), 'set')
  await user.type(within(panel).getByLabelText('Purchase date'), '2026-11-03')
  await user.selectOptions(within(panel).getByLabelText('Capture tags mode'), 'set')
  await user.type(within(panel).getByLabelText(/^Capture tags \(one per line\)/), 'bench\nreceipt')
  await user.type(within(panel).getByLabelText(/^Batch human note/), 'Separate physical lots.')
  await user.click(within(panel).getByRole('button', { name: 'Save Batch settings' }))
  expect(edit).toHaveBeenCalledExactlyOnceWith({
    kind: 'settings',
    title: 'Packet comparison',
    quantity: { mode: 'unknown' },
    location: { mode: 'clear' },
    context: {
      supplier: { mode: 'unset' },
      purchase_date: { mode: 'set', value: '2026-11-03' },
      tags: { mode: 'set', value: ['bench', 'receipt'] },
    },
    note: 'Separate physical lots.',
  })
})

test('polling preserves the mounted draft and explicit discard uses current retained settings', async () => {
  const user = userEvent.setup()
  const dirty = vi.fn()
  const props = {
    busy: false,
    edit: vi.fn(async () => undefined),
    observe: vi.fn(async () => null),
    onDirtyChange: dirty,
  }
  const view = render(<CaptureWorkspace {...props} batch={batch} />)
  const title = screen.getByLabelText('Batch title')
  await user.type(title, ' draft')
  expect(dirty).toHaveBeenLastCalledWith(true)
  view.rerender(
    <CaptureWorkspace {...props} batch={{ ...batch, revision: '2', title: 'Other operator' }} />,
  )
  expect(screen.getByLabelText('Batch title')).toBe(title)
  expect(title).toHaveValue('Two packets draft')
  await user.click(screen.getByRole('button', { name: 'Discard Batch settings edits' }))
  expect(title).toHaveValue('Other operator')
  expect(dirty).toHaveBeenLastCalledWith(false)
})

test('per-lot overrides remain visible and batch edits do not replace their identities', async () => {
  const user = userEvent.setup()
  const lotId = '60000000-0000-4000-8000-000000000006'
  const retained: CaptureSnapshotDto = {
    ...batch,
    lots: [
      {
        id: lotId,
        label: 'Opened packet',
        revision: '1',
        contribution_key: '70000000-0000-4000-8000-000000000007',
        part_subject_id: null,
        quantity: { mode: 'set', value: '0.000001' },
        location: { mode: 'inherit' },
      },
    ],
    context: [
      {
        id: '80000000-0000-4000-8000-000000000008',
        subject_id: lotId,
        version: '2',
        actor_id: batch.actor_id,
        created_at: batch.updated_at,
        value: {
          supplier: { mode: 'inherit' },
          purchase_date: { mode: 'unknown' },
          tags: { mode: 'set', value: ['keep-separate'] },
        },
      },
    ],
  }
  const edit = vi.fn(async () => undefined)
  render(
    <CaptureWorkspace
      batch={retained}
      busy={false}
      edit={edit}
      observe={vi.fn(async () => null)}
    />,
  )
  expect(screen.getByText('Capture tags: Override · keep-separate')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Edit lot Opened packet' }))
  const lotPanel = screen.getByRole('region', { name: 'Lot: Opened packet' })
  await user.selectOptions(within(lotPanel).getByLabelText('Purchase date mode'), 'clear')
  expect(within(lotPanel).getByLabelText(/^Exact quantity/)).toHaveValue('0.000001')
  await user.click(within(lotPanel).getByRole('button', { name: 'Save human changes' }))
  expect(edit).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'lot',
      id: lotId,
      context: {
        supplier: { mode: 'inherit' },
        purchase_date: { mode: 'clear' },
        tags: { mode: 'set', value: ['keep-separate'] },
      },
    }),
  )
})

test('the note action focuses the existing shared composer without replacing a settings draft', async () => {
  const user = userEvent.setup()
  render(
    <CaptureWorkspace
      batch={batch}
      busy={false}
      edit={vi.fn(async () => undefined)}
      observe={vi.fn(async () => null)}
    />,
  )
  await user.type(screen.getByLabelText('Batch title'), ' draft')
  await user.click(screen.getByRole('button', { name: 'Add note' }))
  expect(screen.getByLabelText(/^Batch human note/)).toHaveFocus()
  expect(screen.getByLabelText('Batch title')).toHaveValue('Two packets draft')
  expect(screen.getAllByLabelText(/^Batch human note/)).toHaveLength(1)
})
