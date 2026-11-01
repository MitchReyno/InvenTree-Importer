import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type {
  ProcessingAnswerDto,
  ProcessingEnvelopeDto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { processingFixture } from '../support/processing.ts'
import {
  claimProcessingCommand,
  acceptEnvelope,
  interruptProcessing,
} from '../../src/processing/runner.ts'
import { answerQuestion } from '../../src/processing/answers.ts'
import { lockCaptureForEdit, captureRepository } from '../../src/capture/repository.ts'
import { database, transaction } from '../../src/db/database.ts'
import { commitAckProxy } from '../fixtures/commit-ack-proxy.ts'
import { sha256 } from '../../src/db/authority.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

async function retainedCommand(fixture: Fixture, attemptId: string) {
  const commands = await fixture.db.pool.query(
    `SELECT command.workflow_id,command.payload_bytes FROM command
     JOIN processing_attempt attempt ON attempt.command_id=command.id WHERE attempt.id=$1`,
    [attemptId],
  )
  const retained = commands.rows[0]
  return {
    workflowId: retained.workflow_id,
    payload: strictJson(retained.payload_bytes.toString('utf8')),
  }
}

async function claim(fixture: Fixture, attemptId: string) {
  const retained = await retainedCommand(fixture, attemptId)
  return claimProcessingCommand(
    fixture.runner.pool,
    fixture.config,
    retained.workflowId,
    retained.payload,
    'processing/1',
  )
}

function envelope(
  command: NonNullable<Awaited<ReturnType<typeof claim>>>,
  sequence: string,
  content:
    | Pick<Extract<ProcessingEnvelopeDto, { kind: 'question' }>, 'kind' | 'payload'>
    | Pick<Extract<ProcessingEnvelopeDto, { kind: 'terminal' }>, 'kind' | 'payload'>
    | Pick<Extract<ProcessingEnvelopeDto, { kind: 'proposal' }>, 'kind' | 'payload'>,
): ProcessingEnvelopeDto {
  return {
    schema_version: 'bench-intake-runner/1',
    job_id: command.payload.job_id,
    attempt_id: command.payload.attempt_id,
    command_id: command.payload.command_id,
    input_sha256: command.payload.input_sha256,
    profile_id: 'synthetic-research/1',
    handler_version: 'processing/1',
    sequence,
    ...content,
  }
}

async function read(fixture: Fixture, batchId: string): Promise<ProcessingSnapshotDto> {
  const response = await fixture.http(`/batches/${batchId}/processing`)
  assert.equal(response.status, 200)
  return response.value
}

test('public processing retains immutable inputs, question releases lane, answer atomically adopts after real lost COMMIT ACK', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const start = {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.packetA.id, capture.packetB.id],
      stages: ['reading', 'research'],
    }
    const startKey = randomUUID()
    const started = await fixture.http(`/batches/${capture.batch.id}/processing`, start, startKey)
    assert.equal(started.status, 202)
    assert.deepEqual(
      await fixture.http(`/batches/${capture.batch.id}/processing`, start, startKey),
      started,
    )
    const changed = await fixture.http(
      `/batches/${capture.batch.id}/processing`,
      { ...start, stages: ['inventory'] },
      startKey,
    )
    assert.equal(changed.status, 409)

    const jobs = (await read(fixture, capture.batch.id)).jobs
    const packetAReading = jobs.find(
      (job) => job.subject_id === capture.packetA.id && job.stage === 'reading',
    )!
    const packetAResearch = jobs.find(
      (job) => job.subject_id === capture.packetA.id && job.stage === 'research',
    )!
    const packetBReading = jobs.find(
      (job) => job.subject_id === capture.packetB.id && job.stage === 'reading',
    )!
    assert.equal(
      await claim(fixture, packetAResearch.attempt_id),
      null,
      'research cannot bypass reading dependency',
    )
    const first = await claim(fixture, packetAReading.attempt_id)
    assert.ok(first)
    assert.ok('quantity' in first.manifest.subject)
    assert.deepEqual(first.manifest.subject.quantity, { mode: 'inherit' })
    assert.equal(
      await claim(fixture, packetBReading.attempt_id),
      null,
      'one account lane while A runs',
    )

    const questionMessage = envelope(first, '1', {
      kind: 'question',
      payload: {
        kind: 'quantity',
        subject_id: capture.packetA.id,
        prompt: 'How many are in Packet A?',
        reason: 'The label says approximately 20; count the pieces.',
      },
    })
    assert.equal(
      await acceptEnvelope(
        fixture.runner.pool,
        fixture.config,
        first.channelToken,
        questionMessage,
      ),
      'accepted',
    )
    assert.equal(
      await acceptEnvelope(
        fixture.runner.pool,
        fixture.config,
        first.channelToken,
        questionMessage,
      ),
      'duplicate',
    )
    await assert.rejects(
      () =>
        acceptEnvelope(fixture.runner.pool, fixture.config, first.channelToken, {
          ...questionMessage,
          payload: { ...questionMessage.payload, prompt: 'Changed prompt' },
        } as ProcessingEnvelopeDto),
      /payload_conflict/,
    )
    const second = await claim(fixture, packetBReading.attempt_id)
    assert.ok(second, 'B progresses while A waits')
    await acceptEnvelope(
      fixture.runner.pool,
      fixture.config,
      second.channelToken,
      envelope(second, '1', { kind: 'terminal', payload: { state: 'ready' } }),
    )

    const waiting = await read(fixture, capture.batch.id)
    const question = waiting.jobs.find((job) => job.id === packetAReading.id)!.questions[0]
    const answer: ProcessingAnswerDto = {
      schema_version: 'bench-intake-answer/1',
      expected_question_revision: question.revision,
      expected_capture_revision: capture.batch.revision,
      attempt_id: question.attempt_id,
      input_sha256: question.input_sha256,
      value: { kind: 'quantity', value: '17.000001', basis: 'counted' },
    }
    const answerKey = randomUUID()
    const proxy = await commitAckProxy(fixture.api.url)
    const uncertain = database(proxy.url)
    try {
      proxy.dropNextCommit()
      await assert.rejects(() =>
        answerQuestion(
          uncertain.pool,
          fixture.config,
          lockCaptureForEdit,
          capture.batch.id,
          question.id,
          answerKey,
          answer,
        ),
      )
      assert.equal(proxy.losses, 1, 'real PG COMMIT acknowledged only to proxy')
    } finally {
      await uncertain.close()
      await proxy.close()
    }

    const adopted = await fixture.http(
      `/batches/${capture.batch.id}/questions/${question.id}/answers`,
      answer,
      answerKey,
    )
    assert.equal(adopted.status, 200)
    const duplicateNewKey = await fixture.http(
      `/batches/${capture.batch.id}/questions/${question.id}/answers`,
      answer,
    )
    assert.deepEqual(
      duplicateNewKey.value,
      adopted.value,
      'same answer adopts original even with a fresh delivery key',
    )
    const conflict = await fixture.http(
      `/batches/${capture.batch.id}/questions/${question.id}/answers`,
      { ...answer, value: { kind: 'quantity', value: '18', basis: 'counted' } },
    )
    assert.equal(conflict.status, 409)
    const saved = await fixture.http(`/batches/${capture.batch.id}`)
    assert.deepEqual(
      saved.value.lots.find((lot: { id: string }) => lot.id === capture.packetA.id).quantity,
      { mode: 'set', value: '17.000001' },
    )
    assert.deepEqual(
      saved.value.lots.find((lot: { id: string }) => lot.id === capture.packetB.id).quantity,
      { mode: 'set', value: '23' },
    )

    const continued = await read(fixture, capture.batch.id)
    const newReading = continued.jobs.find((job) => job.id === packetAReading.id)!
    const newResearch = continued.jobs.find((job) => job.id === packetAResearch.id)!
    assert.notEqual(newReading.attempt_id, packetAReading.attempt_id)
    assert.notEqual(newResearch.attempt_id, packetAResearch.attempt_id)
    assert.equal(newReading.attempt_number, '2')
    const dependency = await fixture.db.pool.query(
      'SELECT dependency_attempt_id FROM processing_dependency WHERE attempt_id=$1',
      [newResearch.attempt_id],
    )
    assert.deepEqual(dependency.rows, [{ dependency_attempt_id: newReading.attempt_id }])
    const retained = await fixture.db.pool.query(
      'SELECT manifest_bytes,manifest_digest FROM processing_input WHERE id=$1',
      [first.payload.input_id],
    )
    assert.deepEqual(sha256(retained.rows[0].manifest_bytes), retained.rows[0].manifest_digest)
    assert.deepEqual(
      (
        strictJson(retained.rows[0].manifest_bytes.toString('utf8')) as {
          subject: { quantity: unknown }
        }
      ).subject.quantity,
      { mode: 'inherit' },
    )
    assert.equal(
      (await fixture.db.pool.query('SELECT count(*) FROM processing_answer')).rows[0].count,
      '1',
    )
    assert.equal(
      (await fixture.db.pool.query('SELECT count(*) FROM capture_edit_publication')).rows[0].count,
      '0',
    )
    await fixture.stop()
    await fixture.start()
    assert.deepEqual(
      (await read(fixture, capture.batch.id)).jobs.map((job) => job.attempt_id),
      continued.jobs.map((job) => job.attempt_id),
    )
  } finally {
    await fixture.dispose()
  }
})

