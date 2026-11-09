import { test } from 'node:test'
import assert from 'node:assert/strict'
import type {
  ProcessingAnswerDto,
  ProcessingEnvelopeV2Dto,
  ProcessingSnapshotDto,
  ProcessingJobDto,
} from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { sha256 } from '#/db/authority.ts'
import {
  acceptEnvelope,
  claimProcessingCommand,
  interruptProcessing,
  type ResearchCommand,
} from '#/processing/runner.ts'
import { processingFixture } from '../support/processing.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Capture = Awaited<ReturnType<Fixture['seedCapture']>>

async function start(
  fixture: Fixture,
  capture: Capture,
  stages: ProcessingJobDto['stage'][],
  subjectId = capture.packetB.id,
) {
  const response = await fixture.http(`/batches/${capture.batch.id}/processing`, {
    schema_version: 'bench-intake-processing/1',
    expected_capture_revision: capture.batch.revision,
    subject_ids: [subjectId],
    stages,
  })
  assert.equal(response.status, 202)
  return response.value.attempt_ids as string[]
}

async function read(fixture: Fixture, batchId: string): Promise<ProcessingSnapshotDto> {
  const response = await fixture.http(`/batches/${batchId}/processing`)
  assert.equal(response.status, 200)
  return response.value
}

async function claim(fixture: Fixture, attemptId: string) {
  const commands = await fixture.db.pool.query(
    `SELECT command.workflow_id, command.payload_bytes
     FROM command JOIN processing_attempt attempt ON attempt.command_id = command.id
     WHERE attempt.id = $1`,
    [attemptId],
  )
  const retained = commands.rows[0]
  return claimProcessingCommand(
    fixture.runner.pool,
    fixture.config,
    retained.workflow_id,
    strictJson(retained.payload_bytes.toString('utf8')),
    'processing/2',
  )
}

function envelope(
  command: ResearchCommand,
  sequence: string,
  content:
    | Pick<Extract<ProcessingEnvelopeV2Dto, { kind: 'proposal' }>, 'kind' | 'payload'>
    | Pick<Extract<ProcessingEnvelopeV2Dto, { kind: 'question' }>, 'kind' | 'payload'>
    | Pick<Extract<ProcessingEnvelopeV2Dto, { kind: 'terminal' }>, 'kind' | 'payload'>,
): ProcessingEnvelopeV2Dto {
  return {
    schema_version: 'bench-intake-runner/2',
    profile_id: 'synthetic-research/2',
    handler_version: 'processing/2',
    job_id: command.payload.job_id,
    attempt_id: command.payload.attempt_id,
    command_id: command.payload.command_id,
    input_sha256: command.payload.input_sha256,
    sequence,
    ...content,
  }
}

function proposal(command: ResearchCommand, sequence = '1') {
  const note = command.manifest.notes[0]
  return envelope(command, sequence, {
    kind: 'proposal',
    payload: {
      schema_version: 'bench-intake-proposal/2',
      subject_id: command.manifest.subject_id,
      summary: 'Synthetic retained predecessor receipt; no inference or inventory access.',
      sources: [{ kind: 'note', note_id: note.id, text_sha256: sha256(note.text).toString('hex') }],
    },
  })
}

async function finish(fixture: Fixture, command: ResearchCommand, sequence = '1') {
  return acceptEnvelope(
    fixture.runner.pool,
    fixture.config,
    command.channelToken,
    envelope(command, sequence, { kind: 'terminal', payload: { state: 'ready' } }),
  )
}

async function readyPredecessor(fixture: Fixture, attemptId: string) {
  const command = await claim(fixture, attemptId)
  assert.ok(command)
  assert.equal(await finish(fixture, command), 'accepted')
  return command
}

