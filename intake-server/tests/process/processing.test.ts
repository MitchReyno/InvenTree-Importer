import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DBOSClient } from '@dbos-inc/dbos-sdk'
import type { ProcessingSnapshotDto } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { processingProcess, processingCheckpoint } from '../support/processing-process.ts'
import { interruptProcessing } from '../../src/processing/runner.ts'
import { deliverCommand } from '../../src/workers/delivery.ts'

test(
  'real DBOS child worker persists question, releases lane, survives browser closure and resumes fresh human answer',
  { timeout: 60000 },
  async () => {
    const fixture = await processingProcess()
    try {
      const capture = await fixture.seedCapture()
      const started = await fixture.http(`/batches/${capture.batch.id}/processing`, {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: capture.batch.revision,
        subject_ids: [capture.packetA.id, capture.packetB.id],
        stages: ['reading', 'research'],
      })
      assert.equal(started.status, 202)
      await fixture.startWorker()
      const waiting = await processingCheckpoint(
        async () =>
          (await fixture.http(`/batches/${capture.batch.id}/processing`))
            .value as ProcessingSnapshotDto,
        (snapshot) =>
          snapshot.jobs.some(
            (job) => job.subject_id === capture.packetA.id && job.state === 'waiting_for_user',
          ) &&
          snapshot.jobs
            .filter((job) => job.subject_id === capture.packetB.id)
            .every((job) => job.state === 'ready'),
      )
      const question = waiting.jobs.find(
        (job) => job.subject_id === capture.packetA.id && job.stage === 'reading',
      )!.questions[0]
      await fixture.stop()
      await fixture.stopWorker()
      await fixture.start()
      await fixture.startWorker()
      const reloaded = await fixture.http(`/batches/${capture.batch.id}/processing`)
      assert.equal(reloaded.status, 200)
      assert.equal(
        reloaded.value.jobs.find(
          (job: { subject_id: string; stage: string }) =>
            job.subject_id === capture.packetA.id && job.stage === 'reading',
        ).questions[0].id,
        question.id,
      )
      const answer = {
        schema_version: 'bench-intake-answer/1',
        expected_question_revision: question.revision,
        expected_capture_revision: capture.batch.revision,
        attempt_id: question.attempt_id,
        input_sha256: question.input_sha256,
        value: { kind: 'quantity', value: '17', basis: 'counted' },
      }
      assert.equal(
        (
          await fixture.http(
            `/batches/${capture.batch.id}/questions/${question.id}/answers`,
            answer,
          )
        ).status,
        200,
      )
      const complete = await processingCheckpoint(
        async () =>
          (await fixture.http(`/batches/${capture.batch.id}/processing`))
            .value as ProcessingSnapshotDto,
        (snapshot) => snapshot.jobs.every((job) => job.state === 'ready'),
      )
      assert.equal(complete.jobs.length, 4)
      assert.equal(
        complete.jobs.find(
          (job) => job.subject_id === capture.packetA.id && job.stage === 'reading',
        )!.attempt_number,
        '2',
      )
      assert.ok(complete.jobs.every((job) => job.qualification === 'fixture_only'))
      const saved = await fixture.http(`/batches/${capture.batch.id}`)
      assert.deepEqual(
        saved.value.lots.find((lot: { id: string }) => lot.id === capture.packetA.id).quantity,
        { mode: 'set', value: '17' },
      )
      assert.deepEqual(
        saved.value.lots.find((lot: { id: string }) => lot.id === capture.packetB.id).quantity,
        { mode: 'set', value: '23' },
      )
    } finally {
      await fixture.dispose()
    }
  },
)

