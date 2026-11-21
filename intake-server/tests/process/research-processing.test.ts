import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { DBOSClient } from '@dbos-inc/dbos-sdk'
import sharp from 'sharp'
import type { MediaReceiptDto, ProcessingSnapshotDto } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { sha256 } from '#/db/authority.ts'
import { processMediaCommand } from '#/media/worker.ts'
import { researchProcessingFixture } from '../support/research-processing.ts'
import { literalResearchPdf } from '../support/research-input.ts'
import { processingCheckpoint } from '../support/processing-process.ts'

type Fixture = Awaited<ReturnType<typeof researchProcessingFixture>>
type Capture = Awaited<ReturnType<Fixture['seedCapture']>>

async function retainArtifacts(fixture: Fixture, capture: Capture, image: string) {
  const png = await sharp(Buffer.from([12, 34, 56]), {
    raw: { width: 1, height: 1, channels: 3 },
  })
    .png()
    .toBuffer()
  const artifacts = [png, literalResearchPdf()]
  const receipts: MediaReceiptDto[] = []
  const bootstrap = (await (await fetch(`${fixture.config.origin}/api/v1/bootstrap`)).json()) as {
    csrf_token: string
  }
  for (const [index, bytes] of artifacts.entries()) {
    const media = await fixture.http(`/batches/${capture.batch.id}/media`)
    assert.equal(media.status, 200)
    const uploaded = await fetch(
      `${fixture.config.origin}/api/v1/batches/${capture.batch.id}/media/originals`,
      {
        method: 'POST',
        headers: {
          origin: fixture.config.origin,
          'x-intake-csrf': bootstrap.csrf_token,
          'idempotency-key': randomUUID(),
          'content-type': 'application/octet-stream',
          'x-intake-media-revision': media.value.revision,
          'x-intake-media-label': encodeURIComponent(`Controlled artifact ${index}`),
        },
        body: new Uint8Array(bytes),
      },
    )
    assert.equal(uploaded.status, 200)
    const receipt = (await uploaded.json()) as MediaReceiptDto
    receipts.push(receipt)
    assert.equal(receipt.version.digest, sha256(bytes).toString('hex'))
    const current = await fixture.http(`/batches/${capture.batch.id}/media`)
    const linked = await fixture.http(`/batches/${capture.batch.id}/media/commands`, {
      expected_revision: current.value.revision,
      change: {
        kind: 'link',
        evidence_id: receipt.evidence_id,
        subject_id: capture.packetA.id,
        linked: true,
      },
    })
    assert.equal(linked.status, 200)
    assert.equal(
      await processMediaCommand(fixture.db.pool, fixture.store, fixture.config, image!),
      true,
    )
  }
  const readyMedia = await fixture.http(`/batches/${capture.batch.id}/media`)
  assert.equal(readyMedia.status, 200)
  return receipts
}

