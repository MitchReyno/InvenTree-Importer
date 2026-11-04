import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ProcessingEnvelopeV2Dto } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { processingFixture } from '../support/processing.ts'
import { processingMediaFixture } from '../support/processing-media.ts'
import { acceptEnvelope, claimProcessingCommand } from '../../src/processing/runner.ts'
import { executeProcessingCommand } from '../../src/processing/delivery.ts'
import { syntheticDevelopmentRunner } from '../../src/dev/synthetic-runner.ts'
import { automationNoteId } from '../../src/capture/context-input.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

async function claim(fixture: Fixture, attemptId: string) {
  const commands = await fixture.db.pool.query(
    `SELECT command.workflow_id, command.payload_bytes
     FROM command JOIN processing_attempt attempt ON attempt.command_id = command.id
     WHERE attempt.id = $1`,
    [attemptId],
  )
  const command = await claimProcessingCommand(
    fixture.runner.pool,
    fixture.config,
    commands.rows[0].workflow_id,
    strictJson(commands.rows[0].payload_bytes.toString('utf8')),
    'processing/2',
  )
  assert.ok(command)
  return command
}

type Claimed = Awaited<ReturnType<typeof claim>>

function proposal(command: Claimed, sequence: string, payload: Record<string, unknown>) {
  return {
    schema_version: 'bench-intake-runner/2',
    profile_id: 'synthetic-research/2',
    handler_version: 'processing/2',
    job_id: command.payload.job_id,
    attempt_id: command.payload.attempt_id,
    command_id: command.payload.command_id,
    input_sha256: command.payload.input_sha256,
    sequence,
    kind: 'proposal',
    payload,
  } as ProcessingEnvelopeV2Dto
}

async function setup(note = '') {
  const fixture = await processingFixture()
  const created = await fixture.http('/batches', { title: 'Estimated packets', note })
  assert.equal(created.status, 201)
  let batch = created.value
  async function edit(change: unknown) {
    const result = await fixture.http(`/batches/${batch.id}/edits`, {
      expected_revision: batch.revision,
      change,
    })
    assert.equal(result.status, 200, JSON.stringify(result.value))
    batch = result.value
  }
  await edit({ kind: 'add_part', label: 'Shared reel' })
  const partId = batch.parts[0].id
  await edit({ kind: 'add_lot', label: 'Opened reel', note: '', part_subject_id: partId })
  const lotId = batch.lots[0].id
  const media = await processingMediaFixture(fixture, batch.id)
  const ready = await media.upload(lotId, 'Reel label photo')
  await media.decodeNext()
  const source = {
    kind: 'media_version',
    evidence_id: ready.evidence_id,
    version_id: ready.version.id,
    sha256: ready.version.digest,
  }
  async function start(subjectId: string) {
    const started = await fixture.http(`/batches/${batch.id}/processing`, {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: batch.revision,
      subject_ids: [subjectId],
      stages: ['reading'],
    })
    assert.equal(started.status, 202, JSON.stringify(started.value))
    return claim(fixture, started.value.attempt_ids[0])
  }
  return {
    fixture,
    media,
    get batch() {
      return batch
    },
    edit,
    start,
    lotId,
    partId,
    source,
  }
}

const base = (subjectId: string, source: unknown) => ({
  schema_version: 'bench-intake-proposal/4',
  subject_id: subjectId,
  summary: 'Deterministic fixture estimate from the label photo; not model reasoning.',
  sources: [source],
})

