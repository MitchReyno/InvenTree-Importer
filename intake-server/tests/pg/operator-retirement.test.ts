import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type {
  CaptureSnapshotDto,
  ProcessingAnswerDto,
  ProcessingEnvelopeDto,
  ProcessingEnvelopeV2Dto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { processingFixture } from '../support/processing.ts'
import { acceptEnvelope, claimProcessingCommand } from '#/processing/runner.ts'
import { operatorRepository } from '#/operator-review/repository.ts'
import { sha256 } from '#/db/authority.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Claimed = NonNullable<Awaited<ReturnType<typeof claim>>>

async function claim(fixture: Fixture, attemptId: string) {
  const commands = await fixture.db.pool.query(
    `SELECT command.workflow_id,command.payload_bytes FROM command
     JOIN processing_attempt attempt ON attempt.command_id=command.id WHERE attempt.id=$1`,
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
  command: Claimed,
  sequence: string,
  content:
    | Pick<Extract<ProcessingEnvelopeV2Dto, { kind: 'question' }>, 'kind' | 'payload'>
    | Pick<Extract<ProcessingEnvelopeV2Dto, { kind: 'terminal' }>, 'kind' | 'payload'>
    | Pick<Extract<ProcessingEnvelopeV2Dto, { kind: 'proposal' }>, 'kind' | 'payload'>,
): ProcessingEnvelopeDto {
  return {
    schema_version: 'bench-intake-runner/2',
    job_id: command.payload.job_id,
    attempt_id: command.payload.attempt_id,
    command_id: command.payload.command_id,
    input_sha256: command.payload.input_sha256,
    profile_id: 'synthetic-research/2',
    handler_version: 'processing/2',
    sequence,
    ...content,
  }
}

async function batch(fixture: Fixture, batchId: string): Promise<CaptureSnapshotDto> {
  const response = await fixture.http(`/batches/${batchId}`)
  assert.equal(response.status, 200)
  return response.value
}

async function read(fixture: Fixture, batchId: string): Promise<ProcessingSnapshotDto> {
  const response = await fixture.http(`/batches/${batchId}/processing`)
  assert.equal(response.status, 200, JSON.stringify(response.value))
  return response.value
}

function startBody(revision: string, subjectIds: string[]) {
  return {
    schema_version: 'bench-intake-processing/1',
    expected_capture_revision: revision,
    subject_ids: subjectIds,
    stages: ['reading'],
  }
}

/** Trusted setup through the real operator restructure command; Processing sees only capture. */
async function retire(fixture: Fixture, batchId: string, lotId: string) {
  const current = await batch(fixture, batchId)
  const result = await operatorRepository(fixture.db.pool, fixture.config).restructure(
    batchId,
    randomUUID(),
    {
      expected_revision: current.revision,
      preview: false,
      change: {
        kind: 'split_lot',
        lot_id: lotId,
        children: [
          { label: 'Half one', quantity: '10' },
          { label: 'Half two', quantity: '10' },
        ],
      },
    },
  )
  assert.equal(result.status, 'applied')
  const retired = await batch(fixture, batchId)
  assert.equal(retired.lots.find((lot) => lot.id === lotId)?.retired, true)
  return retired
}

async function attemptState(fixture: Fixture, attemptId: string) {
  const result = await fixture.db.pool.query('SELECT state FROM processing_attempt WHERE id=$1', [
    attemptId,
  ])
  return result.rows[0].state as string
}

test('a retired lot refuses new starts while an unrelated active lot still starts', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const retired = await retire(fixture, batchId, capture.packetA.id)
    // Active lots keep their exact snapshot shape.
    assert.equal(
      Object.hasOwn(
        retired.lots.find((lot) => lot.id === capture.packetB.id)!,
        'retired',
      ),
      false,
    )

    const refused = await fixture.http(
      `/batches/${batchId}/processing`,
      startBody(retired.revision, [capture.packetA.id]),
    )
    assert.equal(refused.status, 409)
    assert.equal(refused.value.code, 'subject_retired')
    const mixed = await fixture.http(
      `/batches/${batchId}/processing`,
      startBody(retired.revision, [capture.packetA.id, capture.packetB.id]),
    )
    assert.equal(mixed.status, 409)
    assert.equal(mixed.value.code, 'subject_retired')
    assert.equal((await read(fixture, batchId)).jobs.length, 0, 'a refused start creates no job')

    const active = await fixture.http(
      `/batches/${batchId}/processing`,
      startBody(retired.revision, [capture.packetB.id]),
    )
    assert.equal(active.status, 202, JSON.stringify(active.value))
    const claimed = await claim(fixture, active.value.attempt_ids[0])
    assert.ok(claimed, 'the active lot is still claimable')
  } finally {
    await fixture.dispose()
  }
})

test('a queued attempt for a lot retired before claim is superseded without running', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const started = await fixture.http(
      `/batches/${batchId}/processing`,
      startBody(capture.batch.revision, [capture.packetA.id]),
    )
    assert.equal(started.status, 202)
    const attemptId = started.value.attempt_ids[0]
    await retire(fixture, batchId, capture.packetA.id)

    assert.equal(await claim(fixture, attemptId), null)
    assert.equal(await attemptState(fixture, attemptId), 'superseded')
    const activity = await fixture.http('/processing-activity')
    assert.equal(activity.value.lane_occupied, false, 'no child work holds the lane')
    const job = (await read(fixture, batchId)).jobs[0]
    assert.equal(job.state, 'superseded')
  } finally {
    await fixture.dispose()
  }
})

