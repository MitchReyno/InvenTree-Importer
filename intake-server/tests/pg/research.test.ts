import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { PassThrough } from 'node:stream'
import { restrictedResearchRunner } from '#/research/adapter.ts'
import { executeProcessingCommand } from '#/processing/delivery.ts'
import type {
  ProcessingEnvelopeV3Dto,
  ProcessingInputV3Dto,
  ProcessingSnapshotDto,
  ResearchReceiptDto,
} from '@invimport/contracts'
import { canonical, strictJson } from '@invimport/contracts/json'
import { processingFixture } from '../support/processing.ts'
import {
  claimProcessingCommand,
  acceptEnvelope,
  interruptProcessing,
  type ResearchInput,
} from '#/processing/runner.ts'
import { researchAttemptAccess } from '#/processing/research.ts'
import { researchReceiptStore } from '#/research/receipts.ts'
import { researchBroker } from '#/research/broker.ts'
import { ResearchReapPendingError } from '#/research/errors.ts'
import { channelToken } from '#/processing/attempts.ts'

const approvedSource = 'https://example.com/datasheet'
type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Claimed = NonNullable<Awaited<ReturnType<typeof claimProcessingCommand>>>

async function restrictedFixture() {
  const fixture = await processingFixture()
  const config = Object.assign(fixture.config, {
    profileId: 'restricted-research-stub/1' as const,
    approvedSourceUrls: [approvedSource],
    sourceProtectedOrigins: ['https://inventory.example'],
  })
  return { ...fixture, config }
}

async function startReading(fixture: Fixture, subject: 'packetA' | 'packetB' = 'packetA') {
  const capture = await fixture.seedCapture()
  const started = await fixture.http(`/batches/${capture.batch.id}/processing`, {
    schema_version: 'bench-intake-processing/1',
    expected_capture_revision: capture.batch.revision,
    subject_ids: [capture[subject].id],
    stages: ['reading'],
  })
  assert.equal(started.status, 202)
  const command = await claimAttempt(fixture, started.value.attempt_ids[0])
  assert.ok(command)

  return { capture, command }
}

async function claimAttempt(fixture: Fixture, attemptId: string) {
  const retained = await fixture.db.pool.query(
    `SELECT command.workflow_id,command.payload_bytes FROM command
     JOIN processing_attempt attempt ON attempt.command_id=command.id WHERE attempt.id=$1`,
    [attemptId],
  )
  return claimProcessingCommand(
    fixture.runner.pool,
    fixture.config,
    retained.rows[0].workflow_id,
    strictJson(retained.rows[0].payload_bytes.toString('utf8')),
    'processing/3',
  )
}

function envelope(
  command: Claimed,
  sequence: string,
  content:
    | Pick<Extract<ProcessingEnvelopeV3Dto, { kind: 'proposal' }>, 'kind' | 'payload'>
    | Pick<Extract<ProcessingEnvelopeV3Dto, { kind: 'terminal' }>, 'kind' | 'payload'>
    | Pick<Extract<ProcessingEnvelopeV3Dto, { kind: 'question' }>, 'kind' | 'payload'>,
): ProcessingEnvelopeV3Dto {
  return {
    schema_version: 'bench-intake-runner/3',
    job_id: command.payload.job_id,
    attempt_id: command.payload.attempt_id,
    command_id: command.payload.command_id,
    input_sha256: command.payload.input_sha256,
    profile_id: 'restricted-research-stub/1',
    handler_version: 'processing/3',
    sequence,
    ...content,
  }
}

async function snapshot(fixture: Fixture, batchId: string): Promise<ProcessingSnapshotDto> {
  const response = await fixture.http(`/batches/${batchId}/processing`)
  assert.equal(response.status, 200)
  return response.value
}

