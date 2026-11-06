import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { ServerStateProvider } from './components/query/ServerStateProvider'
import { createServerQueryClient } from './queries/client'
import { serverQueryKey } from './queries/scope'
import { fixtureScope } from './test/render'
import { beforeEach, expect, test, vi } from 'vitest'
import {
  validate,
  type CaptureSnapshotDto,
  type ManualWorkspaceDto,
  type OperatorImpactDto,
  type OperatorReviewDto,
} from '@invimport/contracts'
import { IntakeRequestError } from '@invimport/contracts/client'
import { render } from './test/render'
import { Batch } from './components/batches/Batch'
import type { Client } from './capture/client'
import { ManualWorkspace } from './components/review/ManualWorkspace'
import type { ManualClient } from './manual/types'
import type { OperatorReviewClient } from './operator/types'

/** The revision behind a "<label>: Saved" status; the number is kept off the visible text. */
function savedRevision(label: string) {
  return screen
    .queryAllByRole('status')
    .find((item) => item.textContent === `${label}: Saved`)
    ?.getAttribute('data-revision')
}

const batchId = '10000000-0000-4000-8000-000000000001'
const partId = '20000000-0000-4000-8000-000000000002'
const a = '30000000-0000-4000-8000-000000000003'
const b = '30000000-0000-4000-8000-000000000004'
const c = '30000000-0000-4000-8000-000000000005'
const d = '30000000-0000-4000-8000-000000000006'
const source = '40000000-0000-4000-8000-000000000004'
const actor = '50000000-0000-4000-8000-000000000005'
const context = '60000000-0000-4000-8000-000000000006'
const stream = '90000000-0000-4000-8000-000000000009'
const observedPart = 'd0000000-0000-4000-8000-000000000004'
const otherPart = 'd0000000-0000-4000-8000-000000000005'
const observedLocation = 'e0000000-0000-4000-8000-000000000005'
const warningDigest = 'c'.repeat(64)

function lot(id: string, label: string, key: string, part: string | null) {
  return {
    id,
    label,
    revision: '2',
    contribution_key: key,
    part_subject_id: part,
    quantity: { mode: 'set' as const, value: '17' },
    location: { mode: 'inherit' as const },
  }
}

const batch: CaptureSnapshotDto = {
  id: batchId,
  source_id: source,
  title: 'Operator review fixture',
  revision: '12',
  archived: false,
  updated_at: '2026-11-02T12:00:00Z',
  actor_id: actor,
  target_context_id: context,
  defaults: { quantity: { mode: 'unset' }, location: { mode: 'clear' } },
  parts: [
    {
      id: partId,
      label: 'Shared resistor',
      revision: '3',
      choice: {
        mode: 'set',
        value: {
          observation_id: observedPart,
          target_context_id: context,
          model: 'part',
          pk: '29',
        },
      },
    },
  ],
  lots: [
    lot(a, 'Packet A', '70000000-0000-4000-8000-000000000001', partId),
    lot(b, 'Packet B', '70000000-0000-4000-8000-000000000002', partId),
    lot(c, 'Original bag', '70000000-0000-4000-8000-000000000003', null),
    lot(d, 'Bag half', '70000000-0000-4000-8000-000000000004', null),
  ],
  notes: [
    {
      id: 'f0000000-0000-4000-8000-000000000001',
      subject_id: a,
      text: 'Counted 17 on the bench.',
      actor_id: actor,
      created_at: '2026-11-02T12:00:00Z',
      producer: 'human',
    },
    {
      id: 'f0000000-0000-4000-8000-000000000002',
      subject_id: c,
      text: 'Bag holds two date codes.',
      actor_id: actor,
      created_at: '2026-11-02T12:00:00Z',
      producer: 'human',
    },
  ],
  observations: [
    {
      id: observedPart,
      model: 'part',
      pk: '29',
      target_context_id: context,
      label: '100 Ω resistor',
      observed_at: '2026-11-02T12:00:00Z',
    },
    {
      id: otherPart,
      model: 'part',
      pk: '31',
      target_context_id: context,
      label: '100 Ω resistor, 1%',
      observed_at: '2026-11-02T12:00:00Z',
    },
    {
      id: observedLocation,
      model: 'location',
      pk: '43',
      target_context_id: context,
      label: 'Drawer 4',
      observed_at: '2026-11-02T12:00:00Z',
    },
  ],
  cursor: { stream_id: stream, sequence: '20' },
}

function operatorLot(
  id: string,
  label: string,
  overrides: Partial<OperatorReviewDto['lots'][number]>,
) {
  return {
    lot_id: id,
    label,
    part_subject_id: null,
    shared_lot_ids: [],
    review_state: 'unreviewed' as const,
    approved: false,
    issues: [],
    predecessor_lot_ids: [],
    ...overrides,
  }
}

