import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  lotItemCount,
  possibleDuplicates,
  validate,
  type CaptureEvidenceObservationDto,
} from '../src/index.ts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const lot = id(90)
const observation = (n: number, visible_count: number | null, extra = {}) =>
  ({
    id: id(n),
    evidence_version_id: id(50),
    page: 1,
    region: {
      kind: 'pixels',
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      source_width: 100,
      source_height: 100,
    },
    readings: { markings: ['1N4148'] },
    visible_count,
    status: 'active',
    supersedes_observation_id: null,
    origin: 'agent',
    agent_session_id: id(70),
    operator_edited: false,
    revision: '1',
    lot_id: lot,
    suggested_lot_ids: [],
    ...extra,
  }) as CaptureEvidenceObservationDto

test('an observation is marked as the same item as another, and the mark is cleared with null', () => {
  const edit = (change: unknown) => ({ expected_revision: '1', change })
  validate(
    'CaptureEdit',
    edit({ kind: 'observation_same_item', observation_id: id(2), same_as: id(1) }),
  )
  validate(
    'CaptureEdit',
    edit({ kind: 'observation_same_item', observation_id: id(2), same_as: null }),
  )
  for (const change of [
    { kind: 'observation_same_item', observation_id: id(2) },
    { kind: 'observation_same_item', observation_id: 'x', same_as: id(1) },
  ]) {
    assert.throws(() => validate('CaptureEdit', edit(change)), JSON.stringify(change))
  }
})

test('an observation may name the item it shows again, and older observations without it stay valid', () => {
  validate('CaptureEvidenceObservation', observation(1, 200))
  validate('CaptureEvidenceObservation', observation(2, 200, { same_item_as: id(1) }))
  assert.throws(() =>
    validate('CaptureEvidenceObservation', observation(2, 200, { same_item_as: 'x' })),
  )
})

test('a lot counts each physical item once, and stays uncounted when no observation counts', () => {
  const bag = observation(1, 200)
  const again = observation(2, 200, { same_item_as: id(1) })
  const other = observation(3, 50)
  const elsewhere = { ...observation(4, 999), lot_id: id(91) }
  assert.equal(lotItemCount([bag, other, elsewhere], lot), 250)
  assert.equal(lotItemCount([bag, { ...again, same_item_as: undefined }, other], lot), 450)
  assert.equal(lotItemCount([bag, again, other, elsewhere], lot), 250)
  // A marked group counts its largest count once, whichever row carries it.
  assert.equal(
    lotItemCount([observation(1, null), observation(2, 30, { same_item_as: id(1) })], lot),
    30,
  )
  assert.equal(lotItemCount([observation(1, null)], lot), null)
  assert.equal(lotItemCount([{ ...bag, status: 'suggested' }], lot), null)
})

test('observations of one lot with the same markings are possible duplicates until marked as one item', () => {
  const marked = (n: number, markings: string[], extra = {}) =>
    observation(n, 200, { readings: { markings }, ...extra })
  assert.equal(possibleDuplicates([marked(1, ['1N4148']), marked(2, [' 1n4148 '])]), 1)
  assert.equal(
    possibleDuplicates([marked(1, ['1N4148']), marked(2, ['1N4148'], { same_item_as: id(1) })]),
    0,
  )
  // Different lots, different markings, no markings or a suggestion are not duplicates.
  assert.equal(
    possibleDuplicates([
      marked(1, ['1N4148']),
      { ...marked(2, ['1N4148']), lot_id: id(91) },
      marked(3, ['BC547']),
      marked(4, []),
      marked(5, []),
      { ...marked(6, ['BC547']), status: 'suggested' },
    ]),
    0,
  )
  assert.equal(
    possibleDuplicates([marked(1, ['A', 'B']), marked(2, ['B', 'A']), marked(3, ['a', 'b'])]),
    2,
  )
})

test('the batch list may carry step counts, evidence counts and possible duplicates', () => {
  const step = { jobs: 2, ready: 1, running: 1 }
  const workflow = {
    lots: 5,
    ready: 0,
    needs_review: 5,
    blocked: 0,
    approved: 0,
    open_questions: 0,
    active_jobs: 1,
    latest_round: null,
    thumbnail: null,
  }
  const list = (extra: object) => ({
    batches: [
      {
        id: id(1),
        source_id: id(2),
        title: 'Jaycar receipt',
        revision: '1',
        archived: false,
        updated_at: '2026-11-08T09:00:00.000Z',
        workflow: { ...workflow, ...extra },
      },
    ],
    truncated: false,
  })
  validate('InboxList', list({}))
  validate(
    'InboxList',
    list({
      steps: { examine: step, research: step, images: step, inventory: step },
      evidence: { photos: 4, documents: 1, other: 0 },
      possible_duplicates: 1,
    }),
  )
  assert.throws(() => validate('InboxList', list({ possible_duplicates: -1 })))
  assert.throws(() => validate('InboxList', list({ evidence: { photos: 4 } })))
})
