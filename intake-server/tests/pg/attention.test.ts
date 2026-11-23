import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type {
  BatchAttentionDto,
  BatchRecordsDto,
  CaptureSnapshotDto,
  ManualWorkspaceDto,
  OperatorReviewDto,
  ProcessingSnapshotDto,
} from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { manualFixture } from '../support/manual.ts'
import { leadSession, legacySessionQuestion, lotSession } from '../support/sessions.ts'
import { transaction } from '#/db/database.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
import { acceptEnvelope, claimProcessingCommand } from '#/processing/runner.ts'
import type { ProcessingConfig } from '#/processing/attempts.ts'

type Fixture = Awaited<ReturnType<typeof manualFixture>>

async function read<T>(fixture: Fixture, path: string) {
  const result = await fixture.http(path)
  assert.equal(result.status, 200, JSON.stringify(result.value))
  return result.value as T
}

test('the attention read agrees with the review and manual reads it is built from', async () => {
  const fixture = await manualFixture({ processing: true })
  try {
    const seeded = await fixture.seedCapture()
    const batchId = seeded.batch.id
    const { a, b } = seeded

    const before = await read<CaptureSnapshotDto>(fixture, `/batches/${batchId}`)
    const reviewed = await fixture.http(`/batches/${batchId}/reviews`, {
      expected_batch_revision: before.revision,
      selected_lot_ids: [a.id, b.id],
    })
    assert.equal(reviewed.status, 200, JSON.stringify(reviewed.value))

    // Changing a reviewed lot puts it back in front of the operator.
    const current = await read<CaptureSnapshotDto>(fixture, `/batches/${batchId}`)
    const edited = await fixture.http(`/batches/${batchId}/bulk-edits`, {
      expected_revision: current.revision,
      preview: false,
      lot_ids: [b.id],
      change: { quantity: { mode: 'set', value: '24' } },
    })
    assert.equal(edited.status, 200, JSON.stringify(edited.value))

    const attention = await read<BatchAttentionDto>(fixture, `/batches/${batchId}/attention`)
    const review = await read<OperatorReviewDto>(fixture, `/batches/${batchId}/operator-review`)
    const manual = await read<ManualWorkspaceDto>(fixture, `/batches/${batchId}/manual`)
    const records = await read<BatchRecordsDto>(fixture, `/batches/${batchId}/records`)

    assert.equal(attention.batch_id, batchId)
    assert.equal(attention.revision, review.revision)
    assert.equal(
      attention.review.to_check,
      review.lots.filter((lot) => lot.review_state !== 'reviewed').length,
    )
    assert.equal(attention.review.changed_after_review, 1)
    // Decisions are the records waiting for a choice, the same count Review › Records shows.
    assert.equal(
      attention.review.to_decide,
      records.counts.reduce((sum, count) => sum + count.decide, 0),
    )
    assert.deepEqual(
      attention.items.filter((item) => item.group === 'decision').map((item) => item.key),
      records.records.filter((record) => record.decision).map((record) => `decision:${record.key}`),
    )
    assert.equal(
      attention.changes.ready,
      manual.lots.filter((lot) => lot.reviewed && lot.issues.length === 0).length,
    )
    const changed = attention.items.find((item) => item.key === `changed:${b.id}`)
    assert.equal(changed?.route, `${batchId}/review/lots/${b.id}`)
    assert.equal(
      attention.items.some((item) => item.key === `changed:${a.id}`),
      false,
    )
  } finally {
    await fixture.dispose()
  }
})