test(
  'public HTTP and real DBOS deliver exact retained PNG/PDF through a controlled child, human continuation and restart',
  { timeout: 90000 },
  async () => {
    const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
    assert.match(
      image ?? '',
      /^sha256:[a-f0-9]{64}$/,
      'Explicit immutable decoder image is required',
    )
    const fixture = await researchProcessingFixture()
    let scheduler: DBOSClient | undefined
    try {
      const capture = await fixture.seedCapture()
      const receipts = await retainArtifacts(fixture, capture, image!)
      const freshCapture = await fixture.http(`/batches/${capture.batch.id}`)
      const started = await fixture.http(`/batches/${capture.batch.id}/processing`, {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: freshCapture.value.revision,
        subject_ids: [capture.packetA.id],
        stages: ['reading'],
      })
      assert.equal(started.status, 202)
      const firstAttempt = started.value.attempt_ids[0] as string
      await fixture.startWorker()
      const read = async () =>
        (await fixture.http(`/batches/${capture.batch.id}/processing`))
          .value as ProcessingSnapshotDto
      const waiting = await processingCheckpoint(
        read,
        (value) => value.jobs[0].state === 'waiting_for_user',
      )
      assert.equal(fixture.workerAlive, true)
      assert.ok(fixture.output.includes(`RESEARCH_SESSION_REAPED:${firstAttempt}`))
      assert.equal((await fixture.http('/processing-activity')).value.lane_occupied, false)
      const expectedProof = `Controlled child verified exact PNG/PDF: ${receipts
        .map((receipt) => receipt.version.digest)
        .sort()
        .join(',')}`
      assert.equal(waiting.jobs[0].proposals[0].value.summary, expectedProof)
      const question = waiting.jobs[0].questions[0]
      const commandRows = await fixture.db.pool.query(
        `SELECT command.workflow_id,command.payload_bytes FROM command JOIN processing_attempt attempt ON attempt.command_id=command.id WHERE attempt.id=$1`,
        [firstAttempt],
      )
      scheduler = await DBOSClient.create({
        systemDatabaseUrl: fixture.scheduler.url,
        systemDatabasePoolSize: 1,
      })
      const workflow = await scheduler.getWorkflow(commandRows.rows[0].workflow_id)
      assert.equal(workflow?.workflowName, 'intakeCommand')
      assert.deepEqual(workflow?.input, [
        strictJson(commandRows.rows[0].payload_bytes.toString('utf8')),
      ])
      await scheduler.destroy()
      scheduler = undefined
      await fixture.stopWorker()
      await fixture.stop()
      await fixture.start()
      assert.equal((await read()).jobs[0].questions[0].id, question.id)
      const beforeAnswer = await fixture.http(`/batches/${capture.batch.id}`)
      const answer = await fixture.http(
        `/batches/${capture.batch.id}/questions/${question.id}/answers`,
        {
          schema_version: 'bench-intake-answer/1',
          expected_question_revision: question.revision,
          expected_capture_revision: beforeAnswer.value.revision,
          attempt_id: question.attempt_id,
          input_sha256: question.input_sha256,
          value: { kind: 'quantity', value: '17.000001', basis: 'counted' },
        },
      )
      assert.equal(answer.status, 200)
      const continued = await read()
      const nextAttempt = continued.jobs[0].attempt_id
      assert.notEqual(nextAttempt, firstAttempt)
      await fixture.startWorker()
      const complete = await processingCheckpoint(read, (value) => value.jobs[0].state === 'ready')
      assert.equal(complete.jobs[0].attempt_id, nextAttempt)
      assert.equal(complete.jobs[0].proposals[0].value.summary, expectedProof)
      assert.ok(fixture.output.includes(`RESEARCH_SESSION_REAPED:${nextAttempt}`))
      const starts = [...fixture.output.matchAll(/RESEARCH_SESSION_STARTED:([^\n]+)/g)].map(
        (match) => match[1],
      )
      assert.deepEqual(starts, [firstAttempt, nextAttempt])
      const childPids = [...fixture.output.matchAll(/RESEARCH_CHILD_PID:(\d+)/g)].map((match) =>
        Number(match[1]),
      )
      assert.equal(childPids.length, 2)
      assert.notEqual(childPids[0], childPids[1])
      for (const pid of childPids) {
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
      }
      const retainedReceipts = await fixture.db.pool.query(
        'SELECT attempt_id,body_bytes FROM research_receipt ORDER BY attempt_id',
      )
      assert.deepEqual(
        new Set(retainedReceipts.rows.map((row) => row.attempt_id)),
        new Set([firstAttempt, nextAttempt]),
      )
      assert.ok(
        retainedReceipts.rows.every(
          (row) =>
            row.body_bytes.toString() ===
            '{"label":"Controlled fixture Part","model":"part","pk":"7"}',
        ),
      )
      const saved = await fixture.http(`/batches/${capture.batch.id}`)
      assert.deepEqual(
        saved.value.lots.find((lot: { id: string }) => lot.id === capture.packetA.id).quantity,
        { mode: 'set', value: '17.000001' },
      )
      assert.deepEqual(
        saved.value.lots.find((lot: { id: string }) => lot.id === capture.packetB.id).quantity,
        { mode: 'set', value: '23' },
      )
      for (const receipt of receipts) {
        const original = await fetch(
          `${fixture.config.origin}/api/v1/batches/${capture.batch.id}/media/versions/${receipt.version.id}`,
        )
        assert.equal(original.status, 200)
        assert.equal(
          sha256(Buffer.from(await original.arrayBuffer())).toString('hex'),
          receipt.version.digest,
        )
      }
      assert.equal((await fixture.http('/processing-activity')).value.lane_occupied, false)
      const publicBytes = JSON.stringify(complete)
      for (const privateValue of ['never-public', 'body_bytes', fixture.config.channelSecret]) {
        assert.equal(publicBytes.includes(privateValue), false)
      }
      await fixture.stopWorker()
      await fixture.stop()
      await fixture.start()
      assert.deepEqual(await read(), complete)
    } finally {
      await scheduler?.destroy()
      await fixture.dispose()
    }
  },
)