test('replaced predecessor makes running output stale while its physical lane remains held', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const [readingId, researchId] = await start(fixture, capture, ['reading', 'research'])
    const queued = await read(fixture, capture.batch.id)
    assert.ok(queued.jobs.every((job) => job.state === 'queued'))
    assert.equal(await claim(fixture, researchId), null, 'unfinished predecessor cannot run')
    await readyPredecessor(fixture, readingId)
    const research = await claim(fixture, researchId)
    assert.ok(research)
    await start(fixture, capture, ['reading'])

    const oldOutput = proposal(research)
    assert.equal(
      await acceptEnvelope(fixture.runner.pool, fixture.config, research.channelToken, oldOutput),
      'stale',
      'replacing a predecessor must reject already-running dependent output',
    )
    const snapshot = await read(fixture, capture.batch.id)
    const job = snapshot.jobs.find((job) => job.stage === 'research')!
    assert.equal(job.state, 'superseded')
    assert.equal(job.proposals.length, 0)
    const activity = await fixture.http('/processing-activity')
    assert.equal(activity.value.lane_occupied, true)
    const occupied = activity.value.jobs.find(
      (job: { attempt_id: string }) => job.attempt_id === researchId,
    )
    assert.deepEqual(occupied, {
      batch_id: capture.batch.id,
      job_id: research.payload.job_id,
      attempt_id: researchId,
      state: 'running',
      input_current: false,
      occupies_lane: true,
    })
    assert.deepEqual(
      (
        await fixture.db.pool.query(
          'SELECT disposition FROM processing_message WHERE attempt_id=$1',
          [researchId],
        )
      ).rows,
      [{ disposition: 'stale' }],
    )
    assert.equal(await finish(fixture, research, '2'), 'stale')
    assert.equal((await fixture.http('/processing-activity')).value.lane_occupied, false)
  } finally {
    await fixture.dispose()
  }
})

test('ready output and transitive dependents become noncurrent without erasing retained proposals', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const [readingId, identifyingId, researchId] = await start(fixture, capture, [
      'reading',
      'identifying',
      'research',
    ])
    await readyPredecessor(fixture, readingId)
    await readyPredecessor(fixture, identifyingId)
    const research = await claim(fixture, researchId)
    assert.ok(research)
    assert.equal(
      await acceptEnvelope(
        fixture.runner.pool,
        fixture.config,
        research.channelToken,
        proposal(research),
      ),
      'accepted',
    )
    assert.equal(await finish(fixture, research, '2'), 'accepted')
    assert.ok((await read(fixture, capture.batch.id)).jobs.every((job) => job.state === 'ready'))

    const [replacementId] = await start(fixture, capture, ['reading'])
    let snapshot = await read(fixture, capture.batch.id)
    assert.equal(snapshot.jobs.find((job) => job.stage === 'identifying')!.state, 'superseded')
    assert.equal(snapshot.jobs.find((job) => job.stage === 'research')!.state, 'superseded')
    assert.equal(snapshot.jobs.find((job) => job.stage === 'research')!.proposals.length, 1)
    await readyPredecessor(fixture, replacementId)
    snapshot = await read(fixture, capture.batch.id)
    assert.equal(
      snapshot.jobs.find((job) => job.stage === 'research')!.state,
      'superseded',
      'a ready replacement must not redirect an exact old dependency',
    )
  } finally {
    await fixture.dispose()
  }
})

