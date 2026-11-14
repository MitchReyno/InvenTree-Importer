import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DBOSClient } from '@dbos-inc/dbos-sdk'
import type { ProcessingSnapshotDto } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { processingProcess, processingCheckpoint } from '../support/processing-process.ts'
import { interruptProcessing } from '#/processing/runner.ts'
import { processingMediaFixture } from '../support/processing-media.ts'
import { deliverCommand } from '#/workers/delivery.ts'

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
      await capture.edit({
        kind: 'lot',
        id: capture.packetB.id,
        quantity: { mode: 'set', value: '31' },
      })
      assert.equal(fixture.workerAlive, true, 'the synthetic runner is physically alive and paused')
      const active = await fixture.http('/processing-activity')
      assert.equal(active.status, 200)
      assert.equal(active.value.lane_occupied, true)
      assert.deepEqual(active.value.jobs, [
        {
          batch_id: capture.batch.id,
          job_id: first.value.job_ids[0],
          attempt_id: originalAttempt,
          state: 'running',
          input_current: false,
          occupies_lane: true,
        },
      ])
      const logical = await fixture.http(`/batches/${capture.batch.id}/processing`)
      assert.equal(
        logical.value.jobs[0].state,
        'superseded',
        'logical freshness does not settle a physical runner',
      )
      const lane = await fixture.db.pool.query(
        'SELECT attempt_id FROM processing_lane WHERE actor_id=$1',
        [fixture.identity.actor],
      )
      assert.deepEqual(lane.rows, [{ attempt_id: originalAttempt }])

      await fixture.stopWorker('SIGKILL')
      assert.equal(fixture.workerAlive, false)
      // The original child has been reaped before declaring its ephemeral callback interrupted.
      await interruptProcessing(fixture.runner.pool, fixture.config, originalAttempt)
      await fixture.startWorker()
      const oldState = await fixture.http(`/batches/${capture.batch.id}/processing`)
      assert.equal(oldState.value.jobs[0].state, 'superseded')
      const interrupted = await fixture.db.pool.query(
        'SELECT state FROM processing_attempt WHERE id=$1',
        [originalAttempt],
      )
      assert.deepEqual(interrupted.rows, [{ state: 'interrupted' }])
      const released = await fixture.http('/processing-activity')
      assert.equal(released.value.lane_occupied, false)
      assert.deepEqual(released.value.jobs, [])
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
        { ...start, expected_capture_revision: capture.batch.revision },
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
      const saved = await fixture.http(`/batches/${capture.batch.id}`)
      assert.deepEqual(
        saved.value.lots.find((lot: { id: string }) => lot.id === capture.packetB.id).quantity,
        { mode: 'set', value: '31' },
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
      const digest = (await import('#/db/authority.ts')).sha256(bytes)
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

test(
  'a stale child proposal and logical cancellation/reprocess retain the old lane until its exact terminal',
  { timeout: 60000 },
  async () => {
    const fixture = await processingProcess()
    let media: Awaited<ReturnType<typeof processingMediaFixture>> | undefined
    try {
      const capture = await fixture.seedCapture()
      const input = {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: capture.batch.revision,
        subject_ids: [capture.packetB.id],
        stages: ['reading'],
      }
      const started = await fixture.http(`/batches/${capture.batch.id}/processing`, input)
      assert.equal(started.status, 202)
      const originalAttempt = started.value.attempt_ids[0]
      await fixture.startWorker(false, originalAttempt)
      await processingCheckpoint(
        async () => fixture.output,
        (output) => output.includes(`SYNTHETIC_CLAIMED:${originalAttempt}`),
      )
      await capture.edit({
        kind: 'lot',
        id: capture.packetB.id,
        quantity: { mode: 'set', value: '31' },
      })
      media = await processingMediaFixture(fixture, capture.batch.id)
      await media.upload(capture.packetB.id, 'Pending retained synthetic child evidence')
      fixture.sendWorkerStep('proposal')
      await processingCheckpoint(
        async () => fixture.output,
        (output) => output.includes(`SYNTHETIC_PROPOSAL:${originalAttempt}`),
      )
      assert.equal(fixture.workerAlive, true)
      const logical = await fixture.http(`/batches/${capture.batch.id}/processing`)
      assert.equal(logical.value.jobs[0].state, 'superseded')
      assert.deepEqual(logical.value.jobs[0].proposals, [])
      assert.equal((await fixture.http('/processing-activity')).value.lane_occupied, true)

      const cancel = await fixture.http(
        `/batches/${capture.batch.id}/processing/${started.value.job_ids[0]}/cancellation`,
        {
          expected_revision: logical.value.jobs[0].revision,
          attempt_id: originalAttempt,
        },
      )
      assert.equal(cancel.status, 200)
      const cancelledActivity = await fixture.http('/processing-activity')
      assert.equal(cancelledActivity.value.lane_occupied, true)
      assert.deepEqual(cancelledActivity.value.jobs[0], {
        batch_id: capture.batch.id,
        job_id: started.value.job_ids[0],
        attempt_id: originalAttempt,
        state: 'cancelled',
        input_current: false,
        occupies_lane: true,
        blocked_code: 'media_not_ready',
      })
      // Make the pending retained original ready through the actual owning decoder API.
      await media.decodeNext()
      const replacement = await fixture.http(`/batches/${capture.batch.id}/processing`, {
        ...input,
        expected_capture_revision: capture.batch.revision,
      })
      assert.equal(replacement.status, 202)
      const freshAttempt = replacement.value.attempt_ids[0]
      assert.notEqual(freshAttempt, originalAttempt)
      const held = await fixture.db.pool.query(
        'SELECT attempt_id FROM processing_lane WHERE actor_id=$1',
        [fixture.identity.actor],
      )
      assert.deepEqual(held.rows, [{ attempt_id: originalAttempt }])
      const notClaimed = await fixture.db.pool.query(
        'SELECT state FROM processing_attempt WHERE id=$1',
        [freshAttempt],
      )
      assert.deepEqual(notClaimed.rows, [{ state: 'queued' }])
      assert.equal(fixture.output.includes(`SYNTHETIC_CLAIMED:${freshAttempt}`), false)

      fixture.sendWorkerStep('terminal')
      const completed = await processingCheckpoint(
        async () =>
          (await fixture.http(`/batches/${capture.batch.id}/processing`))
            .value as ProcessingSnapshotDto,
        (snapshot) => snapshot.jobs[0].state === 'ready',
      )
      assert.equal(completed.jobs[0].attempt_id, freshAttempt)
      assert.equal(completed.jobs[0].proposals.length, 1)
      assert.equal(fixture.workerAlive, true)
      const oldMessages = await fixture.db.pool.query(
        'SELECT sequence,disposition FROM processing_message WHERE attempt_id=$1 ORDER BY sequence',
        [originalAttempt],
      )
      assert.deepEqual(oldMessages.rows, [
        { sequence: '1', disposition: 'stale' },
        { sequence: '2', disposition: 'stale' },
      ])
      const saved = await fixture.http(`/batches/${capture.batch.id}`)
      assert.deepEqual(
        saved.value.lots.find((lot: { id: string }) => lot.id === capture.packetB.id).quantity,
        { mode: 'set', value: '31' },
      )
      assert.equal((await fixture.http('/processing-activity')).value.lane_occupied, false)
    } finally {
      await media?.dispose()
      await fixture.dispose()
    }
  },
)
