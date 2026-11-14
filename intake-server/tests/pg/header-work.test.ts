import { validate, type ProcessingReceiptDto, type ManualPreviewDto } from '@invimport/contracts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { devConfig } from '#/config.ts'
import { processingFixture } from '../support/processing.ts'
import { headerWork } from '#/header/work.ts'
import { scopedConnectionStatus } from '#/header/binding.ts'
import { nativeProfileId } from '#/agents/policy.ts'
import { saveAgentSettings } from '#/agents/settings.ts'
import { manualFixture } from '../support/manual.ts'
import { grantProcessing } from '#/processing/grants.ts'
import { grantManual } from '#/review/grants.ts'
import { listAgentSessions } from '#/agents/session/sessions.ts'
import { startProcessing } from '#/processing/commands.ts'

test('header retains physically occupied cancelled sessions and fences foreign scope', async () => {
  const fixture = await processingFixture({ profileId: nativeProfileId })
  try {
    await grantManual(fixture.db.pool, fixture.api.name, 'api')
    const capture = await fixture.seedCapture()
    await saveAgentSettings(fixture.api.pool, fixture.config, {
      expected_revision: '0',
      selection: { provider: 'codex', authentication: 'subscription', model: 'synthetic-only' },
    })
    const request = {
      schema_version: 'bench-intake-processing/1' as const,
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.packetA.id],
      stages: ['reading' as const],
    }
    const queued = await startProcessing(
      fixture.api.pool,
      fixture.config,
      capture.batch.id,
      randomUUID(),
      request,
    )
    validate('ProcessingReceipt', queued)
    const attemptId = (queued as ProcessingReceiptDto).attempt_ids[0]
    await fixture.db.pool.query('UPDATE processing_attempt SET state=$2 WHERE id=$1', [
      attemptId,
      'cancelled',
    ])
    await fixture.db.pool.query(
      'INSERT INTO processing_lane(actor_id,attempt_id) VALUES ($1,$2) ON CONFLICT(actor_id) DO UPDATE SET attempt_id=excluded.attempt_id',
      [fixture.config.actorId, attemptId],
    )
    for (let index = 1; index <= 51; index += 1) {
      const commandId = randomUUID()
      const historicalId = randomUUID()
      await fixture.db.pool.query(
        `INSERT INTO command(id,actor_id,target_id,target_context_id,kind,handler_version,workflow_id,queue_name,payload_bytes,payload_digest)
        SELECT $1,actor_id,target_id,target_context_id,kind,handler_version,$2,queue_name,payload_bytes,payload_digest FROM command WHERE id=(SELECT command_id FROM processing_attempt WHERE id=$3)`,
        [commandId, `header-history-${commandId}`, attemptId],
      )
      await fixture.db.pool.query(
        `INSERT INTO processing_attempt(id,batch_id,job_id,number,input_id,profile_id,command_id,channel_digest,state)
        SELECT $1,batch_id,job_id,number+$2,input_id,profile_id,$3,channel_digest,'queued' FROM processing_attempt WHERE id=$4`,
        [historicalId, index, commandId, attemptId],
      )
      await fixture.db.pool.query(
        "INSERT INTO agent_session(attempt_id,queued_at) VALUES ($1,now()+($2 * interval '1 second'))",
        [historicalId, index],
      )
    }
    const firstHistory = await listAgentSessions(fixture.api.pool, fixture.config)
    assert.equal(firstHistory.sessions.length, 50)
    assert(!firstHistory.sessions.some((session) => session.attempt_id === attemptId))
    const config = {
      ...devConfig({
        INTAKE_ORIGIN: 'http://127.0.0.1:4333',
        INTAKE_CREDENTIAL_REF: 'header-fixture',
        INTAKE_DEV_API_KEY: 'fake-only',
      }),
      ...fixture.config,
    }
    const result = await headerWork(fixture.api.pool, config, capture.batch.id)
    assert.equal(result.active_sessions.length, 50)
    assert.equal(result.sessions_truncated, true)
    assert.equal(result.work_truncated, false)
    assert.equal(result.active_sessions[0].state, 'cancelled')
    assert.equal(result.active_sessions[0].occupies_lane, true)
    assert.equal(result.lane_occupied, true)
    assert.equal(result.active_sessions[0].attempt_id, attemptId)
    assert(!JSON.stringify(result).includes('native_session_id'))
    assert.equal(
      (await headerWork(fixture.api.pool, { ...config, actorId: randomUUID() })).active_sessions
        .length,
      0,
    )
    await assert.rejects(
      headerWork(fixture.api.pool, { ...config, targetContextId: randomUUID() }),
      /target_context_changed/,
    )
  } finally {
    await fixture.dispose()
  }
})

test('rotated target context fences cached connection observations', async () => {
  const fixture = await processingFixture()
  try {
    let calls = 0
    const read = scopedConnectionStatus(
      fixture.api.pool,
      fixture.config,
      'https://inventory.example.invalid/',
      async () => {
        calls += 1
        return new Response('{}', { headers: { 'content-type': 'application/json' } })
      },
    )
    assert.equal((await read()).target.state, 'reachable')
    await fixture.db.pool.query('UPDATE target SET current_context_id=NULL WHERE id=$1', [
      fixture.config.targetId,
    ])
    await assert.rejects(read(), /target_context_changed/)
    assert.equal(calls, 1)
    await fixture.db.pool.query('UPDATE target SET current_context_id=$2 WHERE id=$1', [
      fixture.config.targetId,
      fixture.config.targetContextId,
    ])
    let settle: ((value: Response) => void) | undefined
    let started: (() => void) | undefined
    const began = new Promise<void>((resolve) => {
      started = resolve
    })
    const waiting = scopedConnectionStatus(
      fixture.api.pool,
      fixture.config,
      'https://inventory.example.invalid/',
      () => {
        started?.()
        return new Promise<Response>((resolve) => {
          settle = resolve
        })
      },
    )
    const late = waiting()
    await began
    await fixture.db.pool.query('UPDATE target SET current_context_id=NULL WHERE id=$1', [
      fixture.config.targetId,
    ])
    settle?.(new Response('{}', { headers: { 'content-type': 'application/json' } }))
    await assert.rejects(late, /target_context_changed/)
  } finally {
    await fixture.dispose()
  }
})

