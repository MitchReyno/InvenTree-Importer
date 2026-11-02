import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import {
  validate,
  type CaptureSnapshotDto,
  type OperatorReviewDto,
  type ProcessingSnapshotDto,
} from '@invimport/contracts'
import { render } from './test/render'
import { CaptureWorkspace } from './components/capture/CaptureWorkspace'
import { CaptureHeader } from './components/capture/CaptureHeader'
import { InstructionsPanel } from './components/operator/InstructionsPanel'
import { IssuePanel } from './components/operator/IssuePanel'
import { retiredLotIds } from './operator/review-model'
import { ProcessingWorkspace } from './components/processing/ProcessingWorkspace'
import type { OperatorReviewClient } from './operator/types'
import type { ProcessingClient } from './processing/types'

const batchId = '10000000-0000-4000-8000-000000000001'
const active = '30000000-0000-4000-8000-000000000003'
const retired = '30000000-0000-4000-8000-000000000004'
const actor = '50000000-0000-4000-8000-000000000005'
const context = '60000000-0000-4000-8000-000000000006'
const jobId = '70000000-0000-4000-8000-000000000007'
const attemptId = '80000000-0000-4000-8000-000000000008'
const questionId = '90000000-0000-4000-8000-000000000009'

function lot(id: string, label: string, key: string) {
  return {
    id,
    label,
    revision: '1',
    contribution_key: key,
    part_subject_id: null,
    quantity: { mode: 'inherit' as const },
    location: { mode: 'inherit' as const },
  }
}

const batch: CaptureSnapshotDto = {
  id: batchId,
  source_id: '40000000-0000-4000-8000-000000000004',
  title: 'Surfaces fixture',
  revision: '8',
  archived: false,
  updated_at: '2026-11-02T12:00:00Z',
  actor_id: actor,
  target_context_id: context,
  defaults: { quantity: { mode: 'unset' }, location: { mode: 'unset' } },
  parts: [],
  lots: [
    lot(active, 'Active packet', 'a0000000-0000-4000-8000-000000000001'),
    lot(retired, 'Retired bag', 'a0000000-0000-4000-8000-000000000002'),
  ],
  notes: [],
  observations: [],
  cursor: { stream_id: 'b0000000-0000-4000-8000-000000000002', sequence: '8' },
}

const review: OperatorReviewDto = {
  batch_id: batchId,
  revision: '8',
  lots: [],
  retired_lots: [],
  instructions: [
    {
      group_id: null,
      version: '6',
      text: 'Same order, separate packets.',
      actor_id: actor,
      created_at: '2026-11-02T12:00:00Z',
    },
  ],
  cursor: batch.cursor,
}

const snapshot: ProcessingSnapshotDto = {
  batch_id: batchId,
  capture_revision: '8',
  runner_status: 'fixture_only',
  cursor: batch.cursor,
  jobs: [
    {
      id: jobId,
      subject_id: retired,
      stage: 'reading',
      revision: '2',
      state: 'waiting_for_user',
      attempt_id: attemptId,
      input_sha256: 'a'.repeat(64),
      attempt_number: '1',
      qualification: 'fixture_only',
      proposals: [],
      questions: [
        {
          id: questionId,
          job_id: jobId,
          attempt_id: attemptId,
          input_sha256: 'a'.repeat(64),
          revision: '1',
          state: 'open',
          spec: {
            kind: 'quantity',
            subject_id: active,
            prompt: 'How many?',
            reason: 'Unclear label.',
          },
        },
      ],
    },
  ],
}

test('fixtures satisfy the shared runtime contracts', () => {
  validate('CaptureSnapshot', batch)
  validate('OperatorReview', review)
  validate('ProcessingSnapshot', snapshot)
})

test('batch instructions save as a new version with the loaded revision', async () => {
  const user = userEvent.setup()
  const client = {
    instruct: vi.fn(async () => review),
  } as unknown as OperatorReviewClient
  const reload = vi.fn(async () => undefined)
  const dirty = vi.fn()
  render(
    <InstructionsPanel
      batch={batch}
      review={review}
      client={client}
      disabled={false}
      reload={reload}
      onDirtyChange={dirty}
    />,
  )
  expect(screen.getByText(/Current fixture-only Processing does not consume them/)).toBeVisible()
  const text = screen.getByLabelText('Batch instructions')
  expect(text).toHaveValue('Same order, separate packets.')
  expect(screen.getByText(/Version 6/)).toBeVisible()
  await user.type(text, ' Keep date codes apart.')
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true))
  await user.click(screen.getByRole('button', { name: 'Save batch instructions' }))
  await waitFor(() => expect(client.instruct).toHaveBeenCalledTimes(1))
  expect(client.instruct).toHaveBeenCalledWith(
    batchId,
    {
      expected_revision: '8',
      group_id: null,
      text: 'Same order, separate packets. Keep date codes apart.',
    },
    expect.any(String),
  )
  await waitFor(() => expect(reload).toHaveBeenCalled())
})

