import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { validate, type CaptureSnapshotDto } from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { materialize, unresolvedWarnings } from '../src/review/model.ts'
import {
  EMPTY_REVIEW_CONTEXT,
  type CaptureReviewContext,
  type IssueDispositionRecord,
} from '../src/capture/review-context.ts'

const context = randomUUID()

function observation(model: 'part' | 'location', pk: string) {
  return {
    id: randomUUID(),
    model,
    pk,
    target_context_id: context,
    label: `${model} ${pk}`,
    observed_at: '2026-11-02T00:00:00.000Z',
  }
}

function reference(value: ReturnType<typeof observation>) {
  return {
    mode: 'set' as const,
    value: {
      observation_id: value.id,
      target_context_id: context,
      model: value.model,
      pk: value.pk,
    },
  }
}

/** Two lots share Part P; lot A has a human note, lot B has only an empty note. */
function snapshot(): CaptureSnapshotDto {
  const actor = randomUUID()
  const partP = randomUUID()
  const partQ = randomUUID()
  const lotA = randomUUID()
  const lotB = randomUUID()
  const part29 = observation('part', '29')
  const location43 = observation('location', '43')
  const value: CaptureSnapshotDto = {
    id: randomUUID(),
    source_id: randomUUID(),
    title: 'Bench bag',
    revision: '9007199254740993',
    archived: false,
    updated_at: '2026-11-02T00:00:00.000Z',
    actor_id: actor,
    target_context_id: context,
    defaults: { quantity: { mode: 'unset' }, location: reference(location43) },
    parts: [
      { id: partP, label: 'Resistor', revision: '2', choice: reference(part29) },
      { id: partQ, label: 'Resistor again', revision: '2', choice: reference(part29) },
    ],
    lots: [
      {
        id: lotA,
        label: 'Packet A',
        revision: '2',
        contribution_key: randomUUID(),
        part_subject_id: partP,
        quantity: { mode: 'set', value: '17.000001' },
        location: { mode: 'inherit' },
      },
      {
        id: lotB,
        label: 'Packet B',
        revision: '2',
        contribution_key: randomUUID(),
        part_subject_id: partP,
        quantity: { mode: 'set', value: '23' },
        location: { mode: 'clear' },
      },
    ],
    notes: [
      {
        id: randomUUID(),
        subject_id: lotA,
        text: '17 counted pieces.',
        actor_id: actor,
        created_at: '2026-11-02T00:00:00.000Z',
        producer: 'human',
      },
      {
        id: randomUUID(),
        subject_id: lotB,
        text: '   ',
        actor_id: actor,
        created_at: '2026-11-02T00:00:00.000Z',
        producer: 'human',
      },
    ],
    observations: [part29, location43],
    cursor: { stream_id: randomUUID(), sequence: '4' },
  }
  validate('CaptureSnapshot', value)
  return value
}

function contextWith(overrides: Partial<CaptureReviewContext>): CaptureReviewContext {
  return { ...EMPTY_REVIEW_CONTEXT, ...overrides }
}

function disposition(subjectId: string, code: string, digest: string): IssueDispositionRecord {
  return {
    id: randomUUID(),
    subjectId,
    code,
    dependencyDigest: digest,
    reason: 'Counted from the bench bag; no packet label exists.',
    actorId: randomUUID(),
    createdAt: '2026-11-02T00:00:00.000Z',
  }
}

test('subjects without dispositions or lineage keep their exact /1 dependency bytes', () => {
  const capture = snapshot()
  const [lotA] = capture.lots
  const material = materialize(capture, [lotA.id])
  const lotBytes = material.subjects.find((value) => value.subjectId === lotA.id)!.bytes
  const parsed = JSON.parse(lotBytes.toString('utf8'))

  assert.equal(parsed.version, 'manual-lot-review/1')
  assert.equal(parsed.effectiveQuantity.value, '17.000001')
  assert.equal(canonical(parsed), lotBytes.toString('utf8'))
  for (const subject of material.subjects) {
    assert.ok(subject.digest.equals(subject.factDigest))
  }
})

test('an empty note is not supporting evidence; a human note, Part note or predecessor note is', () => {
  const capture = snapshot()
  const [lotA, lotB] = capture.lots

  const noEvidence = materialize(capture, [lotB.id]).warnings.map((value) => value.code)
  assert.ok(noEvidence.includes('no_supporting_evidence'))
  const supported = materialize(capture, [lotA.id]).warnings.map((value) => value.code)
  assert.ok(!supported.includes('no_supporting_evidence'))

  const withPredecessor = contextWith({ predecessors: new Map([[lotB.id, [lotA.id]]]) })
  const inherited = materialize(capture, [lotB.id], new Map(), withPredecessor)
  assert.ok(!inherited.warnings.some((value) => value.code === 'no_supporting_evidence'))

  const linkedMedia = materialize(capture, [lotB.id], new Map([[lotB.id, 'ab'.repeat(32)]]))
  assert.ok(!linkedMedia.warnings.some((value) => value.code === 'no_supporting_evidence'))
})