const operatorReview: OperatorReviewDto = {
  batch_id: batchId,
  revision: '12',
  lots: [
    operatorLot(a, 'Packet A', {
      part_subject_id: partId,
      shared_lot_ids: [b],
      review_state: 'reviewed',
    }),
    operatorLot(b, 'Packet B', {
      part_subject_id: partId,
      shared_lot_ids: [a],
      issues: [
        {
          code: 'no_supporting_evidence',
          severity: 'warning',
          message: 'No note or linked media supports this lot.',
          subject_id: b,
          lot_id: b,
          run_id: null,
          dependency_digest: warningDigest,
          disposition: null,
        },
      ],
    }),
    operatorLot(d, 'Bag half', { review_state: 'changed_after_review', predecessor_lot_ids: [c] }),
  ],
  retired_lots: [
    {
      lot_id: c,
      label: 'Original bag',
      action: 'split',
      retired_revision: '11',
      successor_lot_ids: [d],
    },
  ],
  instructions: [],
  cursor: batch.cursor,
}

const workspace: ManualWorkspaceDto = {
  batch_id: batchId,
  revision: '12',
  supported: true,
  capability: 'owned-fake-stock/1',
  lots: [a, b, c, d].map((id) => ({ lot_id: id, reviewed: false, issues: [] })),
  runs: [],
  preparations: [],
  preparations_truncated: false,
  cursor: batch.cursor,
}

const impact: OperatorImpactDto = {
  invalidated_review_subject_ids: [a],
  affected_lot_ids: [a, b],
  affected_part_ids: [],
  stale_preparation_ids: [],
  retired_lot_ids: [],
  created_lots: [],
  created_part: null,
}

function manualClient(): ManualClient {
  return {
    workspace: vi.fn(async () => workspace),
    activity: vi.fn(async () => ({ runs: [], truncated: false })),
    review: vi.fn(async () => ({ reviewed_subject_ids: [], cursor: batch.cursor })),
    prepare: vi.fn(),
    approve: vi.fn(),
    run: vi.fn(),
    start: vi.fn(),
    cancel: vi.fn(),
    recover: vi.fn(),
  } as unknown as ManualClient
}

function operatorClient(): OperatorReviewClient {
  return {
    read: vi.fn(async () => operatorReview),
    dismiss: vi.fn(async () => operatorReview),
    bulkEdit: vi.fn(async (_id, input) => ({
      status: input.preview ? ('previewed' as const) : ('applied' as const),
      revision: input.preview ? '12' : '13',
      impact,
    })),
    restructure: vi.fn(async (_id, input) => ({
      status: input.preview ? ('previewed' as const) : ('applied' as const),
      revision: '12',
      impact,
    })),
    instruct: vi.fn(async () => operatorReview),
  }
}

function renderReview(
  overrides: { operator?: OperatorReviewClient; edit?: () => Promise<void> } = {},
) {
  const manual = manualClient()
  const operator = overrides.operator ?? operatorClient()
  const reload = vi.fn(async () => undefined)
  const edit = vi.fn(overrides.edit ?? (async () => undefined))
  const onDirtyChange = vi.fn()
  render(
    <ManualWorkspace
      batch={batch}
      client={manual}
      stage="review"
      edit={edit}
      navigate={vi.fn()}
      reload={reload}
      operatorReview={operatorReview}
      operator={operator}
      onDirtyChange={onDirtyChange}
    />,
  )
  return { manual, operator, reload, edit, onDirtyChange }
}

beforeEach(() => {
  history.replaceState(null, '', `#${batchId}/review/lots`)
})

test('fixtures satisfy the shared runtime contracts', () => {
  validate('CaptureSnapshot', batch)
  validate('OperatorReview', operatorReview)
  validate('ManualWorkspace', workspace)
  validate('OperatorImpact', impact)
})

test('filters persist in the URL and retired lots are history, not selectable', async () => {
  const user = userEvent.setup()
  renderReview()
  await screen.findByRole('checkbox', { name: 'Select Packet A' })
  expect(screen.queryByRole('checkbox', { name: 'Select Original bag' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /^Warnings/ }))
  expect(location.hash).toBe(`#${batchId}/review/lots?filter=warnings`)
  expect(screen.getByRole('checkbox', { name: 'Select Packet B' })).toBeVisible()
  expect(screen.queryByRole('checkbox', { name: 'Select Packet A' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: /^Retired/ }))
  const history = screen.getByRole('region', { name: 'Retired lot history' })
  expect(within(history).getByText('Original bag')).toBeVisible()
  expect(within(history).getByText(/Into Bag half/)).toBeVisible()
  expect(screen.queryByRole('checkbox', { name: 'Select Original bag' })).not.toBeInTheDocument()
})

test('a successor lot shows its predecessor evidence', async () => {
  const user = userEvent.setup()
  renderReview()
  await user.click(await screen.findByRole('button', { name: 'Inspect Bag half' }))
  expect(screen.getByText('From predecessor Original bag')).toBeVisible()
  expect(screen.getByText('Bag holds two date codes.')).toBeVisible()
  expect(location.hash).toBe(`#${batchId}/review/lots/${d}`)
})