test('restricted broker retains scoped semantic receipts, publishes opaque proposal sources and survives restart', async () => {
  const fixture = await restrictedFixture()
  try {
    const { capture, command } = await startReading(fixture)
    const access = await researchAttemptAccess(fixture.runner.pool, fixture.config, command)
    const receipts = researchReceiptStore(fixture.runner.pool, access.scope)
    const broker = researchBroker({
      access,
      receipts,
      protectedOrigins: fixture.config.sourceProtectedOrigins,
      readEvidence: async () => assert.fail('manual input has no media authority'),
      readInventory: async () =>
        Response.json({ pk: 7, name: 'Synthetic component', secret: 'private-fake' }),
    })
    const result = (await broker.call(
      'lookup_inventory',
      { model: 'part', pk: '7' },
      randomUUID(),
      new AbortController().signal,
    )) as { receipt: { id: string; sha256: string }; observation: unknown }
    assert.deepEqual(result.observation, { model: 'part', pk: '7', label: 'Synthetic component' })
    const proposal = envelope(command, '1', {
      kind: 'proposal',
      payload: {
        schema_version: 'bench-intake-proposal/3',
        subject_id: capture.packetA.id,
        summary: 'Fixture candidate; human quantity stays unresolved.',
        sources: [
          {
            kind: 'research_receipt',
            receipt_id: result.receipt.id,
            sha256: result.receipt.sha256,
          },
        ],
      },
    })
    assert.equal(
      await acceptEnvelope(fixture.runner.pool, fixture.config, command.channelToken, proposal),
      'accepted',
    )
    broker.close()
    await acceptEnvelope(
      fixture.runner.pool,
      fixture.config,
      command.channelToken,
      envelope(command, '2', { kind: 'terminal', payload: { state: 'ready' } }),
    )
    const before = await snapshot(fixture, capture.batch.id)
    assert.equal(before.jobs[0].state, 'ready')
    const publicBytes = canonical(before)
    assert.ok(publicBytes.includes(result.receipt.id))
    for (const privateValue of [
      'private-fake',
      'body_bytes',
      'descriptor_bytes',
      command.channelToken,
    ]) {
      assert.equal(publicBytes.includes(privateValue), false)
    }
    await fixture.stop()
    await fixture.start()
    assert.deepEqual(await snapshot(fixture, capture.batch.id), before)
    assert.deepEqual(capture.batch.lots.find((lot) => lot.id === capture.packetA.id)!.quantity, {
      mode: 'inherit',
    })
  } finally {
    await fixture.dispose()
  }
})

test('receipt adoption is exact, foreign scope is refused and runtime grants cannot rewrite audit evidence', async () => {
  const fixture = await restrictedFixture()
  try {
    const { command } = await startReading(fixture)
    const access = await researchAttemptAccess(fixture.runner.pool, fixture.config, command)
    const receipts = researchReceiptStore(fixture.runner.pool, access.scope)
    const requestId = randomUUID()
    const request = { model: 'part', pk: '7' }
    const source = {
      kind: 'inventory' as const,
      mediaType: 'application/json' as const,
      bytes: Buffer.from(canonical({ model: 'part', pk: '7', label: 'Fixture part' })),
    }
    const receipt = await receipts.publish(requestId, request, source)
    assert.deepEqual(await receipts.publish(requestId, request, source), receipt)
    await assert.rejects(
      () => receipts.publish(requestId, request, { ...source, bytes: Buffer.from('changed') }),
      /research_protocol_invalid/,
    )
    const foreign = researchReceiptStore(fixture.runner.pool, {
      ...access.scope,
      attemptId: randomUUID(),
    })
    await assert.rejects(() => foreign.read(receipt.id), /research_receipt_missing/)
    for (const connection of [fixture.api, fixture.runner]) {
      await assert.rejects(
        () =>
          connection.pool.query('UPDATE research_receipt SET body_bytes=$1 WHERE id=$2', [
            source.bytes,
            receipt.id,
          ]),
        /permission denied/,
      )
      await assert.rejects(
        () => connection.pool.query('DELETE FROM research_receipt'),
        /permission denied/,
      )
      await assert.rejects(
        () => connection.pool.query('TRUNCATE research_receipt'),
        /permission denied/,
      )
    }
    await assert.rejects(
      () => fixture.api.pool.query('INSERT INTO research_receipt(id) VALUES($1)', [randomUUID()]),
      /permission denied/,
    )
    Object.assign(fixture.config, { profileId: 'synthetic-research/2' })
    await assert.rejects(
      () => claimAttempt(fixture, command.payload.attempt_id),
      /worker_version_conflict/,
    )
    Object.assign(fixture.config, { profileId: 'restricted-research-stub/1' })
    const saved = await receipts.read(receipt.id)
    assert.ok(saved.bytes.equals(source.bytes))
    assert.equal(
      (await fixture.db.pool.query('SELECT count(*) FROM research_receipt')).rows[0].count,
      '1',
    )
  } finally {
    await fixture.dispose()
  }
})