test('retirement makes an open question stale and keeps retained history readable', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const started = await fixture.http(
      `/batches/${batchId}/processing`,
      startBody(capture.batch.revision, [capture.packetA.id]),
    )
    const command = await claim(fixture, started.value.attempt_ids[0])
    assert.ok(command)
    const note = command.manifest.notes[0]
    const proposal = envelope(command, '1', {
      kind: 'proposal',
      payload: {
        schema_version: 'bench-intake-proposal/2',
        subject_id: capture.packetA.id,
        summary: 'Synthetic candidate only.',
        sources: [
          { kind: 'note', note_id: note.id, text_sha256: sha256(note.text).toString('hex') },
        ],
      },
    })
    const question = envelope(command, '2', {
      kind: 'question',
      payload: {
        kind: 'quantity',
        subject_id: capture.packetA.id,
        prompt: 'How many are in Packet A?',
        reason: 'The label is approximate.',
      },
    })
    for (const message of [proposal, question]) {
      assert.equal(
        await acceptEnvelope(fixture.runner.pool, fixture.config, command.channelToken, message),
        'accepted',
      )
    }
    const open = (await read(fixture, batchId)).jobs[0].questions[0]
    assert.equal(open.state, 'open')

    const retired = await retire(fixture, batchId, capture.packetA.id)
    const answer: ProcessingAnswerDto = {
      schema_version: 'bench-intake-answer/1',
      expected_question_revision: open.revision,
      expected_capture_revision: retired.revision,
      attempt_id: open.attempt_id,
      input_sha256: open.input_sha256,
      value: { kind: 'quantity', value: '20', basis: 'counted' },
    }
    const refused = await fixture.http(`/batches/${batchId}/questions/${open.id}/answers`, answer)
    assert.equal(refused.status, 412, JSON.stringify(refused.value))
    assert.equal(refused.value.code, 'stale_question')

    const after = await read(fixture, batchId)
    const job = after.jobs[0]
    assert.equal(job.state, 'superseded')
    assert.equal(job.questions[0].state, 'superseded')
    assert.equal(job.proposals.length, 1, 'retained proposal stays listed as history')
    const unchanged = await batch(fixture, batchId)
    assert.deepEqual(
      unchanged.lots.find((lot) => lot.id === capture.packetA.id)!.quantity,
      { mode: 'inherit' },
      'a refused answer writes nothing',
    )
  } finally {
    await fixture.dispose()
  }
})

test('exact redelivery of a start and an answer committed before retirement adopts the original receipt', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const body = startBody(capture.batch.revision, [capture.packetA.id])
    const startKey = randomUUID()
    const started = await fixture.http(`/batches/${batchId}/processing`, body, startKey)
    assert.equal(started.status, 202)
    const command = await claim(fixture, started.value.attempt_ids[0])
    assert.ok(command)
    await acceptEnvelope(
      fixture.runner.pool,
      fixture.config,
      command.channelToken,
      envelope(command, '1', {
        kind: 'question',
        payload: {
          kind: 'quantity',
          subject_id: capture.packetA.id,
          prompt: 'How many are in Packet A?',
          reason: 'The label is approximate.',
        },
      }),
    )
    const open = (await read(fixture, batchId)).jobs[0].questions[0]
    const answer: ProcessingAnswerDto = {
      schema_version: 'bench-intake-answer/1',
      expected_question_revision: open.revision,
      expected_capture_revision: capture.batch.revision,
      attempt_id: open.attempt_id,
      input_sha256: open.input_sha256,
      value: { kind: 'quantity', value: '20', basis: 'counted' },
    }
    const answerKey = randomUUID()
    const answered = await fixture.http(
      `/batches/${batchId}/questions/${open.id}/answers`,
      answer,
      answerKey,
    )
    assert.equal(answered.status, 200, JSON.stringify(answered.value))

    await retire(fixture, batchId, capture.packetA.id)
    const attemptsBefore = await fixture.db.pool.query('SELECT count(*) FROM processing_attempt')

    const restart = await fixture.http(`/batches/${batchId}/processing`, body, startKey)
    assert.deepEqual(restart, started)
    const reanswer = await fixture.http(
      `/batches/${batchId}/questions/${open.id}/answers`,
      answer,
      answerKey,
    )
    assert.deepEqual(reanswer, answered)
    const attemptsAfter = await fixture.db.pool.query('SELECT count(*) FROM processing_attempt')
    assert.equal(attemptsAfter.rows[0].count, attemptsBefore.rows[0].count, 'no new work')
  } finally {
    await fixture.dispose()
  }
})

test('a running attempt keeps its held lane after retirement until its exact terminal', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const started = await fixture.http(
      `/batches/${batchId}/processing`,
      startBody(capture.batch.revision, [capture.packetA.id]),
    )
    const command = await claim(fixture, started.value.attempt_ids[0])
    assert.ok(command)

    await retire(fixture, batchId, capture.packetA.id)
    const held = await fixture.http('/processing-activity')
    assert.equal(held.value.lane_occupied, true)
    assert.deepEqual(
      held.value.jobs.find(
        (job: { attempt_id: string }) => job.attempt_id === command.payload.attempt_id,
      ),
      {
        batch_id: batchId,
        job_id: command.payload.job_id,
        attempt_id: command.payload.attempt_id,
        state: 'running',
        input_current: false,
        occupies_lane: true,
      },
    )

    assert.equal(
      await acceptEnvelope(
        fixture.runner.pool,
        fixture.config,
        command.channelToken,
        envelope(command, '1', { kind: 'terminal', payload: { state: 'ready' } }),
      ),
      'stale',
    )
    const released = await fixture.http('/processing-activity')
    assert.equal(released.value.lane_occupied, false)
  } finally {
    await fixture.dispose()
  }
})
