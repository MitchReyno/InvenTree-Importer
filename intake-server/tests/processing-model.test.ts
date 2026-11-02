import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { validate } from '@invimport/contracts'
import { retainedQuestionSpec } from '../src/processing/retained.ts'
import { inputManifest, mediaInputManifest, sealed, unseal } from '../src/processing/model.ts'
import { processingInputIsCurrent } from '../src/processing/authority.ts'
import { canonicalMedia } from '../src/media/encoding.ts'
import { decodeMediaInputs } from '../src/media/inputs.ts'
import { sha256 } from '../src/db/authority.ts'
import { manualInputFixture, emptyProcessingMedia } from './support/processing-input.ts'

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
  assert.equal(
    processingInputIsCurrent(manifest, changed, emptyProcessingMedia(changed, manifest.subject_id)),
    false,
  )
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
  assert.equal(
    processingInputIsCurrent(manifest, changed, emptyProcessingMedia(changed, manifest.subject_id)),
    true,
  )

  changed.notes[0].text = 'Human correction: Packet A contains 31.'
  assert.equal(
    processingInputIsCurrent(manifest, changed, emptyProcessingMedia(changed, manifest.subject_id)),
    false,
  )
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
    attemptId: attemptId,
    jobId: jobId,
    commandId: commandId,
    manifestDigest: Buffer.from('a'.repeat(64), 'hex'),
    envelopeBytes: message.bytes,
    envelopeDigest: message.digest,
    disposition: 'accepted',
    specBytes: original.bytes,
    specDigest: original.digest,
  }
  assert.deepEqual(retainedQuestionSpec(row, subjectId), spec)

  const misleading = sealed({ ...spec, prompt: 'Approve all inventory effects' })
  assert.throws(
    () =>
      retainedQuestionSpec(
        { ...row, specBytes: misleading.bytes, specDigest: misleading.digest },
        subjectId,
      ),
    /retained_question_binding_invalid/,
  )
  assert.throws(
    () => retainedQuestionSpec({ ...row, commandId: randomUUID() }, subjectId),
    /retained_message_binding_invalid/,
  )
})

test('old processing inputs freeze new catalogue observations and reject a scoped create choice', () => {
  const capture = manualInputFixture()
  const partId = randomUUID()
  capture.parts.push({
    id: partId,
    label: 'Unrelated',
    revision: '1',
    choice: {
      mode: 'create',
      spec: {
        name: 'New',
        category: {
          observation_id: randomUUID(),
          target_context_id: capture.target_context_id,
          model: 'category',
          pk: '1',
        },
        parameters: [],
        manufacturer: null,
        supplier: null,
        tags: [],
      },
    },
  })
  capture.observations.push(
    {
      id: randomUUID(),
      model: 'category',
      pk: '9',
      target_context_id: capture.target_context_id,
      label: 'Resistors',
      observed_at: '2026-11-01T00:00:00Z',
    },
    {
      id: randomUUID(),
      model: 'part',
      mapping: { kind: 'category' },
      pk: '8',
      target_context_id: capture.target_context_id,
      label: 'Known',
      observed_at: '2026-11-01T00:00:00Z',
    },
  )
  const manifest = inputManifest(capture, capture.lots[0].id, 'reading', [], null)
  assert.deepEqual(
    manifest.observations.map((observation) => observation.model),
    ['part'],
  )
  assert.equal('mapping' in manifest.observations[0], false)

  capture.lots[0].part_subject_id = partId
  assert.throws(
    () => inputManifest(capture, capture.lots[0].id, 'reading', [], null),
    /unsupported_processing_input/,
  )
})

test('media-inputs/2 is not a current processing input', () => {
  const capture = manualInputFixture()
  const subjectId = capture.lots[0].id
  const fields = {
    batchId: capture.id,
    subjectIds: [subjectId],
    evidence: [],
    attachments: [],
    versions: [],
  }
  const version1 = canonicalMedia({ version: 'media-inputs/1', ...fields })
  const descriptor = { manifest: version1, sha256: sha256(version1).toString('hex') }
  const retained = mediaInputManifest(capture, subjectId, 'reading', [], null, descriptor)
  const version2 = canonicalMedia({ version: 'media-inputs/2', ...fields })
  assert.throws(
    () =>
      mediaInputManifest(capture, subjectId, 'reading', [], null, {
        manifest: version2,
        sha256: sha256(version2).toString('hex'),
      }),
    /unsupported_processing_input/,
  )
  assert.equal(
    processingInputIsCurrent(
      retained,
      capture,
      decodeMediaInputs(Buffer.from(version2), sha256(version2)),
    ),
    false,
  )
  assert.equal(
    processingInputIsCurrent(
      retained,
      capture,
      decodeMediaInputs(Buffer.from(version1), sha256(version1)),
    ),
    true,
  )
})