test(
  'reaped DBOS process never replays a claimed native-like session; fresh attempt and exact workflow conflict checks',
  { timeout: 60000 },
  async () => {
    const fixture = await processingProcess()
    let scheduler: DBOSClient | undefined
    try {
      const capture = await fixture.seedCapture()
      const start = {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: capture.batch.revision,
        subject_ids: [capture.packetB.id],
        stages: ['reading'],
      }
      const first = await fixture.http(`/batches/${capture.batch.id}/processing`, start)
      const originalAttempt = first.value.attempt_ids[0]
      await fixture.startWorker(true)
      await processingCheckpoint(
        async () => fixture.output,
        (output) => output.includes(`SYNTHETIC_CLAIMED:${originalAttempt}`),
      )
      await fixture.stopWorker('SIGKILL')
      // The original child has been reaped before declaring its ephemeral callback interrupted.
      await interruptProcessing(fixture.runner.pool, fixture.config, originalAttempt)
      await fixture.startWorker()
      const oldState = await fixture.http(`/batches/${capture.batch.id}/processing`)
      assert.equal(oldState.value.jobs[0].state, 'interrupted')
      assert.equal(
        (
          await fixture.db.pool.query(
            'SELECT count(*) FROM processing_message WHERE attempt_id=$1',
            [originalAttempt],
          )
        ).rows[0].count,
        '0',
      )
      const replacement = await fixture.http(
        `/batches/${capture.batch.id}/processing`,
        start,
        randomUUID(),
      )
      assert.equal(replacement.status, 202)
      assert.notEqual(replacement.value.attempt_ids[0], originalAttempt)
      await processingCheckpoint(
        async () =>
          (await fixture.http(`/batches/${capture.batch.id}/processing`))
            .value as ProcessingSnapshotDto,
        (snapshot) => snapshot.jobs[0].state === 'ready',
      )
      await fixture.stopWorker()
      scheduler = await DBOSClient.create({
        systemDatabaseUrl: fixture.scheduler.url,
        systemDatabasePoolSize: 1,
      })
      const commands = await fixture.db.pool.query(
        `SELECT command.* FROM command JOIN processing_attempt attempt
        ON attempt.command_id=command.id WHERE attempt.id=$1`,
        [replacement.value.attempt_ids[0]],
      )
      const retained = commands.rows[0]
      const payload = strictJson(retained.payload_bytes.toString('utf8'))
      const originalWorkflow = await scheduler.getWorkflow(retained.workflow_id)
      assert.equal(originalWorkflow?.workflowName, 'intakeCommand')
      assert.deepEqual(originalWorkflow?.input, [payload])
      assert.equal(await deliverCommand(fixture.runner.pool, scheduler, retained.id), 'acked')
      // Independent workflow IDs prove full payload/version checks with unchanged retained commands.
      const conflictId = randomUUID()
      const conflictCommand = randomUUID()
      const bytes = Buffer.from(JSON.stringify({ value: 'expected' }))
      const digest = (await import('../../src/db/authority.ts')).sha256(bytes)
      await fixture.db.pool.query(
        `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,
        handler_version,workflow_id,queue_name,payload_bytes,payload_digest) VALUES($1,$2,$3,$4,'process',
        'processing/1',$5,'bench-research',$6,$7)`,
        [
          conflictCommand,
          fixture.identity.actor,
          fixture.identity.target,
          fixture.identity.context,
          conflictId,
          bytes,
          digest,
        ],
      )
      await fixture.db.pool.query('INSERT INTO outbox(command_id) VALUES($1)', [conflictCommand])
      await scheduler.enqueue(
        {
          workflowID: conflictId,
          workflowName: 'intakeCommand',
          queueName: 'bench-research',
          appVersion: 'processing/1',
        },
        { value: 'changed' },
      )
      assert.equal(
        await deliverCommand(fixture.runner.pool, scheduler, conflictCommand),
        'conflict',
      )
      assert.equal(
        (
          await fixture.db.pool.query('SELECT conflict_code FROM outbox WHERE command_id=$1', [
            conflictCommand,
          ])
        ).rows[0].conflict_code,
        'payload_conflict',
      )
    } finally {
      await scheduler?.destroy()
      await fixture.dispose()
    }
  },
)