test('Processing keeps retired history but offers only active lots for new attempts', async () => {
  const client: ProcessingClient = {
    read: vi.fn(async () => snapshot),
    start: vi.fn(),
    cancel: vi.fn(),
    answer: vi.fn(),
  }
  render(
    <ProcessingWorkspace
      batch={batch}
      client={client}
      view="overview"
      navigate={vi.fn()}
      onDirtyChange={vi.fn()}
      onSaved={vi.fn(async () => undefined)}
      retiredLotIds={new Set([retired])}
    />,
  )
  const picker = await screen.findByRole('group', {
    name: 'Select saved subjects for a new processing attempt',
  })
  expect(within(picker).getByLabelText('Active packet')).toBeVisible()
  expect(within(picker).queryByLabelText('Retired bag')).not.toBeInTheDocument()
  const needsYou = screen.getByRole('region', { name: 'Needs you' })
  expect(within(needsYou).getByText('1 needs you')).toBeVisible()
  expect(within(needsYou).getByRole('link', { name: 'Active packet · reading' })).toHaveAttribute(
    'href',
    `#${batchId}/processing/reading/${questionId}`,
  )
  expect(within(needsYou).getByRole('link', { name: 'Open in Review' })).toHaveAttribute(
    'href',
    `#${batchId}/review/${active}`,
  )
  expect(screen.queryByRole('link', { name: 'Open this lot in Review' })).not.toBeInTheDocument()
})

test('the batch header counts active lots and states retired history separately', () => {
  render(
    <CaptureHeader
      batch={batch}
      busy={false}
      dirty={false}
      edit={vi.fn()}
      onStage={vi.fn()}
      stage="review"
      retiredLotIds={new Set([retired])}
    />,
  )

  expect(screen.getByText(/1 physical lots \(1 retired\)/)).toBeTruthy()
})

test('a shared Part warning states every affected lot before dismissal', () => {
  const partId = '20000000-0000-4000-8000-000000000002'
  const withPart: CaptureSnapshotDto = {
    ...batch,
    parts: [{ id: partId, label: 'Shared resistor', revision: '1', choice: { mode: 'unset' } }],
  }
  render(
    <IssuePanel
      batch={withPart}
      issues={[
        {
          code: 'possible_duplicate_part',
          severity: 'warning',
          message: 'Another Part proposal chooses the same existing Part.',
          subject_id: partId,
          lot_id: null,
          run_id: null,
          dependency_digest: 'c'.repeat(64),
          disposition: null,
        },
      ]}
      partLotLabels={['Packet A', 'Packet B']}
      disabled={false}
      reload={vi.fn()}
    />,
  )

  expect(screen.getByText(/affects 2 lots \(Packet A, Packet B\)/)).toBeTruthy()
})

test('retired lots come from the snapshot flag even without the operator projection', () => {
  const flagged: CaptureSnapshotDto = {
    ...batch,
    lots: batch.lots.map((value) => (value.id === retired ? { ...value, retired: true } : value)),
  }

  expect([...retiredLotIds(undefined, flagged)]).toEqual([retired])
  expect([...retiredLotIds(undefined, batch)]).toEqual([])
})

test('instruction drafts and capture edits cannot erase each other through a sibling save', async () => {
  history.replaceState(null, '', `#${batchId}`)
  const user = userEvent.setup()
  const operator = { instruct: vi.fn() } as unknown as OperatorReviewClient
  const edit = vi.fn()
  render(
    <CaptureWorkspace
      batch={batch}
      busy={false}
      edit={edit}
      observe={vi.fn()}
      operator={operator}
      operatorReview={review}
      reload={vi.fn()}
      onDirtyChange={vi.fn()}
    />,
  )
  const instructions = screen.getByLabelText('Batch instructions')
  await user.type(instructions, ' Local draft')
  expect(screen.getByLabelText('Quantity mode')).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save shared defaults' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Discard instruction edits' }))
  await user.selectOptions(screen.getByLabelText('Quantity mode'), 'set')
  await user.type(screen.getByRole('textbox', { name: /^Exact quantity \(pieces\)/ }), '7')
  expect(instructions).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Save batch instructions' })).toBeDisabled()
  expect(edit).not.toHaveBeenCalled()
  expect(operator.instruct).not.toHaveBeenCalled()
})

test('instruction edits can be discarded locally when current commands become disabled', async () => {
  const user = userEvent.setup()
  const client = { instruct: vi.fn() } as unknown as OperatorReviewClient
  const dirty = vi.fn()

  const element = (disabled: boolean) => (
    <InstructionsPanel
      batch={batch}
      review={review}
      client={client}
      disabled={disabled}
      reload={vi.fn()}
      onDirtyChange={dirty}
    />
  )

  const view = render(element(false))
  await user.type(screen.getByLabelText('Batch instructions'), ' Unsent')
  view.rerender(element(true))
  expect(screen.getByRole('button', { name: 'Discard instruction edits' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Discard instruction edits' }))
  expect(screen.getByLabelText('Batch instructions')).toHaveValue('Same order, separate packets.')
  expect(dirty).toHaveBeenLastCalledWith(false)
  expect(client.instruct).not.toHaveBeenCalled()
})
