import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { validate } from '@invimport/contracts'
import { retainedQuestionSpec } from '../src/processing/retained.ts'
import { inputManifest, sealed, unseal } from '../src/processing/model.ts'
import { processingInputIsCurrent } from '../src/processing/authority.ts'
import { manualInputFixture } from './support/processing-input.ts'

test('immutable manual input retains exact human values and explicit stage dependencies', () => {
  const capture = manualInputFixture()
  const predecessor = randomUUID()
  const manifest = inputManifest(capture, capture.lots[0].id, 'research', [predecessor], null)
  const retained = sealed(manifest)

  assert.ok('quantity' in manifest.subject)
  assert.deepEqual(manifest.dependencies, [predecessor])
  assert.deepEqual(manifest.subject.quantity, { mode: 'set', value: '17.000001' })
  assert.equal(manifest.instruction_version, 'restricted-synthetic/1')
  assert.deepEqual(manifest.media, [])
  assert.deepEqual(unseal(retained.bytes, retained.digest), manifest)

  const changed = structuredClone(capture)
  changed.lots[0].quantity = { mode: 'set', value: '19' }
  assert.equal(processingInputIsCurrent(manifest, changed), false)
  assert.deepEqual(manifest.subject.quantity, { mode: 'set', value: '17.000001' })
  assert.notDeepEqual(
    sealed(inputManifest(changed, changed.lots[0].id, 'research', [predecessor], null)).digest,
    retained.digest,
  )
})

test('stream clocks and unrelated lot edits do not rewrite dependency authority', () => {
  const capture = manualInputFixture()
  const manifest = inputManifest(capture, capture.lots[0].id, 'reading', [], null)
  const changed = structuredClone(capture)
  changed.cursor.sequence = '999'
  changed.revision = '13'
  changed.updated_at = '2026-11-02T00:00:00Z'
  changed.lots.push({ ...capture.lots[0], id: randomUUID(), label: 'Packet B' })
  assert.equal(processingInputIsCurrent(manifest, changed), true)

  changed.notes[0].text = 'Human correction: Packet A contains 31.'
  assert.equal(processingInputIsCurrent(manifest, changed), false)
})

test('processing contracts reject extra authority, numeric quantities and native permission handles', () => {
  const base = {
    schema_version: 'bench-intake-answer/1',
    expected_question_revision: '1',
    expected_capture_revision: '12',
    attempt_id: randomUUID(),
    input_sha256: 'a'.repeat(64),
    value: { kind: 'quantity', value: '17', basis: 'counted' },
  }
  assert.doesNotThrow(() => validate('ProcessingAnswer', base))
  assert.throws(
    () => validate('ProcessingAnswer', { ...base, actor_id: randomUUID() }),
    /invalid_contract/,
  )
  assert.throws(
    () =>
      validate('ProcessingAnswer', {
        ...base,
        value: { kind: 'quantity', value: 17, basis: 'counted' },
      }),
    /invalid_contract/,
  )
  assert.throws(
    () =>
      validate('ProcessingAnswer', {
        ...base,
        value: { kind: 'native_permission', handle: 'old-process:allow' },
      }),
    /invalid_contract/,
  )
})

test('a valid spec hash alone cannot change the displayed question from its sealed producer message', () => {
  const attemptId = randomUUID()
  const jobId = randomUUID()
  const commandId = randomUUID()
  const subjectId = randomUUID()
  const spec = {
    kind: 'quantity',
    subject_id: subjectId,
    prompt: 'Count Packet A',
    reason: 'Original label is unclear.',
  }
  const message = sealed({
    schema_version: 'bench-intake-runner/1',
    job_id: jobId,
    attempt_id: attemptId,
    command_id: commandId,
    input_sha256: 'a'.repeat(64),
    profile_id: 'synthetic-research/1',
    handler_version: 'processing/1',
    sequence: '1',
    kind: 'question',
    payload: spec,
  })
  const original = sealed(spec)
  const row = {
    attempt_id: attemptId,
    job_id: jobId,
    command_id: commandId,
    manifest_digest: Buffer.from('a'.repeat(64), 'hex'),
    envelope_bytes: message.bytes,
    envelope_digest: message.digest,
    disposition: 'accepted',
    spec_bytes: original.bytes,
    spec_digest: original.digest,
  }
  assert.deepEqual(retainedQuestionSpec(row, subjectId), spec)

  const misleading = sealed({ ...spec, prompt: 'Approve all inventory effects' })
  assert.throws(
    () =>
      retainedQuestionSpec(
        { ...row, spec_bytes: misleading.bytes, spec_digest: misleading.digest },
        subjectId,
      ),
    /retained_question_binding_invalid/,
  )
  assert.throws(
    () => retainedQuestionSpec({ ...row, command_id: randomUUID() }, subjectId),
    /retained_message_binding_invalid/,
  )
})