test('a warning dismissal requires a reason and sends the exact digest', async () => {
  const user = userEvent.setup()
  const { operator, reload } = renderReview()
  await user.click(await screen.findByRole('button', { name: 'Inspect Packet B' }))
  await user.click(screen.getByRole('button', { name: 'Dismiss…' }))
  await user.click(screen.getByRole('button', { name: 'Dismiss with this reason' }))
  expect(await screen.findByText('Give a reason before dismissing.')).toBeVisible()
  expect(operator.dismiss).not.toHaveBeenCalled()
  await user.type(
    screen.getByLabelText('Why is this acceptable?'),
    '  Label photo is on the Part.  ',
  )
  await user.click(screen.getByRole('button', { name: 'Dismiss with this reason' }))
  await waitFor(() => expect(operator.dismiss).toHaveBeenCalledTimes(1))
  expect(operator.dismiss).toHaveBeenCalledWith(
    batchId,
    {
      expected_batch_revision: '12',
      subject_id: b,
      code: 'no_supporting_evidence',
      dependency_digest: warningDigest,
      reason: 'Label photo is on the Part.',
    },
    expect.any(String),
  )
  await waitFor(() => expect(reload).toHaveBeenCalled())
})

test('mark reviewed stays disabled while a selected lot has an open warning', async () => {
  const user = userEvent.setup()
  renderReview()
  await user.click(await screen.findByRole('checkbox', { name: 'Select Packet B' }))
  expect(screen.getByRole('button', { name: 'Mark selected reviewed' })).toBeDisabled()
  expect(screen.getByText('Fix or dismiss warnings in the selected lots first.')).toBeVisible()
})

test('a shared Part choice confirms every affected lot before saving', async () => {
  const user = userEvent.setup()
  const { edit } = renderReview()
  await user.click(await screen.findByRole('button', { name: 'Inspect Packet A' }))
  expect(screen.getByLabelText('Lots sharing this Part proposal')).toHaveTextContent(
    'Shared with 1 other lot: Packet B',
  )
  await user.click(screen.getByRole('button', { name: 'Compare matches' }))
  await user.click(screen.getByRole('button', { name: 'Use #31' }))
  const confirm = screen.getByRole('alertdialog', { name: 'Confirm shared Part choice' })
  expect(confirm).toHaveTextContent('This shared choice affects 2 lots: Packet A, Packet B.')
  expect(edit).not.toHaveBeenCalled()
  await user.click(within(confirm).getByRole('button', { name: 'Use #31 for 2 lots' }))
  expect(edit).toHaveBeenCalledWith({
    kind: 'part',
    id: partId,
    choice: {
      mode: 'set',
      value: { observation_id: otherPart, target_context_id: context, model: 'part', pk: '31' },
    },
  })
})

async function openTableAndSelect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('tab', { name: 'Table' }))
  expect(location.hash).toBe(`#${batchId}/review/lots?view=table`)
  const table = screen.getByRole('region', { name: 'Lot table' })
  await user.click(within(table).getByRole('checkbox', { name: 'Select Packet A' }))
  await user.click(within(table).getByRole('checkbox', { name: 'Select Packet B' }))
}

test('an uncertain dismissal retries the exact intent, then closes and reloads', async () => {
  const user = userEvent.setup()
  const operator = operatorClient()
  const dismiss = vi.mocked(operator.dismiss)
  dismiss.mockImplementationOnce(async () => {
    throw new TypeError('connection reset')
  })
  const { reload } = renderReview({ operator })
  await user.click(await screen.findByRole('button', { name: 'Inspect Packet B' }))
  await user.click(screen.getByRole('button', { name: 'Dismiss…' }))
  await user.type(screen.getByLabelText('Why is this acceptable?'), 'Checked on the bench.')
  await user.click(screen.getByRole('button', { name: 'Dismiss with this reason' }))
  await user.click(await screen.findByRole('button', { name: 'Retry exact dismissal' }))
  await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(2))
  expect(dismiss.mock.calls[1][1]).toEqual(dismiss.mock.calls[0][1])
  expect(dismiss.mock.calls[1][2]).toBe(dismiss.mock.calls[0][2])
  await waitFor(() => expect(reload).toHaveBeenCalled())
  expect(screen.queryByLabelText('Why is this acceptable?')).toBeNull()
})