test('source admission revocation blocks cached broker results and preserves the lane until command-ending output', async () => {
  const fixture = await restrictedFixture()
  try {
    const { capture, command } = await startReading(fixture)
    assert.deepEqual((command.manifest as ProcessingInputV3Dto).source_urls, [approvedSource])
    const access = await researchAttemptAccess(fixture.runner.pool, fixture.config, command)
    fixture.config.approvedSourceUrls = []
    await assert.rejects(
      () => access.ensureCurrent(new AbortController().signal),
      /research_attempt_unavailable/,
    )
    const activity = await fixture.http('/processing-activity')
    assert.equal(activity.value.lane_occupied, true)
    assert.equal(activity.value.jobs[0].input_current, false)
    assert.equal((await snapshot(fixture, capture.batch.id)).jobs[0].state, 'superseded')
    assert.equal(
      await acceptEnvelope(
        fixture.runner.pool,
        fixture.config,
        command.channelToken,
        envelope(command, '1', { kind: 'terminal', payload: { state: 'ready' } }),
      ),
      'stale',
    )
    assert.equal((await fixture.http('/processing-activity')).value.lane_occupied, false)
  } finally {
    await fixture.dispose()
  }
})

test('receipt count and byte budgets serialize concurrent publication without partial rows', async () => {
  const fixture = await restrictedFixture()
  try {
    const { command } = await startReading(fixture)
    const access = await researchAttemptAccess(fixture.runner.pool, fixture.config, command)
    const receipts = researchReceiptStore(fixture.runner.pool, access.scope)
    const source = {
      kind: 'inventory' as const,
      mediaType: 'application/json' as const,
      bytes: Buffer.from(canonical({ model: 'part', pk: '7', label: 'Fixture part' })),
    }
    const results = await Promise.allSettled(
      Array.from({ length: 18 }, () =>
        receipts.publish(randomUUID(), { model: 'part', pk: '7' }, source),
      ),
    )
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 16)
    const refused = results.filter((result) => result.status === 'rejected')
    assert.equal(refused.length, 2)
    for (const result of refused) {
      assert.ok(result.status === 'rejected' && /research_capacity/.test(String(result.reason)))
    }
    assert.equal(
      (await fixture.db.pool.query('SELECT count(*) FROM research_receipt')).rows[0].count,
      '16',
    )
  } finally {
    await fixture.dispose()
  }
})

test('receipt bytes are capped per attempt and corruption is refused without repair', async () => {
  const fixture = await restrictedFixture()
  try {
    const { command } = await startReading(fixture)
    const access = await researchAttemptAccess(fixture.runner.pool, fixture.config, command)
    const receipts = researchReceiptStore(fixture.runner.pool, access.scope)
    const source = {
      kind: 'web' as const,
      mediaType: 'text/plain' as const,
      sourceUrl: approvedSource,
      bytes: Buffer.alloc(1024 * 1024, 65),
    }
    const published: ResearchReceiptDto[] = []
    for (let index = 0; index < 4; index += 1) {
      published.push(await receipts.publish(randomUUID(), { url: approvedSource }, source))
    }
    await assert.rejects(
      () =>
        receipts.publish(
          randomUUID(),
          { url: approvedSource },
          { ...source, bytes: Buffer.from('x') },
        ),
      /research_capacity/,
    )
    assert.equal(
      (await fixture.db.pool.query('SELECT sum(byte_size)::text AS size FROM research_receipt'))
        .rows[0].size,
      String(4 * 1024 * 1024),
    )
    // Fault injection is confined to this random owned database's migration role.
    await fixture.db.pool.query('ALTER TABLE research_receipt DISABLE TRIGGER USER')
    await fixture.db.pool.query('UPDATE research_receipt SET body_bytes=$1 WHERE id=$2', [
      Buffer.alloc(source.bytes.length, 66),
      published[0].id,
    ])
    await fixture.db.pool.query('ALTER TABLE research_receipt ENABLE TRIGGER USER')
    await assert.rejects(() => receipts.read(published[0].id), /research_receipt_corrupt/)
    const retained = await fixture.db.pool.query(
      'SELECT body_bytes FROM research_receipt WHERE id=$1',
      [published[0].id],
    )
    assert.ok(retained.rows[0].body_bytes.equals(Buffer.alloc(source.bytes.length, 66)))
  } finally {
    await fixture.dispose()
  }
})

