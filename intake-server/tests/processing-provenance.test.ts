import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { validate, type MediaInputManifestDto } from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { canonicalMedia } from '../src/media/encoding.ts'
import { sha256 } from '../src/db/authority.ts'
import {
  inputManifest,
  mediaInputManifest,
  processingSubjectScope,
  sealed,
} from '../src/processing/model.ts'
import { validateProposalSources } from '../src/processing/provenance.ts'
import { manualInputFixture } from './support/processing-input.ts'

/** Descriptor fixture only; no decoder, media bytes, model or provider is invoked. */
function mediaFixture(batchId: string, subjectId: string) {
  const evidenceId = randomUUID()
  const originalId = randomUUID()
  const cropId = randomUUID()
  const manifest: MediaInputManifestDto = {
    version: 'media-inputs/1',
    batchId,
    subjectIds: [subjectId],
    evidence: [{ evidenceId, groupId: null, linkedSubjectIds: [subjectId] }],
    attachments: [],
    versions: [
      {
        versionId: originalId,
        evidenceId,
        kind: 'original',
        digest: 'a'.repeat(64),
        byteSize: '100',
        mediaType: 'image/png',
        recipe: null,
      },
      {
        versionId: cropId,
        evidenceId,
        kind: 'derived',
        digest: 'b'.repeat(64),
        byteSize: '50',
        mediaType: 'image/png',
        recipe: {
          version: 'documentary-crop/1',
          source_version_id: originalId,
          source_digest: 'a'.repeat(64),
          page: 1,
          source_width: 64,
          source_height: 48,
          x: 8,
          y: 6,
          width: 32,
          height: 24,
          quarter_turns: 0,
        },
      },
    ],
  }
  const bytes = canonicalMedia(manifest)
  return {
    manifest,
    descriptor: { manifest: bytes, sha256: sha256(bytes).toString('hex') },
    evidenceId,
    cropId,
  }
}

test('V2 retains exact numeric media recipe bytes inside a string and permits real media-only scope', () => {
  const capture = manualInputFixture()
  capture.notes = []
  const media = mediaFixture(capture.id, capture.lots[0].id)
  assert.throws(() => canonical(media.manifest))

  const input = mediaInputManifest(
    capture,
    capture.lots[0].id,
    'reading',
    [],
    null,
    media.descriptor,
  )
  assert.doesNotThrow(() => validate('ProcessingInput', input))
  assert.throws(() => validate('ProcessingInputV1', input), /invalid_contract/)
  assert.deepEqual(input.notes, [])
  assert.equal(input.media.manifest, media.descriptor.manifest)
  assert.equal(input.media.sha256, media.descriptor.sha256)
  assert.equal(JSON.parse(input.media.manifest).versions[1].recipe.width, 32)
  assert.equal(JSON.parse(sealed(input).bytes.toString()).media.manifest, media.descriptor.manifest)
  assert.deepEqual(input.subject, capture.lots[0])

  const wrongScope = mediaFixture(capture.id, randomUUID())
  assert.throws(
    () =>
      mediaInputManifest(capture, capture.lots[0].id, 'reading', [], null, wrongScope.descriptor),
    /processing_media_binding_invalid/,
  )
  assert.throws(
    () =>
      mediaInputManifest(capture, capture.lots[0].id, 'reading', [], null, {
        ...media.descriptor,
        sha256: 'c'.repeat(64),
      }),
    /retained_bytes_corrupt/,
  )
})

test('a blank note cannot fabricate V2 evidence, and legacy input remains exact empty media', () => {
  const capture = manualInputFixture()
  const legacy = inputManifest(capture, capture.lots[0].id, 'reading', [], null)
  assert.doesNotThrow(() => validate('ProcessingInputV1', legacy))
  assert.equal(legacy.schema_version, 'bench-intake-input/1')
  assert.equal(
    legacy.instruction_sha256,
    '20902b83a2b36fcb0527f8376322275a78786671ddedb77f2bb1b177ba06c5f4',
  )
  assert.deepEqual(legacy.media, [])

  const media = mediaFixture(capture.id, capture.lots[0].id)
  media.manifest.versions = []
  media.manifest.evidence = []
  const bytes = canonicalMedia(media.manifest)
  const empty = { manifest: bytes, sha256: sha256(bytes).toString('hex') }
  capture.notes[0].text = ' \n '
  assert.throws(
    () => mediaInputManifest(capture, capture.lots[0].id, 'reading', [], null, empty),
    /retained_evidence_required/,
  )
})

test('typed provenance binds exact note text and media evidence/version/digest, never digest alone', () => {
  const capture = manualInputFixture()
  const media = mediaFixture(capture.id, capture.lots[0].id)
  const input = mediaInputManifest(
    capture,
    capture.lots[0].id,
    'research',
    [],
    null,
    media.descriptor,
  )
  const noteSource = {
    kind: 'note' as const,
    note_id: capture.notes[0].id,
    text_sha256: sha256(capture.notes[0].text).toString('hex'),
  }
  const mediaSource = {
    kind: 'media_version' as const,
    evidence_id: media.evidenceId,
    version_id: media.cropId,
    sha256: 'b'.repeat(64),
  }
  const proposal = {
    schema_version: 'bench-intake-proposal/2' as const,
    subject_id: capture.lots[0].id,
    summary: 'Synthetic metadata fixture; no image inspection or actual model inference.',
    sources: [noteSource, mediaSource],
  }
  assert.doesNotThrow(() => validate('ProcessingProposal', proposal))
  assert.doesNotThrow(() => validateProposalSources(input, proposal))

  for (const changedSource of [
    { ...noteSource, text_sha256: 'c'.repeat(64) },
    { ...noteSource, note_id: randomUUID() },
    { ...mediaSource, evidence_id: randomUUID() },
    { ...mediaSource, version_id: randomUUID() },
    { ...mediaSource, sha256: 'a'.repeat(64) },
  ]) {
    assert.throws(
      () => validateProposalSources(input, { ...proposal, sources: [changedSource] }),
      /runner_source_mismatch/,
    )
  }

  const legacy = inputManifest(capture, capture.lots[0].id, 'research', [], null)
  assert.throws(() => validateProposalSources(legacy, proposal), /runner_source_version_mismatch/)
  assert.throws(
    () =>
      validateProposalSources(input, {
        subject_id: capture.lots[0].id,
        summary: 'Legacy proposal cannot stand in for V2 provenance.',
        source_note_ids: [capture.notes[0].id],
      }),
    /runner_source_version_mismatch/,
  )
})

test('lot media closure includes exactly the lot and its linked Part', () => {
  const capture = manualInputFixture()
  const linkedPartId = randomUUID()
  const unrelatedPartId = randomUUID()
  capture.parts = [linkedPartId, unrelatedPartId].map((id) => ({
    id,
    label: 'Part',
    revision: '1',
    choice: { mode: 'unset' as const },
  }))
  capture.lots[0].part_subject_id = linkedPartId
  assert.deepEqual(
    processingSubjectScope(capture, capture.lots[0].id),
    [capture.lots[0].id, linkedPartId].sort(),
  )
  assert.deepEqual(processingSubjectScope(capture, linkedPartId), [linkedPartId])
})