test('current batch work precedes global work and incomplete step knowledge stays explicit', async () => {
  const fixture = await processingFixture()
  try {
    await grantManual(fixture.db.pool, fixture.api.name, 'api')
    const first = await fixture.seedCapture()
    const second = await fixture.seedCapture()
    for (const capture of [first, second]) {
      await startProcessing(fixture.api.pool, fixture.config, capture.batch.id, randomUUID(), {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: capture.batch.revision,
        subject_ids: [capture.packetA.id],
        stages: ['reading'],
      })
    }
    const config = {
      ...devConfig({
        INTAKE_ORIGIN: 'http://127.0.0.1:4333',
        INTAKE_CREDENTIAL_REF: 'header-fixture',
        INTAKE_DEV_API_KEY: 'fake-only',
      }),
      ...fixture.config,
    }
    const result = await headerWork(fixture.api.pool, config, second.batch.id)
    assert.equal(result.work[0].batch_id, second.batch.id)
    assert(result.work.some((entry) => entry.batch_id === first.batch.id))
    const current = result.work.find(
      (entry) => entry.kind === 'processing' && entry.batch_id === second.batch.id,
    )
    assert(current && current.kind === 'processing')
    assert.deepEqual(current.steps, [{ stage: 'reading', state: 'queued' }])
    assert.equal(current.steps_complete, false)
    assert.equal(result.work_truncated, false)
  } finally {
    await fixture.dispose()
  }
})

test('the header counts each step of the open batch and of other batches with live work', async () => {
  const fixture = await processingFixture()
  try {
    await grantManual(fixture.db.pool, fixture.api.name, 'api')
    const first = await fixture.seedCapture()
    const second = await fixture.seedCapture()
    await startProcessing(fixture.api.pool, fixture.config, first.batch.id, randomUUID(), {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: first.batch.revision,
      subject_ids: [first.packetA.id],
      stages: ['reading'],
    })
    await startProcessing(fixture.api.pool, fixture.config, second.batch.id, randomUUID(), {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: second.batch.revision,
      subject_ids: [second.packetA.id, second.packetB.id],
      stages: ['reading'],
    })
    const config = {
      ...devConfig({
        INTAKE_ORIGIN: 'http://127.0.0.1:4333',
        INTAKE_CREDENTIAL_REF: 'header-fixture',
        INTAKE_DEV_API_KEY: 'fake-only',
      }),
      ...fixture.config,
    }
    const none = { jobs: 0, ready: 0, running: 0 }
    const counted = (result: Awaited<ReturnType<typeof headerWork>>, batchId: string) =>
      result.batch_steps?.find((entry) => entry.batch_id === batchId)?.steps

    const open = await headerWork(fixture.api.pool, config, second.batch.id)
    assert.deepEqual(counted(open, second.batch.id), {
      examine: { jobs: 2, ready: 0, running: 0 },
      research: none,
      images: none,
      inventory: none,
    })
    assert.deepEqual(counted(open, first.batch.id)?.examine, { jobs: 1, ready: 0, running: 0 })

    await fixture.db.pool.query(
      `UPDATE processing_job SET state='ready' WHERE batch_id=$1 AND subject_id=$2`,
      [second.batch.id, second.packetA.id],
    )
    const global = await headerWork(fixture.api.pool, config)
    assert.deepEqual(counted(global, second.batch.id)?.examine, { jobs: 2, ready: 1, running: 0 })
    validate('HeaderWork', global)
  } finally {
    await fixture.dispose()
  }
})

test('retained import approval and dispatch receipts appear without starting execution', async () => {
  const fixture = await manualFixture()
  try {
    await grantProcessing(fixture.db.pool, fixture.api.name, 'api')
    const capture = await fixture.seedCapture()
    const scope = {
      expected_batch_revision: capture.batch.revision,
      selected_lot_ids: [capture.a.id],
    }
    const reviewed = await fixture.http(`/batches/${capture.batch.id}/reviews`, scope)
    assert.equal(reviewed.status, 200)
    const prepared = await fixture.http(`/batches/${capture.batch.id}/preparations`, scope)
    assert.equal(prepared.status, 200)
    const preview = prepared.value.preparation as ManualPreviewDto
    const approved = await fixture.http(`/preparations/${preview.id}/approvals`, {
      preparation_id: preview.id,
      expected_plan_sha256: preview.plan_sha256,
      expected_review_fingerprint: preview.review_fingerprint,
      selected_lot_ids: preview.selected_lot_ids,
      expected_target_revision: preview.target_revision,
    })
    assert.equal(approved.status, 200)
    const result = await headerWork(
      fixture.api.pool,
      { ...fixture.config, channelSecret: 'synthetic-header-channel-only-0000000000000000' },
      capture.batch.id,
    )
    const run = result.work.find((entry) => entry.kind === 'import')
    assert(run && run.kind === 'import')
    assert.deepEqual(run.steps, [
      { name: 'approval', state: 'confirmed' },
      { name: 'dispatch', state: 'not_requested' },
      { name: 'inventory', state: 'none' },
    ])
    assert.equal(run.steps_complete, false)
    assert.equal(result.active_sessions.length, 0)
  } finally {
    await fixture.dispose()
  }
})