test(
  'an evidence-bound quantity estimate is retained for a lot and refused for a Part',
  { timeout: 60000 },
  async () => {
    // Ordinary evidence quoting the marker is not requested automation.
    const s = await setup(
      'Requested automation, not approved inventory effects:\nShared part tags: Auto requested',
    )
    try {
      const reading = await s.start(s.lotId)
      const accept = (envelope: ProcessingEnvelopeV2Dto) =>
        acceptEnvelope(s.fixture.runner.pool, s.fixture.config, reading.channelToken, envelope)
      await assert.rejects(
        accept(
          proposal(reading, '1', {
            ...base(s.lotId, s.source),
            tags: ['smd'],
          }),
        ),
        /auto_tags_not_requested/,
      )
      assert.equal(
        await accept(
          proposal(reading, '1', {
            ...base(s.lotId, s.source),
            quantity: { value: '40', status: 'estimated' },
          }),
        ),
        'accepted',
      )
      const snapshot = await s.fixture.http(`/batches/${s.batch.id}/processing`)
      const job = snapshot.value.jobs.find(
        (value: { attempt_id: string }) => value.attempt_id === reading.payload.attempt_id,
      )
      assert.deepEqual(job.proposals[0].value.quantity, { value: '40', status: 'estimated' })
      assert.deepEqual(
        s.batch.lots[0].quantity,
        { mode: 'inherit' },
        'a suggestion never becomes a chosen count',
      )

      await accept({
        ...proposal(reading, '2', {}),
        kind: 'terminal',
        payload: { state: 'ready' },
      } as ProcessingEnvelopeV2Dto)
      const partPhoto = await s.media.upload(s.partId, 'Part datasheet photo')
      await s.media.decodeNext()
      const partSource = {
        kind: 'media_version',
        evidence_id: partPhoto.evidence_id,
        version_id: partPhoto.version.id,
        sha256: partPhoto.version.digest,
      }
      const part = await s.start(s.partId)
      await assert.rejects(
        acceptEnvelope(
          s.fixture.runner.pool,
          s.fixture.config,
          part.channelToken,
          proposal(part, '1', {
            ...base(s.partId, partSource),
            quantity: { value: '40', status: 'estimated' },
          }),
        ),
        /invalid_proposal|runner_source_mismatch/,
      )
    } finally {
      await s.media.dispose?.()
      await s.fixture.dispose()
    }
  },
)

test(
  'tag suggestions need Auto tags in the sealed input, and a human count makes an estimate stale',
  { timeout: 60000 },
  async () => {
    const s = await setup()
    try {
      await s.edit({
        kind: 'batch_settings',
        title: s.batch.title,
        default_location: { mode: 'unset' },
        intent: {
          supplier: { absent: false, selection: { mode: 'unset' } },
          order: { reference: { mode: 'auto' }, purchase_date: { mode: 'auto' } },
          shared_tags: { manual: ['reel'], auto: true },
        },
        notes: { batch: null, order: null },
        drafts: [],
      })
      const reading = await s.start(s.lotId)
      assert.ok(
        reading.manifest.notes.some((note) =>
          note.text.includes('Shared part tags: Auto requested'),
        ),
      )
      const accept = (envelope: ProcessingEnvelopeV2Dto) =>
        acceptEnvelope(s.fixture.runner.pool, s.fixture.config, reading.channelToken, envelope)
      assert.equal(
        await accept(
          proposal(reading, '1', {
            ...base(s.lotId, s.source),
            quantity: { value: '40', status: 'estimated' },
            tags: ['smd', '0603'],
          }),
        ),
        'accepted',
      )

      // A newer human count makes the attempt's input stale; a later estimate is history only.
      await s.edit({ kind: 'lot', id: s.lotId, quantity: { mode: 'set', value: '37' } })
      assert.equal(
        await accept(
          proposal(reading, '2', {
            ...base(s.lotId, s.source),
            quantity: { value: '50', status: 'estimated' },
          }),
        ),
        'stale',
      )
      const snapshot = await s.fixture.http(`/batches/${s.batch.id}/processing`)
      const job = snapshot.value.jobs.find(
        (value: { attempt_id: string }) => value.attempt_id === reading.payload.attempt_id,
      )
      assert.equal(job.proposals.length, 1)
      assert.deepEqual(s.batch.lots[0].quantity, { mode: 'set', value: '37' })
    } finally {
      await s.media.dispose?.()
      await s.fixture.dispose()
    }
  },
)