test('a stale predecessor question cannot mutate capture or create a continuation', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const [readingId, researchId] = await start(fixture, capture, ['reading', 'research'])
    await readyPredecessor(fixture, readingId)
    const research = await claim(fixture, researchId)
    assert.ok(research)
    assert.equal(
      await acceptEnvelope(
        fixture.runner.pool,
        fixture.config,
        research.channelToken,
        envelope(research, '1', {
          kind: 'question',
          payload: {
            kind: 'quantity',
            subject_id: capture.packetB.id,
            prompt: 'Confirm the synthetic packet quantity.',
            reason: 'This deterministic fixture requests human confirmation.',
          },
        }),
      ),
      'accepted',
    )
    const waiting = await read(fixture, capture.batch.id)
    const question = waiting.jobs.find((job) => job.stage === 'research')!.questions[0]
    const answer: ProcessingAnswerDto = {
      schema_version: 'bench-intake-answer/1',
      expected_question_revision: question.revision,
      expected_capture_revision: capture.batch.revision,
      attempt_id: question.attempt_id,
      input_sha256: question.input_sha256,
      value: { kind: 'quantity', value: '77.000001', basis: 'counted' },
    }
    await start(fixture, capture, ['reading'])
    const before = await fixture.http(`/batches/${capture.batch.id}`)
    const refused = await fixture.http(
      `/batches/${capture.batch.id}/questions/${question.id}/answers`,
      answer,
    )
    assert.equal(refused.status, 412)
    assert.equal(refused.value.code, 'stale_question')
    assert.deepEqual((await fixture.http(`/batches/${capture.batch.id}`)).value, before.value)
    const stale = (await read(fixture, capture.batch.id)).jobs.find(
      (job) => job.stage === 'research',
    )!
    assert.equal(stale.state, 'superseded')
    assert.equal(stale.questions[0].state, 'superseded')
    assert.equal(
      (await fixture.db.pool.query('SELECT count(*) FROM processing_answer')).rows[0].count,
      '0',
    )
  } finally {
    await fixture.dispose()
  }
})

test('running output checks ancestors beyond its immediate selected ready dependency', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const [readingId, identifyingId, researchId] = await start(fixture, capture, [
      'reading',
      'identifying',
      'research',
    ])
    await readyPredecessor(fixture, readingId)
    await readyPredecessor(fixture, identifyingId)
    const research = await claim(fixture, researchId)
    assert.ok(research)
    await start(fixture, capture, ['reading'])
    assert.equal(
      await acceptEnvelope(
        fixture.runner.pool,
        fixture.config,
        research.channelToken,
        proposal(research),
      ),
      'stale',
    )
    assert.equal((await fixture.http('/processing-activity')).value.lane_occupied, true)
    await interruptProcessing(fixture.runner.pool, fixture.config, researchId)
    assert.equal((await fixture.http('/processing-activity')).value.lane_occupied, false)
  } finally {
    await fixture.dispose()
  }
})

for (const corruption of ['missing', 'extra'] as const) {
  test(`retained ${corruption} dependency edge is refused instead of becoming empty authority`, async () => {
    const fixture = await processingFixture()
    try {
      const capture = await fixture.seedCapture()
      const [readingId, researchId] = await start(fixture, capture, ['reading', 'research'])
      await readyPredecessor(fixture, readingId)
      if (corruption === 'missing') {
        // Only this disposable owned database is faulted; no shared service or migration changes.
        await fixture.db.pool.query(
          'ALTER TABLE processing_dependency DISABLE TRIGGER processing_dependency_immutable',
        )
        try {
          await fixture.db.pool.query('DELETE FROM processing_dependency WHERE attempt_id=$1', [
            researchId,
          ])
        } finally {
          await fixture.db.pool.query(
            'ALTER TABLE processing_dependency ENABLE TRIGGER processing_dependency_immutable',
          )
        }
      } else {
        const [otherReadingId] = await start(fixture, capture, ['reading'], capture.packetA.id)
        await fixture.db.pool.query(
          'INSERT INTO processing_dependency(batch_id,attempt_id,dependency_attempt_id) VALUES($1,$2,$3)',
          [capture.batch.id, researchId, otherReadingId],
        )
      }
      const refused = await fixture.http(`/batches/${capture.batch.id}/processing`)
      assert.equal(refused.status, 409)
      assert.equal(refused.value.code, 'processing_dependency_binding_invalid')
      await assert.rejects(
        () => claim(fixture, researchId),
        /processing_dependency_binding_invalid/,
      )
      assert.equal(
        (await fixture.db.pool.query('SELECT attempt_id FROM processing_lane')).rows[0].attempt_id,
        null,
      )
    } finally {
      await fixture.dispose()
    }
  })
}

