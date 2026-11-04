import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { validate, type MediaSnapshotDto } from '@invimport/contracts'
import { materialize } from '../src/review/model.ts'
import { retainedQuestionSpec } from '../src/processing/retained.ts'
import {
  inputManifest,
  mediaInputManifest,
  processingSubjectScope,
  sealed,
  unseal,
} from '../src/processing/model.ts'
import { processingInputIsCurrent } from '../src/processing/authority.ts'
import { canonicalMedia } from '../src/media/encoding.ts'
import { decodeMediaInputs, scopeMediaInputs } from '../src/media/inputs.ts'
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

test('only a selected Part attachment moves a media scope to media-inputs/2', () => {
  const batchId = randomUUID()
  const partId = randomUUID()
  const lotId = randomUUID()
  const snapshot = (mode: 'selected' | 'declined' | 'unset') => ({
    batch_id: batchId,
    revision: '3',
    evidence: [],
    groups: [],
    derivations: [],
    attachments: [
      {
        id: randomUUID(),
        subject_id: partId,
        mode,
        version_id: mode === 'selected' ? randomUUID() : null,
        destination: 'part_attachment' as const,
      },
      {
        id: randomUUID(),
        subject_id: lotId,
        mode: 'declined' as const,
        version_id: null,
        destination: 'lot_attachment' as const,
      },
    ],
  })
  const version = (inputs: { bytes: Buffer }) =>
    (JSON.parse(inputs.bytes.toString('utf8')) as { version: string }).version
  for (const mode of ['declined', 'unset'] as const) {
    const inputs = scopeMediaInputs(snapshot(mode), [partId, lotId])
    assert.equal(version(inputs), 'media-inputs/1')
    assert.deepEqual(
      inputs.attachments.map((selection) => selection.destination),
      ['lot_attachment'],
    )
  }
  assert.equal(version(scopeMediaInputs(snapshot('selected'), [partId, lotId])), 'media-inputs/2')
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

test('retained human context changes input currency without changing frozen input shape or execution choices', () => {
  const capture = manualInputFixture()
  const subjectId = capture.lots[0].id
  const before = inputManifest(capture, subjectId, 'reading', [], null)
  const reviewBefore = materialize(capture, [subjectId])
  capture.context = [
    {
      id: randomUUID(),
      subject_id: null,
      version: '2',
      actor_id: capture.actor_id,
      created_at: '2026-11-03T00:00:00.000Z',
      value: {
        supplier: { mode: 'unset' },
        purchase_date: { mode: 'set', value: '2026-11-03' },
        tags: { mode: 'set', value: ['incoming'] },
      },
    },
  ]
  const after = inputManifest(capture, subjectId, 'reading', [], null)
  const reviewAfter = materialize(capture, [subjectId])
  assert.notDeepEqual(reviewAfter.digest, reviewBefore.digest)
  assert.deepEqual(reviewAfter.effects, reviewBefore.effects)
  validate('ProcessingInputV1', after)
  assert.equal(after.schema_version, before.schema_version)
  assert.deepEqual(after.subject, before.subject)
  assert.equal(after.notes.at(-1)?.id, capture.context[0].id)
  assert.match(after.notes.at(-1)!.text, /not approved inventory effects/)
  assert.equal(
    processingInputIsCurrent(before, capture, emptyProcessingMedia(capture, subjectId)),
    false,
  )
  assert.equal(
    processingInputIsCurrent(after, capture, emptyProcessingMedia(capture, subjectId)),
    true,
  )
})

test('versioned media context reaches processing and invalidates stale notes without changing originals', () => {
  const capture = manualInputFixture()
  const subjectId = capture.lots[0].id
  const evidenceId = randomUUID()
  const groupId = randomUUID()
  const note = {
    id: randomUUID(),
    version: '2',
    text: 'Front and back of one packet',
    actor_id: capture.actor_id,
    created_at: '2026-11-03T00:00:00.000Z',
  }
  const snapshot: MediaSnapshotDto = {
    batch_id: capture.id,
    revision: '2',
    evidence: [
      {
        id: evidenceId,
        label: 'Packet',
        group_id: groupId,
        linked_subject_ids: [subjectId],
        versions: [],
        note,
      },
    ],
    groups: [{ id: groupId, label: 'Keep together', note: { ...note, id: randomUUID() } }],
    attachments: [],
    derivations: [],
  }
  const scoped = scopeMediaInputs(snapshot, processingSubjectScope(capture, subjectId))
  const manifest = mediaInputManifest(capture, subjectId, 'reading', [], null, {
    manifest: scoped.bytes.toString(),
    sha256: scoped.digest.toString('hex'),
  })
  validate('ProcessingInputV2', manifest)
  assert.equal(JSON.parse(scoped.bytes.toString()).version, 'media-inputs/3')
  assert.ok(
    manifest.notes.some((value) => value.id === note.id && value.text.includes('Front and back')),
  )
  assert.equal(processingInputIsCurrent(manifest, capture, scoped), true)
  const changed = structuredClone(snapshot)
  changed.evidence[0].note = { ...note, id: randomUUID(), version: '3', text: 'Different count' }
  const newer = scopeMediaInputs(changed, processingSubjectScope(capture, subjectId))
  assert.equal(processingInputIsCurrent(manifest, capture, newer), false)
  assert.deepEqual(newer.versions, scoped.versions)
  const forbidden = JSON.parse(scoped.bytes.toString())
  forbidden.attachments.push({
    id: randomUUID(),
    subject_id: subjectId,
    mode: 'selected',
    version_id: randomUUID(),
    destination: 'part_attachment',
  })
  const forbiddenBytes = Buffer.from(canonicalMedia(forbidden))
  assert.throws(
    () =>
      mediaInputManifest(capture, subjectId, 'reading', [], null, {
        manifest: forbiddenBytes.toString(),
        sha256: sha256(forbiddenBytes).toString('hex'),
      }),
    /unsupported_processing_input/,
  )
})

test('maximum Unicode media notes remain verbatim and escape-heavy capture tags stay within frozen note bounds', () => {
  const capture = manualInputFixture()
  const subjectId = capture.lots[0].id
  const tags = Array.from({ length: 32 }, (_, index) => `${index}`.padEnd(100, '\u0000'))
  capture.context = [
    {
      id: randomUUID(),
      subject_id: null,
      version: '2',
      actor_id: capture.actor_id,
      created_at: '2026-11-03T00:00:00.000Z',
      value: {
        supplier: { mode: 'unset' },
        purchase_date: { mode: 'unset' },
        tags: { mode: 'set', value: tags },
      },
    },
  ]
  const contextInput = inputManifest(capture, subjectId, 'reading', [], null)
  validate('ProcessingInputV1', contextInput)
  const contextText = contextInput.notes.at(-1)!.text
  assert.ok(contextText.length <= 8192)
  for (const tag of tags) {
    assert.ok(contextText.includes(tag))
  }
  for (const text of ['x'.repeat(8192), '😀'.repeat(8192)]) {
    const groupId = randomUUID()
    const note = {
      id: randomUUID(),
      version: '3',
      actor_id: capture.actor_id,
      created_at: '2026-11-03T00:00:00.000Z',
      text,
    }
    const media: MediaSnapshotDto = {
      batch_id: capture.id,
      revision: '3',
      groups: [{ id: groupId, label: '😀'.repeat(256), note }],
      evidence: [
        {
          id: randomUUID(),
          label: 'File',
          group_id: groupId,
          linked_subject_ids: [subjectId],
          versions: [],
          note: { ...note, id: randomUUID() },
        },
      ],
      attachments: [],
      derivations: [],
    }
    validate('MediaSnapshot', media)
    const scoped = scopeMediaInputs(media, processingSubjectScope(capture, subjectId))
    const manifest = mediaInputManifest(capture, subjectId, 'reading', [], null, {
      manifest: scoped.bytes.toString(),
      sha256: scoped.digest.toString('hex'),
    })
    validate('ProcessingInputV2', manifest)
    assert.equal(manifest.notes.at(-1)!.text, text)
    assert.equal(manifest.notes.at(-2)!.text, text)
  }
})

test('human-context note overflow produces a typed capacity refusal and makes older work noncurrent', () => {
  const capture = manualInputFixture()
  const subjectId = capture.lots[0].id
  capture.notes = Array.from({ length: 1000 }, () => ({
    ...capture.notes[0],
    id: randomUUID(),
    text: 'a',
    subject_id: null,
  }))
  const manifest = inputManifest(capture, subjectId, 'reading', [], null)
  capture.context = [
    {
      id: randomUUID(),
      subject_id: null,
      version: '2',
      actor_id: capture.actor_id,
      created_at: '2026-11-03T00:00:00.000Z',
      value: {
        supplier: { mode: 'unset' },
        purchase_date: { mode: 'unset' },
        tags: { mode: 'set', value: ['new'] },
      },
    },
  ]
  assert.throws(
    () => inputManifest(capture, subjectId, 'reading', [], null),
    /processing_input_capacity/,
  )
  assert.equal(
    processingInputIsCurrent(manifest, capture, emptyProcessingMedia(capture, subjectId)),
    false,
  )
})

test('a shared-Part location assignment leaves processing input bytes unchanged', () => {
  const base = manualInputFixture()
  const partId = randomUUID()
  const input = {
    ...base,
    parts: [{ id: partId, label: 'Shared', revision: '1', choice: { mode: 'unset' as const } }],
    lots: base.lots.map((lot) => ({ ...lot, part_subject_id: partId })),
  }
  const subject = input.lots[0].id
  const before = inputManifest(input, subject, 'reading', [], null)
  const assigned = {
    ...input,
    parts: input.parts.map((part) => ({ ...part, location: { mode: 'clear' as const } })),
  }
  assert.deepEqual(inputManifest(assigned, subject, 'reading', [], null), before)
})