test(
  'a new-Part create choice runs as input /5, so Auto tag suggestions stay current for acceptance',
  { timeout: 60000 },
  async () => {
    const s = await setup()
    try {
      const categoryId = (await import('node:crypto')).randomUUID()
      const identity = await s.fixture.db.pool.query(
        'SELECT target_id, target_context_id FROM capture_batch WHERE id=$1',
        [s.batch.id],
      )
      await s.fixture.db.pool.query(
        `INSERT INTO capture_observation(id,batch_id,target_id,target_context_id,model,pk,label,mapping)
         VALUES($1,$2,$3,$4,'category','81','Reels',$5)`,
        [
          categoryId,
          s.batch.id,
          identity.rows[0].target_id,
          identity.rows[0].target_context_id,
          { kind: 'category' },
        ],
      )
      await s.edit({
        kind: 'batch_settings',
        title: s.batch.title,
        default_location: { mode: 'unset' },
        intent: {
          supplier: { absent: false, selection: { mode: 'unset' } },
          order: { reference: { mode: 'auto' }, purchase_date: { mode: 'auto' } },
          shared_tags: { manual: [], auto: true },
        },
        notes: { batch: null, order: null },
        drafts: [],
      })
      await s.edit({
        kind: 'part',
        id: s.partId,
        choice: {
          mode: 'create',
          spec: {
            name: 'Reel',
            category: {
              observation_id: categoryId,
              target_context_id: identity.rows[0].target_context_id,
              model: 'category',
              pk: '81',
            },
            parameters: [],
            manufacturer: null,
            supplier: null,
            tags: [],
          },
        },
      })
      const reading = await s.start(s.lotId)
      assert.equal(reading.manifest.schema_version, 'bench-intake-input/5')
      const accept = (envelope: ProcessingEnvelopeV2Dto) =>
        acceptEnvelope(s.fixture.runner.pool, s.fixture.config, reading.channelToken, envelope)
      assert.equal(
        await accept(proposal(reading, '1', { ...base(s.lotId, s.source), tags: ['0603'] })),
        'accepted',
      )
      await accept({
        ...proposal(reading, '2', {}),
        kind: 'terminal',
        payload: { state: 'ready' },
      } as ProcessingEnvelopeV2Dto)
      const snapshot = await s.fixture.http(`/batches/${s.batch.id}/processing`)
      const job = snapshot.value.jobs.find(
        (value: { attempt_id: string }) => value.attempt_id === reading.payload.attempt_id,
      )
      assert.equal(job.state, 'ready', 'the create choice no longer makes the attempt stale')
      assert.deepEqual(job.proposals[0].value.tags, ['0603'])
      assert.equal(snapshot.value.capture_revision, s.batch.revision)
    } finally {
      await s.media.dispose?.()
      await s.fixture.dispose()
    }
  },
)

test(
  'the development runner completes an Auto tags attempt without citing the intent note',
  { timeout: 60000 },
  async () => {
    const s = await setup('Two reels in the drawer')
    try {
      await s.edit({
        kind: 'batch_settings',
        title: s.batch.title,
        default_location: { mode: 'unset' },
        intent: {
          supplier: { absent: false, selection: { mode: 'unset' } },
          order: { reference: { mode: 'auto' }, purchase_date: { mode: 'auto' } },
          shared_tags: { manual: [], auto: true },
        },
        notes: { batch: null, order: null },
        drafts: [],
      })
      const started = await s.fixture.http(`/batches/${s.batch.id}/processing`, {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: s.batch.revision,
        subject_ids: [s.lotId],
        stages: ['reading'],
      })
      assert.equal(started.status, 202, JSON.stringify(started.value))
      const commands = await s.fixture.db.pool.query(
        `SELECT command.workflow_id, command.payload_bytes
         FROM command JOIN processing_attempt attempt ON attempt.command_id = command.id
         WHERE attempt.id = $1`,
        [started.value.attempt_ids[0]],
      )
      const outcome = await executeProcessingCommand(
        s.fixture.runner.pool,
        s.fixture.config,
        commands.rows[0].workflow_id,
        strictJson(commands.rows[0].payload_bytes.toString('utf8')),
        syntheticDevelopmentRunner,
      )
      assert.deepEqual(outcome, { state: 'ready' })
      const snapshot = await s.fixture.http(`/batches/${s.batch.id}/processing`)
      const job = snapshot.value.jobs.find(
        (value: { attempt_id: string }) => value.attempt_id === started.value.attempt_ids[0],
      )
      assert.equal(job.state, 'ready')
      const cited = job.proposals[0].value.sources.flatMap((source: { note_id?: string }) =>
        source.note_id ? [source.note_id] : [],
      )
      assert.ok(cited.length > 0, 'the real batch note is still cited')
      assert.equal(cited.includes(automationNoteId(s.batch.id)), false)
    } finally {
      await s.media.dispose?.()
      await s.fixture.dispose()
    }
  },
)