test('V3 human answers create fresh restricted continuations and retain exact ready predecessors', async () => {
  const fixture = await restrictedFixture()
  try {
    const capture = await fixture.seedCapture()
    const started = await fixture.http(`/batches/${capture.batch.id}/processing`, {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.packetB.id],
      stages: ['reading', 'research'],
    })
    assert.equal(started.status, 202)
    const [readingId, researchId] = started.value.attempt_ids
    const reading = await claimAttempt(fixture, readingId)
    assert.ok(reading)
    await acceptEnvelope(
      fixture.runner.pool,
      fixture.config,
      reading.channelToken,
      envelope(reading, '1', { kind: 'terminal', payload: { state: 'ready' } }),
    )
    const research = await claimAttempt(fixture, researchId)
    assert.ok(research)
    await acceptEnvelope(
      fixture.runner.pool,
      fixture.config,
      research.channelToken,
      envelope(research, '1', {
        kind: 'question',
        payload: {
          kind: 'quantity',
          subject_id: capture.packetB.id,
          prompt: 'Confirm the counted quantity.',
          reason: 'Deterministic fixture question.',
        },
      }),
    )
    const waiting = await snapshot(fixture, capture.batch.id)
    const question = waiting.jobs.find((job) => job.stage === 'research')!.questions[0]
    const answer = {
      schema_version: 'bench-intake-answer/1',
      expected_question_revision: question.revision,
      expected_capture_revision: capture.batch.revision,
      attempt_id: question.attempt_id,
      input_sha256: question.input_sha256,
      value: { kind: 'quantity', value: '77.000001', basis: 'counted' },
    }
    const answerKey = randomUUID()
    const path = `/batches/${capture.batch.id}/questions/${question.id}/answers`
    const answered = await fixture.http(path, answer, answerKey)
    assert.equal(answered.status, 200)
    const continued = await snapshot(fixture, capture.batch.id)
    assert.equal(continued.jobs.find((job) => job.stage === 'reading')!.attempt_id, readingId)
    const fresh = await claimAttempt(
      fixture,
      continued.jobs.find((job) => job.stage === 'research')!.attempt_id,
    )
    assert.ok(fresh)
    assert.equal(fresh.manifest.schema_version, 'bench-intake-input/3')
    assert.deepEqual(fresh.manifest.dependencies, [readingId])
    assert.ok('quantity' in fresh.manifest.subject)
    assert.deepEqual(fresh.manifest.subject.quantity, { mode: 'set', value: '77.000001' })
    // An exact old answer receipt is adopted even after its continuation has become stale.
    const currentCapture = await fixture.http(`/batches/${capture.batch.id}`)
    const edited = await fixture.http(`/batches/${capture.batch.id}/edits`, {
      expected_revision: currentCapture.value.revision,
      change: { kind: 'lot', id: capture.packetB.id, quantity: { mode: 'set', value: '80' } },
    })
    assert.equal(edited.status, 200)

    assert.deepEqual((await fixture.http(path, answer, answerKey)).value, answered.value)
    const saved = await fixture.http(`/batches/${capture.batch.id}`)
    assert.deepEqual(
      saved.value.lots.find((lot: { id: string }) => lot.id === capture.packetB.id).quantity,
      { mode: 'set', value: '80' },
    )
  } finally {
    await fixture.dispose()
  }
})