test('a fresh research answer continuation retains exact ready historical predecessors', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const [readingId, researchId, imagesId] = await start(fixture, capture, [
      'reading',
      'research',
      'images',
    ])
    await readyPredecessor(fixture, readingId)
    const research = await claim(fixture, researchId)
    assert.ok(research)
    assert.equal(
      await acceptEnvelope(
        fixture.runner.pool,
        fixture.config,
        research.channelToken,
        envelope(research, '1', {
          kind: 'question',
          payload: {
            kind: 'quantity',
            subject_id: capture.packetB.id,
            prompt: 'Confirm the synthetic packet quantity.',
            reason: 'This deterministic fixture requests human confirmation.',
          },
        }),
      ),
      'accepted',
    )
    const waiting = await read(fixture, capture.batch.id)
    const question = waiting.jobs.find((job) => job.stage === 'research')!.questions[0]
    const answered = await fixture.http(
      `/batches/${capture.batch.id}/questions/${question.id}/answers`,
      {
        schema_version: 'bench-intake-answer/1',
        expected_question_revision: question.revision,
        expected_capture_revision: capture.batch.revision,
        attempt_id: question.attempt_id,
        input_sha256: question.input_sha256,
        value: { kind: 'quantity', value: '77.000001', basis: 'counted' },
      },
    )
    assert.equal(answered.status, 200)
    const continued = await read(fixture, capture.batch.id)
    const continuedResearch = continued.jobs.find((job) => job.stage === 'research')!
    const continuedImages = continued.jobs.find((job) => job.stage === 'images')!
    assert.equal(continuedResearch.state, 'queued')
    assert.equal(continuedImages.state, 'queued')
    assert.notEqual(continuedResearch.attempt_id, researchId)
    assert.notEqual(continuedImages.attempt_id, imagesId)
    const freshResearch = await claim(fixture, continuedResearch.attempt_id)
    assert.ok(freshResearch)
    assert.deepEqual(freshResearch.manifest.dependencies, [readingId])
    assert.ok('quantity' in freshResearch.manifest.subject)
    assert.deepEqual(freshResearch.manifest.subject.quantity, { mode: 'set', value: '77.000001' })
    assert.equal(await finish(fixture, freshResearch), 'accepted')
    const freshImages = await claim(fixture, continuedImages.attempt_id)
    assert.ok(freshImages)
    assert.deepEqual(freshImages.manifest.dependencies, [freshResearch.payload.attempt_id])
    assert.equal(await finish(fixture, freshImages), 'accepted')
    const saved = await fixture.http(`/batches/${capture.batch.id}`)
    assert.deepEqual(
      saved.value.lots.find((lot: { id: string }) => lot.id === capture.packetB.id).quantity,
      {
        mode: 'set',
        value: '77.000001',
      },
    )
  } finally {
    await fixture.dispose()
  }
})

test('cancelled transitive predecessor invalidates queued descendants without occupying a lane', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const [, , researchId] = await start(fixture, capture, ['reading', 'identifying', 'research'])
    const queued = await read(fixture, capture.batch.id)
    const reading = queued.jobs.find((job) => job.stage === 'reading')!
    const cancelled = await fixture.http(
      `/batches/${capture.batch.id}/processing/${reading.id}/cancellation`,
      {
        expected_revision: reading.revision,
        attempt_id: reading.attempt_id,
      },
    )
    assert.equal(cancelled.status, 200)
    const stale = await read(fixture, capture.batch.id)
    assert.equal(stale.jobs.find((job) => job.stage === 'reading')!.state, 'cancelled')
    assert.equal(stale.jobs.find((job) => job.stage === 'identifying')!.state, 'superseded')
    assert.equal(stale.jobs.find((job) => job.stage === 'research')!.state, 'superseded')
    assert.equal(await claim(fixture, researchId), null)
    assert.equal((await fixture.http('/processing-activity')).value.lane_occupied, false)
  } finally {
    await fixture.dispose()
  }
})