test('question items carry their title, kind or step count and assumptions, for every question version', async () => {
  const fixture = await manualFixture({ processing: true })
  const runnerPool = fixture.processingRunner!.pool
  const config = fixture.config as unknown as ProcessingConfig
  const server = await startSessionToolServer({ pool: runnerPool, config, statusIntervalMs: 0 })
  try {
    const seeded = await fixture.seedCapture()
    const batchId = seeded.batch.id
    const capture = { batch: seeded.batch, packetA: seeded.a }
    const lead = await leadSession(fixture, capture)
    const token = await transaction(runnerPool, (client) =>
      issueSessionCapability(client, lead.attempt),
    )
    const client = new Client({ name: 'attention-questions-test', version: '1' })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    )
    try {
      const lotAsked = await client.callTool({
        name: 'ask',
        arguments: {
          schema_version: 'bench-intake-question/2',
          subject_id: seeded.a.id,
          reason: 'The slip is folded over.',
          fields: ['markings'],
          steps: [
            {
              id: 'slip',
              prompt: 'What does the slip under packet A say?',
              assumption: 'No slip text.',
              answer: { kind: 'text' },
            },
          ],
        },
      })
      assert.equal((lotAsked.structuredContent as { ok: boolean }).ok, true)
      // A stepped question about one lot counts against that lot alone.
      const lotOnly = await read<BatchAttentionDto>(fixture, `/batches/${batchId}/attention`)
      assert.equal(lotOnly.review.needs_answer, 1)

      const asked = await client.callTool({
        name: 'ask',
        arguments: {
          schema_version: 'bench-intake-question/2',
          subject_id: seeded.partId,
          reason: 'Both packets carry the same MPN.',
          fields: ['identity'],
          title: 'Same Part, and its variant',
          steps: [
            {
              id: 'same',
              prompt: 'Are packets A and B the same Part?',
              assumption: 'The same Part.',
              answer: {
                kind: 'choice',
                options: [
                  { id: 'yes', label: 'Yes, same Part' },
                  { id: 'no', label: 'No, different Parts' },
                ],
                other: false,
              },
            },
            {
              id: 'variant',
              prompt: 'Which variant is it?',
              assumption: 'The plain variant.',
              answer: { kind: 'text' },
            },
          ],
        },
      })
      assert.equal((asked.structuredContent as { ok: boolean }).ok, true)
    } finally {
      await client.close()
    }
    // A stepped question about the Part counts against each of its lots.
    const partOnly = await read<BatchAttentionDto>(fixture, `/batches/${batchId}/attention`)
    assert.equal(partOnly.review.needs_answer, 2)

    const lot = await lotSession(fixture, capture, seeded.a)
    await legacySessionQuestion(fixture, lot, {
      kind: 'clarification',
      subject_id: seeded.a.id,
      prompt: 'Is the label torn?',
      reason: 'The top edge is missing.',
      fields: ['markings'],
      assumption: 'Reading the visible part only.',
    })
    const started = await fixture.http(`/batches/${batchId}/processing`, {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: seeded.batch.revision,
      subject_ids: [seeded.b.id],
      stages: ['reading'],
    })
    assert.equal(started.status, 202, JSON.stringify(started.value))
    const reading = (
      await read<ProcessingSnapshotDto>(fixture, `/batches/${batchId}/processing`)
    ).jobs.find((job) => job.stage === 'reading')!
    const retained = await fixture.db.pool.query<{ workflow_id: string; payload_bytes: Buffer }>(
      `SELECT command.workflow_id,command.payload_bytes FROM command
       JOIN processing_attempt attempt ON attempt.command_id=command.id WHERE attempt.id=$1`,
      [reading.attempt_id],
    )
    const claimed = await claimProcessingCommand(
      runnerPool,
      config,
      retained.rows[0].workflow_id,
      strictJson(retained.rows[0].payload_bytes.toString('utf8')),
      'processing/2',
    )
    assert.ok(claimed)
    assert.equal(
      await acceptEnvelope(runnerPool, config, claimed.channelToken, {
        schema_version: 'bench-intake-runner/2',
        job_id: claimed.payload.job_id,
        attempt_id: claimed.payload.attempt_id,
        command_id: claimed.payload.command_id,
        input_sha256: claimed.payload.input_sha256,
        profile_id: 'synthetic-research/2',
        handler_version: 'processing/2',
        sequence: '1',
        kind: 'question',
        payload: {
          kind: 'quantity',
          subject_id: seeded.b.id,
          prompt: 'How many are in packet B?',
          reason: 'The count is smudged.',
        },
      }),
      'accepted',
    )

    const attention = await read<BatchAttentionDto>(fixture, `/batches/${batchId}/attention`)
    const questions = attention.items.filter((item) => item.group === 'question')
    const byTitle = Object.fromEntries(questions.map((item) => [item.title, item.question]))
    assert.deepEqual(byTitle['Same Part, and its variant'], {
      steps: [
        { kind: 'choice', options: 2, assumption: 'The same Part.' },
        { kind: 'text', assumption: 'The plain variant.' },
      ],
    })
    assert.deepEqual(byTitle['What does the slip under packet A say?'], {
      steps: [{ kind: 'text', assumption: 'No slip text.' }],
    })
    assert.deepEqual(byTitle['Is the label torn?'], {
      steps: [{ kind: 'text', assumption: 'Reading the visible part only.' }],
    })
    // An earlier runner question recorded no assumption.
    assert.deepEqual(byTitle['How many are in packet B?'], {
      steps: [{ kind: 'number', assumption: null }],
    })
    assert.equal(attention.processing.questions, 4)
    assert.equal(attention.review.needs_answer, 2)
  } finally {
    await server.close()
    await fixture.dispose()
  }
})