test('explicit deterministic protocol adapter executes the claimed V3 command through receipt settlement', async () => {
  const fixture = await restrictedFixture()
  try {
    const capture = await fixture.seedCapture()
    const started = await fixture.http(`/batches/${capture.batch.id}/processing`, {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.packetA.id],
      stages: ['reading'],
    })
    assert.equal(started.status, 202)
    const retained = await fixture.db.pool.query(
      `SELECT workflow_id,payload_bytes FROM command JOIN processing_attempt attempt ON attempt.command_id=command.id WHERE attempt.id=$1`,
      [started.value.attempt_ids[0]],
    )
    const messages = new PassThrough({ objectMode: true })
    let reaped = false
    function call(id: number, tool: string, args: unknown) {
      messages.write({
        id,
        method: 'item/tool/call',
        params: {
          threadId: 'fixture-thread',
          turnId: 'fixture-turn',
          callId: `fixture-call-${id}`,
          namespace: 'bench_intake',
          tool,
          arguments: args,
        },
      })
    }
    const runner = restrictedResearchRunner({
      createSession: async () => ({
        messages,
        async send(value) {
          const frame = value as {
            id?: string | number
            method?: string
            result?: { contentItems: { text: string }[] }
          }
          if (frame.method === 'initialize') {
            messages.write({ id: frame.id, result: { userAgent: 'deterministic-fixture' } })
          } else if (frame.method === 'thread/start') {
            messages.write({ id: frame.id, result: { thread: { id: 'fixture-thread' } } })
          } else if (frame.method === 'turn/start') {
            messages.write({ id: frame.id, result: { turn: { id: 'fixture-turn' } } })
            call(100, 'lookup_inventory', { model: 'part', pk: '7' })
          } else if (frame.id === 100) {
            const result = JSON.parse(frame.result!.contentItems[0].text) as {
              receipt: ResearchReceiptDto
            }
            call(101, 'submit_proposal', {
              schema_version: 'bench-intake-proposal/3',
              subject_id: capture.packetA.id,
              summary: 'Deterministic receipt-backed candidate.',
              sources: [
                {
                  kind: 'research_receipt',
                  receipt_id: result.receipt.id,
                  sha256: result.receipt.sha256,
                },
              ],
            })
          } else if (frame.id === 101) {
            messages.write({
              method: 'turn/completed',
              params: {
                threadId: 'fixture-thread',
                turn: { id: 'fixture-turn', status: 'completed' },
              },
            })
          }
        },
        async close() {
          reaped = true
          messages.end()
        },
      }),
      createBroker: async (input) => {
        const access = await researchAttemptAccess(fixture.runner.pool, fixture.config, input)
        return researchBroker({
          access,
          receipts: researchReceiptStore(fixture.runner.pool, access.scope),
          readEvidence: async () => assert.fail('no media'),
          readInventory: async () => Response.json({ pk: 7, name: 'Fixture Part' }),
          protectedOrigins: fixture.config.sourceProtectedOrigins,
        })
      },
    })
    const outcome = await executeProcessingCommand(
      fixture.runner.pool,
      fixture.config,
      retained.rows[0].workflow_id,
      strictJson(retained.rows[0].payload_bytes.toString('utf8')),
      runner,
    )
    assert.deepEqual(outcome, { state: 'ready' })
    assert.equal(reaped, true)
    assert.equal((await fixture.http('/processing-activity')).value.lane_occupied, false)
    const result = await snapshot(fixture, capture.batch.id)
    assert.equal(result.jobs[0].proposals.length, 1)
    assert.equal(result.jobs[0].state, 'ready')
  } finally {
    await fixture.dispose()
  }
})