test.each([new TypeError('connection reset'), new IntakeRequestError(500, 'internal_error')])(
  'bulk edit retries exact payload and key after %s',
  async (failure) => {
    const user = userEvent.setup()
    const operator = operatorClient()
    const apply = vi.mocked(operator.bulkEdit)
    apply.mockImplementationOnce(async () => ({ status: 'previewed', revision: '12', impact }))
    apply.mockImplementationOnce(async () => {
      throw failure
    })
    const { reload } = renderReview({ operator })
    await openTableAndSelect(user)
    await user.selectOptions(screen.getByLabelText('Quantity'), 'set')
    await user.type(screen.getByLabelText('Exact pieces for every selected lot'), '12.5')
    await user.selectOptions(screen.getByLabelText('Location'), `observation:${observedLocation}`)
    await user.click(screen.getByRole('button', { name: 'Preview bulk edit' }))
    const preview = await screen.findByRole('region', { name: 'Impact preview' })
    expect(preview).toHaveTextContent('Packet A, Packet B')
    expect(preview).toHaveTextContent('Bag half')
    const change = {
      quantity: { mode: 'set', value: '12.5' },
      location: {
        mode: 'set',
        value: {
          observation_id: observedLocation,
          target_context_id: context,
          model: 'location',
          pk: '43',
        },
      },
    }
    expect(apply.mock.calls[0][1]).toEqual({
      expected_revision: '12',
      preview: true,
      lot_ids: [a, b],
      change,
    })
    await user.click(screen.getByRole('button', { name: 'Apply to 2 lots' }))
    expect(await screen.findByText(/The outcome is not confirmed/)).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Retry exact bulk edit' }))
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(3))
    expect(apply.mock.calls[1][1]).toEqual({
      expected_revision: '12',
      preview: false,
      lot_ids: [a, b],
      change,
    })
    expect(apply.mock.calls[2][1]).toEqual(apply.mock.calls[1][1])
    expect(apply.mock.calls[2][2]).toBe(apply.mock.calls[1][2])
    await waitFor(() => expect(reload).toHaveBeenCalled())
  },
)

test('a conflicting bulk edit keeps the local input and does not reapply', async () => {
  const user = userEvent.setup()
  const operator = operatorClient()
  vi.mocked(operator.bulkEdit)
    .mockImplementationOnce(async () => ({ status: 'previewed', revision: '12', impact }))
    .mockImplementationOnce(async () => {
      throw new IntakeRequestError(412, 'revision_conflict')
    })
  const { reload } = renderReview({ operator })
  await openTableAndSelect(user)
  await user.selectOptions(screen.getByLabelText('Quantity'), 'set')
  await user.type(screen.getByLabelText('Exact pieces for every selected lot'), '9')
  await user.click(screen.getByRole('button', { name: 'Preview bulk edit' }))
  await user.click(await screen.findByRole('button', { name: 'Apply to 2 lots' }))
  expect(await screen.findByText(/Another client saved first/)).toBeVisible()
  expect(screen.getByLabelText('Exact pieces for every selected lot')).toHaveValue('9')
  expect(operator.bulkEdit).toHaveBeenCalledTimes(2)
  expect(reload).not.toHaveBeenCalled()
  await user.click(screen.getByRole('tab', { name: 'Evidence' }))
  expect(screen.getByLabelText('Exact pieces for every selected lot')).toHaveValue('9')
  expect(location.hash).toContain('view=table')
  await user.click(screen.getByRole('button', { name: 'Discard bulk edits' }))
  await user.click(screen.getByRole('tab', { name: 'Evidence' }))
  expect(screen.queryByLabelText('Exact pieces for every selected lot')).not.toBeInTheDocument()
})

test('keyboard shortcuts move and review, but never fire while typing', async () => {
  const user = userEvent.setup()
  const { manual } = renderReview()
  await screen.findByRole('button', { name: 'Inspect Packet A' })
  // Queue order is most urgent first: B (warning), Bag half (changed), A (reviewed).
  await user.keyboard('j')
  await waitFor(() => expect(location.hash).toContain(`/review/lots/${b}`))
  await user.keyboard('jj')
  await waitFor(() => expect(location.hash).toContain(`/review/lots/${a}`))
  await user.keyboard('k')
  await waitFor(() => expect(location.hash).toContain(`/review/lots/${d}`))
  await user.keyboard('e')
  const quantity = await screen.findByLabelText('Exact pieces')
  await waitFor(() => expect(quantity).toHaveFocus())
  await user.type(quantity, 'jkr')
  expect(location.hash).toContain(`/review/lots/${d}`)
  expect(manual.review).not.toHaveBeenCalled()
})

