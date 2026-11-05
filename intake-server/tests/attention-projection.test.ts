import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validate,
  type ManualWorkspaceDto,
  type OperatorReviewDto,
  type ProcessingSnapshotDto,
} from '@invimport/contracts'
import { projectAttention } from '../src/attention/projection.ts'

const batch = '00000000-0000-4000-8000-0000000000b1'
const lot = (n: number) => `00000000-0000-4000-8000-00000000010${n}`
const id = (n: number) => `00000000-0000-4000-8000-00000000020${n}`
const digest = 'a'.repeat(64)
const cursor = { stream_id: id(9), sequence: '1' }

function question(n: number, state: 'open' | 'answered' | 'superseded', assumption?: string) {
  return {
    id: id(n),
    job_id: id(n),
    attempt_id: id(n),
    input_sha256: digest,
    revision: '1',
    state,
    spec: {
      kind: 'clarification' as const,
      subject_id: lot(1),
      prompt: `Question ${n}?`,
      reason: 'Unclear',
    },
    ...(assumption ? { assumption } : {}),
  }
}

function job(n: number, stage: string, questions: ReturnType<typeof question>[]) {
  return {
    id: id(n),
    subject_id: lot(1),
    stage,
    revision: '1',
    state: 'waiting_for_user',
    attempt_id: id(n),
    input_sha256: digest,
    attempt_number: '1',
    qualification: 'fixture_only',
    proposals: [],
    questions,
  }
}

const processing = {
  runner_status: 'fixture_only',
  batch_id: batch,
  capture_revision: '7',
  jobs: [
    job(1, 'identifying', [question(1, 'open', 'Assuming 10kΩ'), question(2, 'answered')]),
    job(3, 'research', [question(3, 'open')]),
  ],
  cursor,
} as unknown as ProcessingSnapshotDto

function operatorLot(
  n: number,
  state: 'unreviewed' | 'reviewed' | 'changed_after_review',
  issues = 0,
) {
  return {
    lot_id: lot(n),
    label: `Lot ${n}`,
    part_subject_id: null,
    shared_lot_ids: [],
    review_state: state,
    approved: false,
    issues: Array.from({ length: issues }, (_, index) => ({
      code: 'part_choice_required',
      severity: index === 0 ? 'blocking' : 'warning',
      message: `Choose the Part for lot ${n}`,
      subject_id: lot(n),
      lot_id: lot(n),
      run_id: null,
      dependency_digest: null,
      disposition: null,
    })),
    predecessor_lot_ids: [],
  }
}

const review = {
  batch_id: batch,
  revision: '7',
  lots: [
    operatorLot(1, 'unreviewed', 2),
    operatorLot(2, 'changed_after_review'),
    operatorLot(3, 'reviewed'),
    operatorLot(4, 'reviewed'),
  ],
  retired_lots: [],
  instructions: [],
  cursor,
} as unknown as OperatorReviewDto

function run(n: number, state: string, certainty: string) {
  return { run_id: id(n), preparation_id: id(n), state, effect_certainty: certainty }
}

const manual = {
  batch_id: batch,
  revision: '7',
  supported: true,
  capability: null,
  lots: [
    { lot_id: lot(3), reviewed: true, issues: [] },
    { lot_id: lot(4), reviewed: true, issues: [] },
    { lot_id: lot(1), reviewed: false, issues: [] },
  ],
  runs: [
    run(5, 'settled_complete', 'confirmed'),
    run(6, 'recovery_required', 'unknown'),
    run(7, 'settled_complete', 'mixed'),
  ],
  preparations: [],
  preparations_truncated: false,
  cursor,
} as unknown as ManualWorkspaceDto

test('counts each tab from the same reads the screens use', () => {
  const attention = projectAttention({ batchId: batch, processing, review, manual })

  validate('BatchAttention', attention)
  assert.deepEqual(attention.processing, { questions: 2, failed: 0 })
  assert.deepEqual(attention.review, { to_check: 2, changed_after_review: 1, to_decide: 1 })
  assert.deepEqual(attention.changes, { ready: 2, failed: 1, uncertain: 1 })
  assert.equal(attention.revision, '7')
})