test('authenticated stale output, wrong binding, cancellation and interrupted attempts cannot select or revive human facts', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const started = await fixture.http(`/batches/${capture.batch.id}/processing`, {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.packetA.id],
      stages: ['reading'],
    })
    assert.equal(started.status, 202)
    const command = await claim(fixture, started.value.attempt_ids[0])
    assert.ok(command)
    const proposal = envelope(command, '1', {
      kind: 'proposal',
      payload: {
        subject_id: capture.packetA.id,
        summary: 'Synthetic candidate: quantity 999. This is not a human selection.',
        source_note_ids: [command.manifest.notes[0].id],
      },
    })
    await assert.rejects(
      () => acceptEnvelope(fixture.runner.pool, fixture.config, 'forged', proposal),
      /runner_authentication_failed/,
    )
    await assert.rejects(
      () =>
        acceptEnvelope(fixture.runner.pool, fixture.config, command.channelToken, {
          ...proposal,
          command_id: randomUUID(),
        }),
      /runner_binding_mismatch/,
    )
    await assert.rejects(
      () =>
        acceptEnvelope(fixture.runner.pool, fixture.config, command.channelToken, {
          ...proposal,
          payload: { ...proposal.payload, subject_id: capture.packetB.id },
        } as ProcessingEnvelopeDto),
      /runner_subject_mismatch/,
    )
    const activeBeforeEdit = await fixture.http('/processing-activity')
    assert.equal(activeBeforeEdit.status, 200)
    assert.ok(
      activeBeforeEdit.value.jobs.some(
        (job: { job_id: string }) => job.job_id === command.payload.job_id,
      ),
    )
    await capture.edit({
      kind: 'lot',
      id: capture.packetA.id,
      quantity: { mode: 'set', value: '31' },
    })
    const activeAfterEdit = await fixture.http('/processing-activity')
    assert.equal(activeAfterEdit.status, 200)
    assert.equal(activeAfterEdit.value.lane_occupied, true)
    const staleRunning = activeAfterEdit.value.jobs.find(
      (job: { attempt_id: string }) => job.attempt_id === command.payload.attempt_id,
    )
    assert.deepEqual(staleRunning, {
      batch_id: capture.batch.id,
      job_id: command.payload.job_id,
      attempt_id: command.payload.attempt_id,
      state: 'running',
      input_current: false,
      occupies_lane: true,
    })
    assert.equal((await read(fixture, capture.batch.id)).jobs[0].state, 'superseded')

    assert.equal(
      await acceptEnvelope(fixture.runner.pool, fixture.config, command.channelToken, proposal),
      'stale',
    )
    const settledActivity = await fixture.http('/processing-activity')
    assert.equal(settledActivity.value.lane_occupied, false)
    assert.equal(
      settledActivity.value.jobs.some(
        (job: { attempt_id: string }) => job.attempt_id === command.payload.attempt_id,
      ),
      false,
    )
    assert.equal(
      (await fixture.db.pool.query('SELECT disposition FROM processing_message')).rows[0]
        .disposition,
      'stale',
    )
    assert.equal(
      (await fixture.db.pool.query('SELECT count(*) FROM processing_proposal')).rows[0].count,
      '0',
    )
    assert.deepEqual(capture.batch.lots.find((lot) => lot.id === capture.packetA.id)!.quantity, {
      mode: 'set',
      value: '31',
    })

    const restarted = await fixture.http(`/batches/${capture.batch.id}/processing`, {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.packetA.id],
      stages: ['reading'],
    })
    const current = await claim(fixture, restarted.value.attempt_ids[0])
    assert.ok(current)
    await interruptProcessing(fixture.runner.pool, fixture.config, current.payload.attempt_id)
    assert.equal(
      await acceptEnvelope(
        fixture.runner.pool,
        fixture.config,
        current.channelToken,
        envelope(current, '1', { kind: 'terminal', payload: { state: 'ready' } }),
      ),
      'stale',
    )
    const job = (await read(fixture, capture.batch.id)).jobs[0]
    const cancelled = await fixture.http(
      `/batches/${capture.batch.id}/processing/${job.id}/cancellation`,
      {
        expected_revision: job.revision,
        attempt_id: job.attempt_id,
      },
    )
    assert.equal(cancelled.status, 200)
    assert.equal((await read(fixture, capture.batch.id)).jobs[0].state, 'cancelled')

    await assert.rejects(
      () =>
        fixture.runner.pool.query('UPDATE capture_selection SET value=$1', [
          { mode: 'set', value: '999' },
        ]),
      /permission denied/,
    )
    await assert.rejects(
      () =>
        fixture.runner.pool.query('INSERT INTO processing_answer(id) VALUES($1)', [randomUUID()]),
      /permission denied/,
    )
    await assert.rejects(
      () => fixture.runner.pool.query('SELECT * FROM executor_approval'),
      /permission denied/,
    )
    const publicBytes = JSON.stringify(await read(fixture, capture.batch.id))
    assert.equal(publicBytes.includes(fixture.config.channelSecret), false)
    assert.equal(publicBytes.includes(command.channelToken), false)
    assert.equal(publicBytes.includes('channel_digest'), false)
  } finally {
    await fixture.dispose()
  }
})