test('split sends exact decimal strings and merge requires explicit confirmation', async () => {
  const user = userEvent.setup()
  const { operator } = renderReview()
  await user.click(await screen.findByRole('button', { name: 'Inspect Bag half' }))
  await user.click(screen.getByRole('button', { name: 'Split lot…' }))
  const split = screen.getByRole('dialog', { name: 'Split lot' })
  await user.type(within(split).getByLabelText('New lot 1 quantity'), '0.000001')
  await user.type(within(split).getByLabelText('New lot 2 quantity'), '16.5')
  await user.click(within(split).getByRole('button', { name: 'Preview impact' }))
  await waitFor(() => expect(operator.restructure).toHaveBeenCalledTimes(1))
  expect(vi.mocked(operator.restructure).mock.calls[0][1]).toEqual({
    expected_revision: '12',
    preview: true,
    change: {
      kind: 'split_lot',
      lot_id: d,
      children: [
        { label: 'Bag half · 1', quantity: '0.000001' },
        { label: 'Bag half · 2', quantity: '16.5' },
      ],
    },
  })
  await user.click(within(split).getByRole('button', { name: 'Discard restructure edits' }))

  await user.click(screen.getByRole('tab', { name: 'Table' }))
  const table = screen.getByRole('region', { name: 'Lot table' })
  await user.click(within(table).getByRole('checkbox', { name: 'Select Packet B' }))
  await user.click(within(table).getByRole('checkbox', { name: 'Select Bag half' }))
  await user.click(screen.getByRole('button', { name: 'Merge selected…' }))
  const merge = screen.getByRole('dialog', { name: 'Merge lots' })
  await user.type(within(merge).getByLabelText('Merged lot quantity'), '40')
  await user.click(within(merge).getByRole('button', { name: 'Preview impact' }))
  expect(
    await within(merge).findByText('Confirm these rows are one physical contribution.'),
  ).toBeVisible()
  expect(operator.restructure).toHaveBeenCalledTimes(1)
  await user.click(within(merge).getByLabelText(/These are one physical contribution/))
  await user.click(within(merge).getByRole('button', { name: 'Preview impact' }))
  await waitFor(() => expect(operator.restructure).toHaveBeenCalledTimes(2))
  expect(vi.mocked(operator.restructure).mock.calls[1][1].change).toEqual({
    kind: 'merge_lots',
    lot_ids: [b, d],
    label: 'Packet B + Bag half',
    quantity: '40',
    part_subject_id: partId,
    confirm_same_physical_contribution: true,
  })
})

test('dirty lot drafts survive local navigation, keyboard movement and closing until explicit discard', async () => {
  const user = userEvent.setup()
  const { onDirtyChange } = renderReview()
  await user.click(await screen.findByRole('button', { name: 'Inspect Packet A' }))
  await user.click(screen.getByRole('button', { name: 'Edit lot values' }))
  const quantity = screen.getByLabelText('Exact pieces')
  await user.clear(quantity)
  await user.type(quantity, '123')
  await user.click(screen.getByRole('button', { name: 'Inspect Packet B' }))
  expect(quantity).toHaveValue('123')
  expect(location.hash).toContain(`/review/lots/${a}`)
  await user.click(screen.getByRole('tab', { name: 'Table' }))
  expect(quantity).toHaveValue('123')
  quantity.blur()
  await user.keyboard('k')
  expect(location.hash).toContain(`/review/lots/${a}`)
  expect(screen.getByRole('button', { name: 'Close lot editor' })).toBeDisabled()
  // Batch disables Archive from this report while the draft is dirty.
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  expect(screen.getByRole('button', { name: 'Compare matches' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Split lot…' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Discard lot edits' }))
  await user.click(screen.getByRole('button', { name: 'Inspect Packet B' }))
  expect(location.hash).toContain(`/review/lots/${b}`)
})

test('closing a clean sibling editor cannot clear a warning draft guard', async () => {
  const user = userEvent.setup()
  const { onDirtyChange } = renderReview()
  await user.click(await screen.findByRole('button', { name: 'Inspect Packet B' }))
  await user.click(screen.getByRole('button', { name: 'Edit lot values' }))
  await user.click(screen.getByRole('button', { name: 'Dismiss…' }))
  const reason = screen.getByLabelText('Why is this acceptable?')
  await user.type(reason, 'Keep this reason')
  await user.click(screen.getByRole('button', { name: 'Close lot editor' }))
  await user.click(screen.getByRole('tab', { name: 'Table' }))
  expect(reason).toHaveValue('Keep this reason')
  expect(location.hash).toContain(`/review/lots/${b}`)
  expect(onDirtyChange).toHaveBeenLastCalledWith(true)
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  await user.click(screen.getByRole('tab', { name: 'Table' }))
  expect(screen.getByRole('region', { name: 'Lot table' })).toBeVisible()
})