test('routes each item to the screen that owns it', () => {
  const { items } = projectAttention({ batchId: batch, processing, review, manual })
  const byKey = Object.fromEntries(items.map((item) => [item.key, item]))

  assert.deepEqual(byKey[`question:${id(1)}`], {
    key: `question:${id(1)}`,
    group: 'question',
    tab: 'processing',
    title: 'Question 1?',
    detail: 'Assuming 10kΩ',
    route: `${batch}/processing/examine/${id(1)}`,
  })
  assert.equal(byKey[`question:${id(3)}`].route, `${batch}/processing/research/${id(3)}`)
  assert.equal(byKey[`question:${id(2)}`], undefined)
  assert.equal(byKey[`changed:${lot(2)}`].route, `${batch}/review/lots/${lot(2)}`)
  assert.equal(byKey[`changed:${lot(2)}`].group, 'changed_lot')
  assert.equal(byKey[`decision:${lot(1)}:part_choice_required`].group, 'decision')
  assert.equal(
    byKey[`decision:${lot(1)}:part_choice_required`].route,
    `${batch}/review/lots/${lot(1)}`,
  )
  assert.equal(byKey[`result:${id(6)}`].route, `${batch}/changes/added/${id(6)}`)
  assert.equal(byKey[`result:${id(7)}`].group, 'result')
  assert.equal(byKey[`result:${id(5)}`], undefined)
})

test('orders items by tab and keeps counts exact when items are truncated', () => {
  const many = {
    ...processing,
    jobs: Array.from({ length: 3 }, (_, jobIndex) => ({
      ...processing.jobs[0],
      id: `00000000-0000-4000-8000-0000000003${String(jobIndex).padStart(2, '0')}`,
      questions: Array.from({ length: 90 }, (_, index) => ({
        ...processing.jobs[0].questions[0],
        id: `00000000-0000-4000-8000-${String(jobIndex * 100 + index).padStart(12, '0')}`,
        state: 'open' as const,
      })),
    })),
  } as ProcessingSnapshotDto
  const attention = projectAttention({ batchId: batch, processing: many, review, manual })

  assert.equal(attention.processing.questions, 270)
  assert.equal(attention.items.length, 200)
  assert.equal(attention.items_truncated, true)
  validate('BatchAttention', attention)
})

test('a failed or interrupted attempt needs the operator in its step', () => {
  const withFailed = {
    ...processing,
    jobs: [
      ...processing.jobs,
      { ...job(4, 'reading', []), state: 'failed' },
      { ...job(5, 'research', []), state: 'interrupted' },
      { ...job(6, 'research', []), state: 'succeeded' },
    ],
  } as unknown as ProcessingSnapshotDto
  const attention = projectAttention({ batchId: batch, processing: withFailed, review, manual })
  const failed = attention.items.filter((item) => item.group === 'failed_job')

  validate('BatchAttention', attention)
  assert.deepEqual(attention.processing, { questions: 2, failed: 2 })
  assert.deepEqual(
    failed.map((item) => [item.title, item.route]),
    [
      ['An Examine attempt failed', `${batch}/processing/examine`],
      ['A Research attempt was interrupted', `${batch}/processing/research`],
    ],
  )
})

test('works without processing, as in setups with no runner', () => {
  const attention = projectAttention({ batchId: batch, processing: undefined, review, manual })

  assert.equal(attention.processing.questions, 0)
  assert.equal(attention.items[0].tab, 'review')
})

test('status issues and approved lots are not decisions or work to check', () => {
  const status = (code: string) => ({
    code,
    severity: 'blocking',
    message: code,
    subject_id: null,
    lot_id: lot(5),
    run_id: null,
    dependency_digest: null,
    disposition: null,
  })
  const approved = {
    ...operatorLot(5, 'unreviewed'),
    approved: true,
    issues: [status('original_contribution_already_approved'), status('quantity_required')],
  }
  const archived = {
    ...operatorLot(6, 'unreviewed'),
    issues: ['batch_archived', 'source_history_unsettled', 'media_not_ready'].map(status),
  }
  const withStatus = { ...review, lots: [...review.lots, approved, archived] } as OperatorReviewDto
  const manualWithApproved = {
    ...manual,
    lots: [...manual.lots, { lot_id: lot(5), reviewed: true, issues: [] }],
  } as ManualWorkspaceDto
  const attention = projectAttention({
    batchId: batch,
    processing,
    review: withStatus,
    manual: manualWithApproved,
  })

  assert.equal(attention.review.to_decide, 1)
  assert.equal(attention.review.to_check, 3)
  assert.equal(attention.changes.ready, 2)
  assert.deepEqual(
    attention.items.filter((item) => item.group === 'decision').map((item) => item.key),
    [`decision:${lot(1)}:part_choice_required`],
  )
})