test('capture lock/apply/publish enforces one edit and one final event, with rollback on missing publication', async () => {
  const fixture = await processingFixture()
  try {
    const capture = await fixture.seedCapture()
    const before = await fixture.http(`/batches/${capture.batch.id}`)
    const edit = {
      expected_revision: capture.batch.revision,
      change: {
        kind: 'lot' as const,
        id: capture.packetA.id,
        quantity: { mode: 'set' as const, value: '41' },
      },
    }
    await assert.rejects(
      () =>
        transaction(fixture.api.pool, async (client) => {
          const locked = await lockCaptureForEdit(
            client,
            fixture.config,
            capture.batch.id,
            capture.batch.revision,
          )
          await locked.apply(edit)
        }),
      /capture_publication_required/,
    )
    assert.deepEqual((await fixture.http(`/batches/${capture.batch.id}`)).value, before.value)

    await assert.rejects(
      () =>
        transaction(fixture.api.pool, async (client) => {
          const locked = await lockCaptureForEdit(
            client,
            fixture.config,
            capture.batch.id,
            capture.batch.revision,
          )
          await locked.publish()
        }),
      /capture_edit_publication_order/,
    )
    await assert.rejects(
      () =>
        transaction(fixture.api.pool, async (client) => {
          const locked = await lockCaptureForEdit(
            client,
            fixture.config,
            capture.batch.id,
            capture.batch.revision,
          )
          await locked.apply(edit)
          await locked.apply(edit)
        }),
      /capture_edit_already_applied/,
    )
    await assert.rejects(
      () =>
        transaction(fixture.api.pool, async (client) => {
          const locked = await lockCaptureForEdit(
            client,
            fixture.config,
            capture.batch.id,
            capture.batch.revision,
          )
          await locked.apply(edit)
          await locked.publish()
          await locked.publish()
        }),
      /capture_edit_publication_order/,
    )
    assert.deepEqual((await fixture.http(`/batches/${capture.batch.id}`)).value, before.value)

    const saved = await captureRepository(fixture.api.pool, fixture.config).edit(
      capture.batch.id,
      randomUUID(),
      edit,
    )
    const final = await fixture.http(`/batches/${capture.batch.id}`)
    assert.deepEqual(saved, final.value, 'public response cursor reflects the committed event')
    assert.equal(BigInt(final.value.cursor.sequence), BigInt(before.value.cursor.sequence) + 1n)
    assert.equal(
      (await fixture.db.pool.query('SELECT count(*) FROM capture_edit_publication')).rows[0].count,
      '0',
    )
  } finally {
    await fixture.dispose()
  }
})