test('a duplicate existing-Part choice warns only while the other proposal has an active lot', () => {
  const capture = snapshot()
  const [lotA, lotB] = capture.lots
  const [partP, partQ] = capture.parts

  const unused = materialize(capture, [lotA.id])
  assert.ok(!unused.warnings.some((value) => value.code === 'possible_duplicate_part'))

  lotB.part_subject_id = partQ.id
  const duplicated = materialize(capture, [lotA.id])
  const warning = duplicated.warnings.find((value) => value.code === 'possible_duplicate_part')
  assert.equal(warning?.subjectId, partP.id)

  const retired = contextWith({ retiredLotIds: new Set([lotB.id]) })
  const afterRetirement = materialize(capture, [lotA.id], new Map(), retired)
  assert.ok(!afterRetirement.warnings.some((value) => value.code === 'possible_duplicate_part'))
})

test('a current dismissal seals /3 bytes, changes the review digest and goes stale with the facts', () => {
  const capture = snapshot()
  const lotB = capture.lots[1]
  const raised = materialize(capture, [lotB.id])
  const warning = raised.warnings.find((value) => value.code === 'no_supporting_evidence')!
  assert.equal(unresolvedWarnings(raised).length, 1)

  const dismissed = contextWith({
    dispositions: new Map([[lotB.id, [disposition(lotB.id, warning.code, warning.factDigest)]]]),
  })
  const resolved = materialize(capture, [lotB.id], new Map(), dismissed)
  const subject = resolved.subjects.find((value) => value.subjectId === lotB.id)!
  const sealed = JSON.parse(subject.bytes.toString('utf8'))

  assert.equal(unresolvedWarnings(resolved).length, 0)
  assert.equal(sealed.version, 'manual-subject-review/3')
  assert.equal(sealed.dispositions[0].code, 'no_supporting_evidence')
  assert.equal(subject.factDigest.toString('hex'), warning.factDigest)
  assert.ok(!subject.digest.equals(subject.factDigest))

  lotB.quantity = { mode: 'set', value: '24' }
  const changed = materialize(capture, [lotB.id], new Map(), dismissed)
  assert.equal(unresolvedWarnings(changed).length, 1)
  assert.notEqual(changed.warnings[0].factDigest, warning.factDigest)
})

test('a retired lot is blocking and produces no subject dependency or effect', () => {
  const capture = snapshot()
  const lotA = capture.lots[0]
  const retired = contextWith({ retiredLotIds: new Set([lotA.id]) })
  const material = materialize(capture, [lotA.id], new Map(), retired)

  assert.deepEqual(
    material.issues.map((value) => value.code),
    ['lot_retired'],
  )
  assert.equal(material.subjects.length, 0)
  assert.equal(material.effects.length, 0)
})

test('an excluded lot is blocking with its reason and produces no subject dependency or effect', () => {
  const capture = snapshot()
  const lotA = capture.lots[0]
  Object.assign(lotA, { excluded: { reason: 'Bent leads', at: '2026-11-08T05:00:00.000Z' } })
  const material = materialize(capture, [lotA.id], new Map())

  assert.deepEqual(
    material.issues.map((value) => [value.code, value.message]),
    [['lot_excluded', 'Excluded: Bent leads. Include it again to add it.']],
  )
  assert.equal(material.subjects.length, 0)
  assert.equal(material.effects.length, 0)
})

test('an excluded lot’s issue fits its contract even with the longest reason', () => {
  const capture = snapshot()
  const lotA = capture.lots[0]
  Object.assign(lotA, { excluded: { reason: 'x'.repeat(500), at: '2026-11-08T05:00:00.000Z' } })
  const material = materialize(capture, [lotA.id], new Map())
  const message = material.issues[0].message
  assert.ok(Array.from(message).length <= 256, `${Array.from(message).length}`)
  assert.match(message, /^Excluded: x+…\. Include it again to add it\.$/)
})

test('lineage alone seals /3 bytes so a successor review never matches its predecessor', () => {
  const capture = snapshot()
  const [lotA, lotB] = capture.lots
  const plain = materialize(capture, [lotB.id])
  const succeeded = materialize(
    capture,
    [lotB.id],
    new Map(),
    contextWith({ predecessors: new Map([[lotB.id, [lotA.id]]]) }),
  )
  const before = plain.subjects.find((value) => value.subjectId === lotB.id)!
  const after = succeeded.subjects.find((value) => value.subjectId === lotB.id)!

  assert.ok(!before.bytes.equals(after.bytes))
  assert.deepEqual(JSON.parse(after.bytes.toString('utf8')).predecessorLotIds, [lotA.id])
})

test('an AI lot needs its own quantity before approval, even when the batch default is set', () => {
  const capture = snapshot()
  const [lotA] = capture.lots
  const withDefault = {
    ...capture,
    defaults: { ...capture.defaults, quantity: { mode: 'set' as const, value: '1' } },
  }
  const agentLot = {
    ...lotA,
    quantity: { mode: 'inherit' as const },
    origin: 'agent' as const,
    agent_session_id: randomUUID(),
    estimated_quantity: '500',
    quantity_basis: 'label · one photo',
  }
  const inherited = materialize({ ...withDefault, lots: [agentLot, ...capture.lots.slice(1)] }, [
    lotA.id,
  ])
  assert.ok(inherited.issues.some((issue) => issue.code === 'quantity_required'))
  // The same lot from the operator inherits the default as before.
  const operatorLot = { ...lotA, quantity: { mode: 'inherit' as const } }
  const human = materialize({ ...withDefault, lots: [operatorLot, ...capture.lots.slice(1)] }, [
    lotA.id,
  ])
  assert.ok(!human.issues.some((issue) => issue.code === 'quantity_required'))
})