test('uncertain adapter reap retains the exact lane through cancel/reprocess until a known-reaped interruption', async () => {
  const fixture = await restrictedFixture()
  try {
    const capture = await fixture.seedCapture()
    const request = {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.packetA.id],
      stages: ['reading'],
    }
    const started = await fixture.http(`/batches/${capture.batch.id}/processing`, request)
    assert.equal(started.status, 202)
    const oldAttempt = started.value.attempt_ids[0] as string
    const retained = await fixture.db.pool.query(
      `SELECT command.workflow_id,command.payload_bytes FROM command
       JOIN processing_attempt attempt ON attempt.command_id=command.id WHERE attempt.id=$1`,
      [oldAttempt],
    )
    let oldInput: ResearchInput | undefined
    await assert.rejects(
      () =>
        executeProcessingCommand(
          fixture.runner.pool,
          fixture.config,
          retained.rows[0].workflow_id,
          strictJson(retained.rows[0].payload_bytes.toString('utf8')),
          {
            profileId: 'restricted-research-stub/1',
            qualification: 'fixture_only',
            async run(input) {
              oldInput = input
              // Simulated trusted-host uncertainty, not an actual operating-system reap failure.
              throw new ResearchReapPendingError()
            },
          },
        ),
      /research_reap_unconfirmed/,
    )
    assert.ok(oldInput)
    const held = await fixture.db.pool.query(
      'SELECT attempt_id FROM processing_lane WHERE actor_id=$1',
      [fixture.identity.actor],
    )
    assert.deepEqual(held.rows, [{ attempt_id: oldAttempt }])
    assert.equal((await snapshot(fixture, capture.batch.id)).jobs[0].state, 'running')
    assert.equal((await fixture.http('/processing-activity')).value.lane_occupied, true)

    const running = (await snapshot(fixture, capture.batch.id)).jobs[0]
    const cancelled = await fixture.http(
      `/batches/${capture.batch.id}/processing/${running.id}/cancellation`,
      {
        expected_revision: running.revision,
        attempt_id: oldAttempt,
      },
    )
    assert.equal(cancelled.status, 200)
    const replacement = await fixture.http(`/batches/${capture.batch.id}/processing`, request)
    assert.equal(replacement.status, 202)
    const freshAttempt = replacement.value.attempt_ids[0] as string
    assert.notEqual(freshAttempt, oldAttempt)
    assert.equal(await claimAttempt(fixture, freshAttempt), null)
    const stillHeld = await fixture.db.pool.query(
      'SELECT attempt_id FROM processing_lane WHERE actor_id=$1',
      [fixture.identity.actor],
    )
    assert.deepEqual(stillHeld.rows, [{ attempt_id: oldAttempt }])
    assert.equal((await snapshot(fixture, capture.batch.id)).jobs[0].state, 'queued')

    // The fixture now supplies the explicit known-reaped point. Delivery did not infer it.
    await interruptProcessing(fixture.runner.pool, fixture.config, oldAttempt)
    const fresh = await claimAttempt(fixture, freshAttempt)
    assert.ok(fresh)
    const oldCommand: Claimed = {
      ...oldInput,
      channelToken: channelToken(fixture.config, oldAttempt),
    }
    assert.equal(
      await acceptEnvelope(
        fixture.runner.pool,
        fixture.config,
        oldCommand.channelToken,
        envelope(oldCommand, '1', { kind: 'terminal', payload: { state: 'ready' } }),
      ),
      'stale',
    )
    const currentLane = await fixture.db.pool.query(
      'SELECT attempt_id FROM processing_lane WHERE actor_id=$1',
      [fixture.identity.actor],
    )
    assert.deepEqual(currentLane.rows, [{ attempt_id: freshAttempt }])
    const currentJob = (await snapshot(fixture, capture.batch.id)).jobs[0]
    assert.equal(currentJob.attempt_id, freshAttempt)
    assert.equal(currentJob.state, 'running')
    await acceptEnvelope(
      fixture.runner.pool,
      fixture.config,
      fresh.channelToken,
      envelope(fresh, '1', { kind: 'terminal', payload: { state: 'ready' } }),
    )
    assert.equal((await fixture.http('/processing-activity')).value.lane_occupied, false)
    assert.equal((await snapshot(fixture, capture.batch.id)).jobs[0].state, 'ready')
  } finally {
    await fixture.dispose()
  }
})