test('snapshot retirement hides lots while the operator projection is unavailable', async () => {
  const retiredBatch = {
    ...batch,
    lots: batch.lots.map((lot) => (lot.id === c ? { ...lot, retired: true as const } : lot)),
  }
  render(
    <ManualWorkspace
      batch={retiredBatch}
      client={manualClient()}
      stage="review"
      edit={vi.fn()}
      navigate={vi.fn()}
      reload={vi.fn()}
    />,
  )
  await screen.findByRole('checkbox', { name: 'Select Packet A' })
  expect(screen.queryByRole('checkbox', { name: 'Select Original bag' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Inspect Original bag' })).not.toBeInTheDocument()
})

test.each(['bulk', 'dismissal'] as const)(
  'a missing operator projection retains an uncertain %s intent and exact retry',
  async (kind) => {
    const user = userEvent.setup()
    const operator = operatorClient()
    const manual = manualClient()
    const reload = vi.fn(async () => undefined)

    const element = (projection: OperatorReviewDto | undefined) => (
      <ManualWorkspace
        batch={batch}
        client={manual}
        stage="review"
        edit={vi.fn()}
        navigate={vi.fn()}
        reload={reload}
        operatorReview={projection}
        operator={operator}
      />
    )

    const view = render(element(operatorReview))
    if (kind === 'bulk') {
      vi.mocked(operator.bulkEdit)
        .mockImplementationOnce(async () => ({ status: 'previewed', revision: '12', impact }))
        .mockRejectedValueOnce(new IntakeRequestError(500, 'internal_error'))
      await openTableAndSelect(user)
      await user.selectOptions(screen.getByLabelText('Quantity'), 'set')
      await user.type(screen.getByLabelText('Exact pieces for every selected lot'), '123')
      await user.click(screen.getByRole('button', { name: 'Preview bulk edit' }))
      await user.click(await screen.findByRole('button', { name: 'Apply to 2 lots' }))
      await screen.findByRole('button', { name: 'Retry exact bulk edit' })
      view.rerender(element(undefined))
      expect(screen.getByLabelText('Exact pieces for every selected lot')).toHaveValue('123')
      await user.click(screen.getByRole('button', { name: 'Retry exact bulk edit' }))
      await waitFor(() => expect(operator.bulkEdit).toHaveBeenCalledTimes(3))
      expect(vi.mocked(operator.bulkEdit).mock.calls[2]).toEqual(
        vi.mocked(operator.bulkEdit).mock.calls[1],
      )
    } else {
      vi.mocked(operator.dismiss).mockRejectedValueOnce(
        new IntakeRequestError(500, 'internal_error'),
      )
      await user.click(await screen.findByRole('button', { name: 'Inspect Packet B' }))
      await user.click(screen.getByRole('button', { name: 'Dismiss…' }))
      await user.type(screen.getByLabelText('Why is this acceptable?'), 'Retain this reason')
      await user.click(screen.getByRole('button', { name: 'Dismiss with this reason' }))
      await screen.findByRole('button', { name: 'Retry exact dismissal' })
      view.rerender(element(undefined))
      expect(screen.getByLabelText('Why is this acceptable?')).toHaveValue('Retain this reason')
      await user.click(screen.getByRole('button', { name: 'Retry exact dismissal' }))
      await waitFor(() => expect(operator.dismiss).toHaveBeenCalledTimes(2))
      expect(vi.mocked(operator.dismiss).mock.calls[1]).toEqual(
        vi.mocked(operator.dismiss).mock.calls[0],
      )
    }
  },
)

test.each(['bulk', 'split'] as const)(
  'pending %s previews freeze their fields and later edits invalidate the result',
  async (kind) => {
    const user = userEvent.setup()
    const operator = operatorClient()
    let finish!: (result: {
      status: 'previewed'
      revision: string
      impact: OperatorImpactDto
    }) => void
    const pending = new Promise<{
      status: 'previewed'
      revision: string
      impact: OperatorImpactDto
    }>((resolve) => {
      finish = resolve
    })
    renderReview({ operator })
    if (kind === 'bulk') {
      vi.mocked(operator.bulkEdit).mockImplementationOnce(() => pending)
      await openTableAndSelect(user)
      await user.selectOptions(screen.getByLabelText('Quantity'), 'set')
      const input = screen.getByLabelText('Exact pieces for every selected lot')
      await user.type(input, '5')
      await user.click(screen.getByRole('button', { name: 'Preview bulk edit' }))
      await waitFor(() => expect(operator.bulkEdit).toHaveBeenCalledTimes(1))
      expect(input).toBeDisabled()
      await user.type(input, '6')
      expect(input).toHaveValue('5')
      await act(async () => {
        finish({ status: 'previewed', revision: '12', impact })
      })
      await screen.findByRole('button', { name: 'Apply to 2 lots' })
      expect(input).toBeEnabled()
      await user.type(input, '6')
      expect(screen.queryByRole('button', { name: 'Apply to 2 lots' })).not.toBeInTheDocument()
    } else {
      vi.mocked(operator.restructure).mockImplementationOnce(() => pending)
      await user.click(await screen.findByRole('button', { name: 'Inspect Bag half' }))
      await user.click(screen.getByRole('button', { name: 'Split lot…' }))
      const input = screen.getByLabelText('New lot 1 quantity')
      await user.type(input, '5')
      await user.type(screen.getByLabelText('New lot 2 quantity'), '6')
      await user.click(screen.getByRole('button', { name: 'Preview impact' }))
      await waitFor(() => expect(operator.restructure).toHaveBeenCalledTimes(1))
      expect(input).toBeDisabled()
      await user.type(input, '7')
      expect(input).toHaveValue('5')
      await act(async () => {
        finish({ status: 'previewed', revision: '12', impact })
      })
      await screen.findByRole('button', { name: 'Apply split lot' })
      expect(input).toBeEnabled()
      await user.type(input, '7')
      expect(screen.queryByRole('button', { name: 'Apply split lot' })).not.toBeInTheDocument()
    }
  },
)

test('an actual Batch revision conflict retains the compared shared Part choice', async () => {
  history.replaceState(null, '', `#${batchId}/review/lots/${a}`)
  const user = userEvent.setup()
  const client = {
    read: vi.fn(async () => batch),
    edit: vi.fn(async () => {
      throw new IntakeRequestError(412, 'revision_conflict')
    }),
  } as unknown as Client
  render(
    <Batch
      id={batchId}
      route={`${batchId}/review/lots/${a}`}
      client={client}
      manual={manualClient()}
      operator={operatorClient()}
      onDirtyChange={vi.fn()}
    />,
  )
  await user.click(await screen.findByRole('button', { name: 'Compare matches' }))
  await user.click(screen.getByRole('button', { name: 'Use #31' }))
  await user.click(screen.getByRole('button', { name: 'Use #31 for 2 lots' }))
  await screen.findByText(/Another client saved first/)
  expect(screen.getByRole('dialog', { name: 'Compare matches · Shared resistor' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Use #31 for 2 lots' })).toBeVisible()
  expect(screen.getByRole('button', { name: 'Archive batch' })).toBeDisabled()
  expect(client.edit).toHaveBeenCalledTimes(1)
  await user.click(screen.getByRole('button', { name: 'Discard Part choice' }))
  await user.click(screen.getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

test.each(['quick', 'bulk'] as const)(
  'an unavailable projection permits explicit local %s discard without sending',
  async (kind) => {
    const user = userEvent.setup()
    const manual = manualClient()
    const operator = operatorClient()
    const edit = vi.fn()

    const element = (projection: OperatorReviewDto | undefined) => (
      <ManualWorkspace
        batch={batch}
        client={manual}
        stage="review"
        edit={edit}
        navigate={vi.fn()}
        reload={vi.fn()}
        operatorReview={projection}
        operator={operator}
      />
    )

    const view = render(element(operatorReview))
    if (kind === 'quick') {
      await user.click(await screen.findByRole('button', { name: 'Inspect Packet A' }))
      await user.click(screen.getByRole('button', { name: 'Edit lot values' }))
      await user.type(screen.getByLabelText('Exact pieces'), '3')
    } else {
      await openTableAndSelect(user)
      await user.selectOptions(screen.getByLabelText('Quantity'), 'set')
      await user.type(screen.getByLabelText('Exact pieces for every selected lot'), '123')
    }
    view.rerender(element(undefined))
    const discard = screen.getByRole('button', {
      name: kind === 'quick' ? 'Discard lot edits' : 'Discard bulk edits',
    })
    expect(discard).toBeEnabled()
    await user.click(discard)
    await user.click(screen.getByRole('tab', { name: kind === 'quick' ? 'Table' : 'Evidence' }))
    expect(edit).not.toHaveBeenCalled()
    expect(operator.bulkEdit).not.toHaveBeenCalled()
    expect(screen.queryByText(/Save or explicitly discard local edits/)).not.toBeInTheDocument()
  },
)

test('keyboard review cannot bypass an unavailable current operator projection', async () => {
  const user = userEvent.setup()
  const manual = manualClient()
  const operator = operatorClient()

  const element = (projection: OperatorReviewDto | undefined) => (
    <ManualWorkspace
      batch={batch}
      client={manual}
      stage="review"
      edit={vi.fn()}
      navigate={vi.fn()}
      reload={vi.fn()}
      operatorReview={projection}
      operator={operator}
    />
  )

  const view = render(element(operatorReview))
  await user.click(await screen.findByRole('button', { name: 'Inspect Packet A' }))
  view.rerender(element(undefined))
  await user.keyboard('r')
  expect(manual.review).not.toHaveBeenCalled()
})

test('Batch keeps an autosaved instruction draft after a foreign revision and recovers only explicitly', async () => {
  history.replaceState(null, '', `#${batchId}`)
  const cache = createServerQueryClient()
  const user = userEvent.setup()
  const client = { read: vi.fn(async () => batch), edit: vi.fn() } as unknown as Client
  const operator = operatorClient()
  vi.mocked(operator.instruct).mockRejectedValue(new IntakeRequestError(412, 'revision_conflict'))

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
      manual={manualClient()}
      operator={operator}
      onDirtyChange={vi.fn()}
    />,
    { wrapper: Wrapper },
  )
  const input = await screen.findByLabelText('Custom instructions')
  await user.type(input, 'Retain instructions')
  await waitFor(() => expect(operator.instruct).toHaveBeenCalledOnce())
  expect(vi.mocked(operator.instruct).mock.calls[0][1]).toEqual({
    expected_revision: batch.revision,
    group_id: null,
    text: 'Retain instructions',
  })
  expect(await screen.findByRole('alert')).toHaveTextContent('another change was saved first')
  expect(input).toHaveValue('Retain instructions')
  await user.type(input, ' still')
  await new Promise((resolve) => setTimeout(resolve, 700))
  expect(operator.instruct).toHaveBeenCalledOnce()
  vi.mocked(operator.read).mockResolvedValue({ ...operatorReview, revision: '13' })
  vi.mocked(client.read).mockResolvedValue({ ...batch, revision: '13' })
  await user.click(screen.getByRole('button', { name: 'Discard my edits and load saved values' }))
  await waitFor(() => expect(savedRevision('Batch settings')).toBe('13'))
  expect(screen.getByLabelText('Custom instructions')).toHaveValue('')
  expect(operator.instruct).toHaveBeenCalledOnce()
})

test('a polled operator projection at a newer revision keeps the instruction draft until explicit reload', async () => {
  history.replaceState(null, '', `#${batchId}`)
  const cache = createServerQueryClient()
  const user = userEvent.setup()
  const client = { read: vi.fn(async () => batch), edit: vi.fn() } as unknown as Client
  const operator = operatorClient()
  vi.mocked(operator.instruct).mockImplementation(() => new Promise(() => undefined))

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
      manual={manualClient()}
      operator={operator}
      onDirtyChange={vi.fn()}
    />,
    { wrapper: Wrapper },
  )
  const input = await screen.findByLabelText('Custom instructions')
  await user.type(input, 'Retain instructions')
  vi.mocked(operator.read).mockResolvedValue({ ...operatorReview, revision: '13' })
  vi.mocked(client.read).mockResolvedValue({ ...batch, revision: '13' })
  await act(async () => {
    cache.setQueryData(serverQueryKey(fixtureScope, 'operator-review', batchId), {
      ...operatorReview,
      revision: '13',
    })
  })
  expect(input).toHaveValue('Retain instructions')
  const reload = await screen.findByRole('button', {
    name: 'Discard local edits and load saved values',
  })
  await user.click(reload)
  await waitFor(() => expect(screen.getByLabelText('Custom instructions')).toHaveValue(''))
})

test('a lot the lead session forms waits behind a dirty Review draft, then appears once clean', async () => {
  const e = '30000000-0000-4000-8000-000000000007'
  history.replaceState(null, '', `#${batchId}/review/lots/${a}`)
  const cache = createServerQueryClient()
  const user = userEvent.setup()
  const client = { read: vi.fn(async () => batch), edit: vi.fn() } as unknown as Client
  const operator = operatorClient()
  const manual = manualClient()

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
      route={`${batchId}/review/lots/${a}`}
      client={client}
      manual={manual}
      operator={operator}
      onDirtyChange={vi.fn()}
    />,
    { wrapper: Wrapper },
  )
  await screen.findByRole('checkbox', { name: 'Select Packet A' })
  const next = {
    capture: {
      ...batch,
      revision: '13',
      lots: [
        ...batch.lots,
        {
          ...lot(e, 'LED reel', '70000000-0000-4000-8000-000000000013', null),
          origin: 'agent' as const,
          agent_session_id: '80000000-0000-4000-8000-000000000008',
        },
      ],
    },
    operator: {
      ...operatorReview,
      revision: '13',
      lots: [...operatorReview.lots, operatorLot(e, 'LED reel', {})],
    },
  }

  const publish = async () => {
    vi.mocked(client.read).mockResolvedValue(next.capture)
    vi.mocked(operator.read).mockResolvedValue(next.operator)
    // The server's manual workspace follows the batch revision, as on a real refetch.
    vi.mocked(manual.workspace).mockResolvedValue({ ...workspace, revision: '13' })
    await act(async () => {
      cache.setQueryData(serverQueryKey(fixtureScope, 'operator-review', batchId), next.operator)
      cache.setQueryData(serverQueryKey(fixtureScope, 'capture', batchId), next.capture)
    })
  }

  await user.click(await screen.findByRole('button', { name: 'Edit lot values' }))
  const quantity = screen.getByLabelText('Exact pieces')
  await user.clear(quantity)
  await user.type(quantity, '123')
  await publish()
  // The draft keeps its revision: no live lot, and the input is untouched.
  expect(screen.getByLabelText('Exact pieces')).toHaveValue('123')
  expect(screen.queryByRole('checkbox', { name: 'Select LED reel' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Discard lot edits' }))
  const row = await screen.findByRole('checkbox', { name: 'Select LED reel' })
  expect(row.closest('li, div')?.parentElement).toHaveTextContent('AI-proposed')
  // A live update must not leave Review read-only.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit lot values' })).toBeEnabled())
})
