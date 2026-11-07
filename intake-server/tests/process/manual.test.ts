import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DBOSClient } from '@dbos-inc/dbos-sdk'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import type { ManualRunDto, ManualPreviewDto } from '@invimport/contracts'
import { manualProcess, until } from '../support/manual-process.ts'
import { manualFixture } from '../support/manual.ts'
import { commitAckProxy } from '../fixtures/commit-ack-proxy.ts'
import { database } from '../../src/db/database.ts'
import { approvePreparation } from '../../src/review/preparations.ts'
import { executeManualDispatch } from '../../src/review/runner.ts'
import { ExternalGate } from '../../src/execution/ownership.ts'
import { seedPartAttachment, PART_ATTACHMENT_PNG } from '../support/part-attachment.ts'

async function prepared(
  fixture: Awaited<ReturnType<typeof manualFixture>>,
  batchId: string,
  revision: string,
  lotId: string,
) {
  const input = { expected_batch_revision: revision, selected_lot_ids: [lotId] }
  assert.equal((await fixture.http(`/batches/${batchId}/reviews`, input)).status, 200)
  const result = await fixture.http(`/batches/${batchId}/preparations`, input)
  assert.equal(result.value.status, 'prepared', JSON.stringify(result.value))
  return result.value.preparation as ManualPreviewDto
}
function approval(preview: ManualPreviewDto) {
  return {
    preparation_id: preview.id,
    expected_plan_sha256: preview.plan_sha256,
    expected_review_fingerprint: preview.review_fingerprint,
    selected_lot_ids: preview.selected_lot_ids,
    expected_target_revision: preview.target_revision,
  }
}

test(
  'separate web and runner retain a selected Part attachment across inspection, restart and a later round',
  { timeout: 90000 },
  async () => {
    const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
    assert.ok(image, 'Full process qualification requires the explicit decoder image')
    const fixture = await manualProcess(undefined, { media: true, effects: true })
    try {
      await fixture.startWeb()
      const captured = await seedPartAttachment(fixture, image)
      const preview = await prepared(
        fixture,
        captured.batch.id,
        captured.batch.revision,
        captured.a.id,
      )
      const accepted = await fixture.http(
        `/preparations/${preview.id}/approvals`,
        approval(preview),
      )
      assert.equal(accepted.status, 200, JSON.stringify(accepted.value))
      const runId = accepted.value.run_id as string
      let run = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
      assert.equal(run.dispatch_state, 'not_requested')
      assert.equal((await fixture.fake.records()).filter((row) => row.method === 'POST').length, 0)
      await fixture.fake.fault('part_attachment_incomplete')
      assert.equal(
        (await fixture.http(`/runs/${runId}/start`, { expected_run_revision: run.revision }))
          .status,
        200,
      )
      await fixture.startRunner()
      run = await until(
        async () => (await fixture.http(`/runs/${runId}`)).value as ManualRunDto,
        (value) => value.state === 'recovery_required' && value.dispatch_state === 'finished',
      )
      const originalAttachment = run.supported_effects!.find(
        (effect) => effect.kind === 'part_attachment',
      )!
      assert.equal(originalAttachment.certainty, 'unknown')
      assert.equal(originalAttachment.recovery_action, 'verify_effect')
      assert.deepEqual(originalAttachment.remote_pks, ['13001'])
      await fixture.stopRunner()
      await fixture.stopWeb()
      await fixture.restartFake()
      await fixture.startWeb()
      await fixture.fake.fault('none')
      await fixture.startRunner()
      const restored = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
      assert.deepEqual(restored, run)
      assert.equal(
        (
          await fixture.http(`/runs/${runId}/recover`, {
            expected_run_revision: restored.revision,
            assessment_keys: [originalAttachment.operation_key],
          })
        ).status,
        200,
      )
      run = await until(
        async () => (await fixture.http(`/runs/${runId}`)).value as ManualRunDto,
        (value) =>
          value.dispatch_state === 'finished' &&
          value.supported_effects!.some(
            (effect) =>
              effect.operation_key === originalAttachment.operation_key &&
              effect.certainty === 'confirmed',
          ),
      )
      const stock = run.supported_effects!.find((effect) => effect.kind === 'create_stock')!
      assert.equal(stock.certainty, 'none')
      assert.equal(
        (
          await fixture.http(`/runs/${runId}/recover`, {
            expected_run_revision: run.revision,
            effect_keys: [stock.operation_key],
          })
        ).status,
        200,
      )
      run = await until(
        async () => (await fixture.http(`/runs/${runId}`)).value as ManualRunDto,
        (value) => value.state === 'settled_complete' && value.dispatch_state === 'finished',
      )
      assert.equal(run.approval_id, accepted.value.approval_id)

      const next = await prepared(
        fixture,
        captured.batch.id,
        captured.batch.revision,
        captured.b.id,
      )
      const second = await fixture.http(`/preparations/${next.id}/approvals`, approval(next))
      assert.equal(second.status, 200, JSON.stringify(second.value))
      const nextRun = (await fixture.http(`/runs/${second.value.run_id}`)).value as ManualRunDto
      assert.equal(
        (
          await fixture.http(`/runs/${nextRun.run_id}/start`, {
            expected_run_revision: nextRun.revision,
          })
        ).status,
        200,
      )
      await until(
        async () => (await fixture.http(`/runs/${nextRun.run_id}`)).value as ManualRunDto,
        (value) => value.state === 'settled_complete' && value.dispatch_state === 'finished',
      )
      const posts = (await fixture.fake.records()).filter((row) => row.method === 'POST')
      assert.equal(posts.filter((row) => row.path === '/api/part/?tags=true').length, 1)
      assert.equal(posts.filter((row) => row.path === '/api/attachment/').length, 1)
      assert.equal(posts.filter((row) => row.path === '/api/stock/').length, 2)
      const attachment = await fixture.db.pool.query<{ bytes: Buffer; part: string }>(
        'SELECT bytes,part FROM fake_part_attachment',
      )
      assert.equal(attachment.rows.length, 1)
      assert.equal(attachment.rows[0].part, '8101')
      assert.ok(attachment.rows[0].bytes.equals(PART_ATTACHMENT_PNG))
    } finally {
      await fixture.dispose()
    }
  },
)

