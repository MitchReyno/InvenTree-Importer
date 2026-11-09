import { test } from 'node:test'
import assert from 'node:assert/strict'
import { materialize } from '#/review/model.ts'
import type { CaptureReviewContext } from '#/capture/review-context.ts'
import {
  reviewVectorSnapshot,
  VECTOR_LOT_A,
  VECTOR_LOT_B,
  VECTOR_MEDIA_DIGESTS,
  VECTOR_PART,
} from './support/review-vectors.ts'

// Produced by the pre-T08 materialize at be3be4c for the same fixture.
const LEGACY = {
  v1: {
    selection: 'ec8f222358c68e4318ef273e47e058295f7cc446ac42ad5ad4e938547462ad87',
    [VECTOR_PART]: '6b7c7fc0d2e870a0c75903b6830021f4e13b748065636080bdbfa207d19f2edc',
    [VECTOR_LOT_A]: '4b97e46f116ba9e6e408378c156b973ebe2557c713920e1f30c7679271246c6d',
    [VECTOR_LOT_B]: 'c756cf68986ace44f73792927752dcab0c85fb8931bef7be0274b8da7165d69d',
  },
  v2: {
    selection: '72d2535ea179a462e84942f1a7e895cc022a03ae24471a5f869d2606da397fa5',
    [VECTOR_PART]: '90ee7f8c863d8f6a3e62994a386fe579a81fc8d9341a8a658f17d82fc284c6ba',
    [VECTOR_LOT_A]: '3ef4ec51012cb7c628d7503a1b37f45b7896685e1cd3b17cd17208d63d263689',
    [VECTOR_LOT_B]: '43b31f5ba9fa65b42fd02bcf8017fcab5744713c9b8084b4fb3400151a8b8d67',
  },
} as const

function digests(media: ReadonlyMap<string, string>) {
  const material = materialize(reviewVectorSnapshot, [VECTOR_LOT_B, VECTOR_LOT_A], media)
  const bySubject = Object.fromEntries(
    material.subjects.map((subject) => [subject.subjectId, subject.digest.toString('hex')]),
  )
  return { selection: material.digest.toString('hex'), ...bySubject }
}

test('retained /1 review and selection bytes match the pre-T08 implementation exactly', () => {
  assert.deepEqual(digests(new Map()), LEGACY.v1)
})

test('retained /2 media-aware bytes match the pre-T08 implementation exactly', () => {
  assert.deepEqual(digests(VECTOR_MEDIA_DIGESTS), LEGACY.v2)
})

function successorContext(): CaptureReviewContext {
  return {
    retiredLotIds: new Set([VECTOR_LOT_A]),
    retired: [],
    predecessors: new Map([[VECTOR_LOT_B, [VECTOR_LOT_A]]]),
    dispositions: new Map(),
  }
}

test('linked media on a retired predecessor counts as supporting evidence', () => {
  const snapshot = { ...reviewVectorSnapshot, notes: [] }
  const without = materialize(snapshot, [VECTOR_LOT_B], new Map(), successorContext())
  assert.deepEqual(
    without.warnings.map((warning) => warning.code),
    ['no_supporting_evidence'],
  )

  const linked = materialize(
    snapshot,
    [VECTOR_LOT_B],
    new Map(),
    successorContext(),
    new Set([VECTOR_LOT_A]),
  )
  assert.deepEqual(linked.warnings, [])
})

test('a Part dismissal invalidates lot reviews but not the lot dismissal binding', () => {
  const snapshot = {
    ...reviewVectorSnapshot,
    notes: [],
    parts: [
      ...reviewVectorSnapshot.parts,
      { ...reviewVectorSnapshot.parts[0], id: '21000000-0000-4000-8000-000000000021' },
    ],
    lots: [
      ...reviewVectorSnapshot.lots,
      {
        ...reviewVectorSnapshot.lots[0],
        id: '32000000-0000-4000-8000-000000000032',
        contribution_key: '42000000-0000-4000-8000-000000000042',
        part_subject_id: '21000000-0000-4000-8000-000000000021',
      },
    ],
  }
  const empty: CaptureReviewContext = {
    retiredLotIds: new Set(),
    retired: [],
    predecessors: new Map(),
    dispositions: new Map(),
  }
  const before = materialize(snapshot, [VECTOR_LOT_B], new Map(), empty)
  const partWarning = before.warnings.find((value) => value.code === 'possible_duplicate_part')!
  const lotWarning = before.warnings.find((value) => value.code === 'no_supporting_evidence')!
  const record = (id: string, subjectId: string, code: string, digest: string) => ({
    id,
    subjectId,
    code,
    dependencyDigest: digest,
    reason: 'Checked on the bench',
    actorId: reviewVectorSnapshot.actor_id,
    createdAt: '2026-11-02T00:00:00.000Z',
  })
  const lotDismissed: CaptureReviewContext = {
    ...empty,
    dispositions: new Map([
      [
        VECTOR_LOT_B,
        [
          record(
            '82000000-0000-4000-8000-000000000082',
            VECTOR_LOT_B,
            lotWarning.code,
            lotWarning.factDigest,
          ),
        ],
      ],
    ]),
  }
  const bothDismissed: CaptureReviewContext = {
    ...lotDismissed,
    dispositions: new Map([
      ...lotDismissed.dispositions,
      [
        VECTOR_PART,
        [
          record(
            '83000000-0000-4000-8000-000000000083',
            VECTOR_PART,
            partWarning.code,
            partWarning.factDigest,
          ),
        ],
      ],
    ]),
  }
  const lotOnly = materialize(snapshot, [VECTOR_LOT_B], new Map(), lotDismissed)
  const both = materialize(snapshot, [VECTOR_LOT_B], new Map(), bothDismissed)
  const lotDigest = (material: typeof both) =>
    material.subjects.find((value) => value.subjectId === VECTOR_LOT_B)!.digest.toString('hex')

  assert.notEqual(lotDigest(both), lotDigest(lotOnly))
  const lotStillDismissed = both.warnings.find((value) => value.code === 'no_supporting_evidence')
  assert.equal(lotStillDismissed?.disposition?.id, '82000000-0000-4000-8000-000000000082')
})