test(
  'actual web and separately launched DBOS runner: approval-before-enqueue, restart/results/later round, original IDs and exact POST counts',
  { timeout: 60000 },
  async () => {
    const fixture = await manualProcess()
    let scheduler: DBOSClient | undefined
    try {
      await fixture.startWeb()
      const capture = await fixture.seedCapture()
      const preview = await prepared(
        fixture,
        capture.batch.id,
        capture.batch.revision,
        capture.a.id,
      )
      const accepted = await fixture.http(
        `/preparations/${preview.id}/approvals`,
        approval(preview),
      )
      assert.equal(accepted.status, 200, JSON.stringify(accepted.value))
      assert.equal(
        (
          await fixture.db.pool.query(
            'SELECT count(*)::int AS n FROM outbox WHERE acked_at IS NULL',
          )
        ).rows[0].n,
        1,
      )
      assert.equal(
        (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
        0,
      )
      // Actual web restart after approval, before either enqueue or physical apply.
      await fixture.stopWeb()
      await fixture.startWeb()
      assert.deepEqual(
        (await fixture.http(`/preparations/${preview.id}/approvals`, approval(preview))).value,
        accepted.value,
      )
      let run = (await fixture.http(`/runs/${accepted.value.run_id}`)).value as ManualRunDto
      assert.equal(
        (await fixture.http(`/runs/${run.run_id}/start`, { expected_run_revision: run.revision }))
          .status,
        200,
      )
      await fixture.startRunner()
      run = await until(
        async () => (await fixture.http(`/runs/${run.run_id}`)).value as ManualRunDto,
        (value) => value.state === 'settled_complete' && value.dispatch_state === 'finished',
      )
      assert.deepEqual(run.confirmed_stock_ids, ['7101'])
      assert.equal(
        (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
        1,
      )
      scheduler = await DBOSClient.create({
        systemDatabaseUrl: fixture.scheduler.url,
        systemDatabasePoolSize: 1,
      })
      const command = (
        await fixture.db.pool.query(
          'SELECT c.* FROM executor_run r JOIN command c ON c.id=r.command_id WHERE r.id=$1',
          [run.run_id],
        )
      ).rows[0]
      const scheduled = await scheduler.getWorkflow(command.workflow_id)
      assert.deepEqual(scheduled?.input, [
        {
          approvalId: accepted.value.approval_id,
          planDigest: preview.plan_sha256,
          runId: run.run_id,
        },
      ])
      assert.equal(
        (
          await fixture.db.pool.query('SELECT acked_at FROM outbox WHERE command_id=$1', [
            command.id,
          ])
        ).rows[0].acked_at instanceof Date,
        true,
      )
      // Result delivery is deliberately ignored; restart reads authoritative journal/cursor.
      await fixture.stopRunner()
      await fixture.stopWeb()
      await fixture.restartFake()
      await fixture.startWeb()
      await fixture.startRunner()
      const restored = (await fixture.http(`/runs/${run.run_id}`)).value as ManualRunDto
      assert.deepEqual(restored, run)
      const second = await prepared(fixture, capture.batch.id, capture.batch.revision, capture.b.id)
      const acceptedB = await fixture.http(`/preparations/${second.id}/approvals`, approval(second))
      assert.equal(acceptedB.status, 200, JSON.stringify(acceptedB.value))
      const beforeB = (await fixture.http(`/runs/${acceptedB.value.run_id}`)).value as ManualRunDto
      assert.equal(
        (
          await fixture.http(`/runs/${beforeB.run_id}/start`, {
            expected_run_revision: beforeB.revision,
          })
        ).status,
        200,
      )
      await until(
        async () => (await fixture.http(`/runs/${beforeB.run_id}`)).value as ManualRunDto,
        (value) => value.state === 'settled_complete',
      )
      const posts = (await fixture.fake.records()).filter((value) => value.method === 'POST')
      assert.equal(posts.length, 2)
      assert.equal(
        posts[0].body.toString(),
        `{"barcode":"bi1:${capture.batch.source_id}:${capture.a.contribution_key}","location":"43","part":"29","quantity":"17"}`,
      )
      assert.equal(
        posts[1].body.toString(),
        `{"barcode":"bi1:${capture.batch.source_id}:${capture.b.contribution_key}","location":"48","part":"29","quantity":"23"}`,
      )
    } finally {
      await scheduler?.destroy()
      await fixture.dispose()
    }
  },
)

test(
  'real lost domain approval COMMIT ACK recalls exact original authority after mutable edit; no replacement allocation',
  { timeout: 30000 },
  async () => {
    const fixture = await manualFixture()
    const proxy = await commitAckProxy(fixture.api.url)
    const proxied = database(proxy.url)
    try {
      const capture = await fixture.seedCapture()
      const preview = await prepared(
        fixture,
        capture.batch.id,
        capture.batch.revision,
        capture.a.id,
      )
      const key = randomUUID()
      proxy.dropNextCommit()
      await assert.rejects(
        approvePreparation(proxied.pool, fixture.config, key, approval(preview)),
        /Connection terminated/,
      )
      assert.equal(proxy.losses, 1)
      assert.equal(
        (await fixture.db.pool.query('SELECT count(*)::int AS n FROM manual_approval')).rows[0].n,
        1,
      )
      await capture.edit({
        kind: 'lot',
        id: capture.a.id,
        label: 'Changed after committed approval',
      })
      const adopted = await fixture.http(
        `/preparations/${preview.id}/approvals`,
        approval(preview),
        key,
      )
      assert.equal(adopted.status, 200, JSON.stringify(adopted.value))
      const replay = await fixture.http(`/preparations/${preview.id}/approvals`, approval(preview))
      assert.deepEqual(replay.value, adopted.value)
      assert.equal(
        (await fixture.db.pool.query('SELECT count(*)::int AS n FROM executor_run')).rows[0].n,
        1,
      )
      assert.equal(
        (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
        0,
      )
    } finally {
      await proxied.close()
      await proxy.close()
      await fixture.dispose()
    }
  },
)

test(
  'actual physical no-effect checkpoint recovers through API under the original run/approval with exactly one create',
  { timeout: 30000 },
  async () => {
    const fixture = await manualFixture()
    const gate = new ExternalGate(fixture.gateRoot)
    const claim = await gate.claim()
    let child: ReturnType<typeof fork> | undefined
    let reaped = false
    try {
      const capture = await fixture.seedCapture()
      const preview = await prepared(
        fixture,
        capture.batch.id,
        capture.batch.revision,
        capture.a.id,
      )
      const accepted = await fixture.http(
        `/preparations/${preview.id}/approvals`,
        approval(preview),
      )
      assert.equal(accepted.status, 200)
      child = fork(fileURLToPath(new URL('./executor-worker.ts', import.meta.url)), [], {
        execArgv: ['--import', 'tsx'],
        env: { PATH: process.env.PATH },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      })
      const messages: { kind?: string; pid?: number }[] = []
      child.on('message', (message) => messages.push(message as { kind?: string; pid?: number }))
      const exited = once(child, 'exit')
      child.send({
        databaseUrl: fixture.apply.url,
        gateRoot: fixture.gateRoot,
        claimToken: claim.token,
        runId: accepted.value.run_id,
        profile: fixture.runnerConfig.profile,
        recoveryIds: [],
        pause: 'intent_committed',
        pauseKind: 'create_stock',
      })
      await until(
        async () => messages,
        (value) => value.some((message) => message.kind === 'paused'),
      )
      const writer = messages.find((value) => value.kind === 'writer')!
      await fixture.db.pool.query('SELECT pg_terminate_backend($1)', [writer.pid])
      child.send({ resume: true })
      await exited
      reaped = true
      await claim.releaseAfterReap()
      const original = (await fixture.http(`/runs/${accepted.value.run_id}`)).value as ManualRunDto
      assert.equal(original.state, 'settled_incomplete')
      assert.equal(original.operations[0].certainty, 'none')
      assert.equal(
        (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
        0,
      )
      const recovered = await fixture.http(`/runs/${original.run_id}/recover`, {
        expected_run_revision: original.revision,
        operation_keys: [capture.a.id],
      })
      assert.equal(recovered.status, 200, JSON.stringify(recovered.value))
      assert.equal(recovered.value.run_id, original.run_id)
      const command = (
        await fixture.db.pool.query(
          'SELECT c.workflow_id,c.payload_bytes FROM manual_dispatch d JOIN command c ON c.id=d.command_id WHERE d.run_id=$1',
          [original.run_id],
        )
      ).rows[0]
      const result = await executeManualDispatch(
        fixture.runner.pool,
        fixture.runnerConfig,
        command.workflow_id,
        JSON.parse(command.payload_bytes.toString()),
      )
      assert.equal(result.state, 'settled_complete')
      assert.equal(
        (await fixture.fake.records()).filter((value) => value.method === 'POST').length,
        1,
      )
      assert.equal(
        (
          await fixture.db.pool.query('SELECT kind FROM executor_recovery WHERE run_id=$1', [
            original.run_id,
          ])
        ).rows[0].kind,
        'resume_no_effect',
      )
      assert.equal(
        (await fixture.db.pool.query('SELECT count(*)::int AS n FROM manual_approval')).rows[0].n,
        1,
      )
      assert.equal(
        (await fixture.db.pool.query('SELECT count(*)::int AS n FROM executor_run')).rows[0].n,
        1,
      )
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.kill('SIGKILL')
        await exited
      }
      if (!reaped) {
        await claim.releaseAfterReap()
      }
      await fixture.dispose()
    }
  },
)
