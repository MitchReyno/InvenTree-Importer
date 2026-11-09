import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile, writeFile, mkdtemp, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import WebSocket from 'ws'
import { LIVE_PROTOCOL, type LiveFrameDto, type ManualRunDto } from '@invimport/contracts'
import { manualProcess, until } from '../support/manual-process.ts'
import { isolatedDatabase } from '../support/database.ts'
import { ownedPgTools } from '../support/pg-tools.ts'
import { backupArchive, restoreArchive } from '#/operations/archive.ts'
import { startApply } from '#/execution/supervisor.ts'
import { ExternalGate } from '#/execution/ownership.ts'
import { loadRun } from '#/execution/authority.ts'

async function setActivation(gateRoot: string, enabled: boolean) {
  const path = join(gateRoot, 'activation.json')
  const value = JSON.parse(await readFile(path, 'utf8'))
  await writeFile(path, JSON.stringify({ ...value, enabled }), { mode: 0o600 })
}

test(
  'real DBOS/manual run publishes live completion; older coherent restore cannot repeat its later remote create',
  { timeout: 90000 },
  async () => {
    const fixture = await manualProcess()
    const restored = await isolatedDatabase({ migrate: false, restore: true })
    const root = await realpath(await mkdtemp(join(tmpdir(), 'intake-restore-history-')))
    let socket: WebSocket | undefined
    try {
      await fixture.startWeb()
      const capture = await fixture.seedCapture()
      await fixture.startRunner()
      const selected = {
        expected_batch_revision: capture.batch.revision,
        selected_lot_ids: [capture.a.id],
      }
      assert.equal(
        (await fixture.http(`/batches/${capture.batch.id}/reviews`, selected)).status,
        200,
      )
      const prepared = await fixture.http(`/batches/${capture.batch.id}/preparations`, selected)
      const preview = prepared.value.preparation
      const accepted = await fixture.http(`/preparations/${preview.id}/approvals`, {
        preparation_id: preview.id,
        expected_plan_sha256: preview.plan_sha256,
        expected_review_fingerprint: preview.review_fingerprint,
        selected_lot_ids: preview.selected_lot_ids,
        expected_target_revision: preview.target_revision,
      })
      assert.equal(accepted.status, 200)
      const runId = accepted.value.run_id as string
      await fixture.stopRunner()
      await setActivation(fixture.gateRoot, false)
      const config = {
        databaseUrl: fixture.db.url,
        schedulerDatabaseUrl: fixture.scheduler.url,
        gateRoot: fixture.gateRoot,
        archive: join(root, 'archive'),
      }
      await backupArchive(fixture.db.pool, config, ownedPgTools)
      const frames: LiveFrameDto[] = []
      socket = new WebSocket(fixture.config.origin.replace('http:', 'ws:') + '/api/v1/live', {
        headers: { origin: fixture.config.origin },
      })
      socket.on('message', (bytes) => frames.push(JSON.parse(bytes.toString())))
      await once(socket, 'open', { signal: AbortSignal.timeout(5000) })
      const bootstrap = await fixture.http('/bootstrap')
      socket.send(
        JSON.stringify({
          type: 'subscribe',
          protocol: LIVE_PROTOCOL,
          csrf_token: bootstrap.value.csrf_token,
          batch_id: capture.batch.id,
          cursors: [],
        }),
      )
      await until(
        async () => frames,
        (value) => value.some((frame) => frame.type === 'ready'),
      )
      await setActivation(fixture.gateRoot, true)
      await fixture.startRunner()
      const original = (await fixture.http(`/runs/${runId}`)).value as ManualRunDto
      assert.equal(
        (await fixture.http(`/runs/${runId}/start`, { expected_run_revision: original.revision }))
          .status,
        200,
      )
      const completed = await until(
        async () => (await fixture.http(`/runs/${runId}`)).value as ManualRunDto,
        (value) => value.state === 'settled_complete' && value.dispatch_state === 'finished',
      )
      await until(
        async () => frames,
        (value) =>
          value.some(
            (frame) => frame.type === 'changed' && frame.sequence === completed.cursor.sequence,
          ),
      )
      assert.equal(completed.confirmed_stock_ids.length, 1)
      await fixture.stopRunner()
      await fixture.stopWeb()
      await setActivation(fixture.gateRoot, false)
      const result = await restoreArchive(
        restored.pool,
        {
          ...config,
          databaseUrl: restored.url,
          schedulerDatabaseUrl: restored.url,
          blobRoot: join(root, 'restored-blobs'),
        },
        ownedPgTools,
      )
      assert.equal(result.status, 'restored-quarantined')
      assert.equal(
        (
          await restored.pool.query(
            "SELECT count(*) FROM information_schema.tables WHERE table_schema='dbos'",
          )
        ).rows[0].count === '0',
        false,
      )
      await assert.rejects(
        startApply({
          databaseUrl: restored.url,
          gateRoot: fixture.gateRoot,
          runId,
          profile: fixture.runnerConfig.profile,
        }),
        /apply_disabled/,
      )
      // Even an explicit fixture-only reactivation cannot erase independent post-backup witnesses.
      await setActivation(fixture.gateRoot, true)
      const authority = await loadRun(restored.pool, runId)
      await assert.rejects(
        new ExternalGate(fixture.gateRoot).check(restored.pool, authority.plan),
        /restore_history_missing/,
      )
      const attempted = await startApply({
        databaseUrl: restored.url,
        gateRoot: fixture.gateRoot,
        runId,
        profile: fixture.runnerConfig.profile,
      })
      await assert.rejects(attempted.completed, /apply_interrupted_inspect_original_run/)
      assert.equal(
        (await fixture.fake.records()).filter(
          (row) => row.method === 'POST' && row.path === '/api/stock/',
        ).length,
        1,
      )
      await setActivation(fixture.gateRoot, false)
    } finally {
      socket?.terminate()
      await restored.dispose()
      await fixture.dispose()
    }
  },
)

test(
  'actual web drains an open socket and quarantines incompatible migrations without leaking configuration',
  { timeout: 30000 },
  async () => {
    const fixture = await manualProcess()
    let socket: WebSocket | undefined
    try {
      await fixture.startWeb()
      socket = new WebSocket(fixture.config.origin.replace('http:', 'ws:') + '/api/v1/live', {
        headers: { origin: fixture.config.origin },
      })
      await once(socket, 'open', { signal: AbortSignal.timeout(5000) })
      const closed = once(socket, 'close', { signal: AbortSignal.timeout(5000) })
      await fixture.stopWeb()
      await closed
      assert.equal(fixture.webChild?.exitCode, 0)
      await fixture.db.pool.query(
        'UPDATE schema_migration SET sha256=$1 WHERE name=(SELECT min(name) FROM schema_migration)',
        ['0'.repeat(64)],
      )
      await assert.rejects(fixture.startWeb(), /manual_web_failed/)
      const errors = fixture.webDiagnostic
      assert.ok(errors.includes('web_startup_refused'))
      assert.equal(errors.includes(fixture.config.apiKey), false)
      assert.equal(errors.includes(fixture.db.url), false)
      assert.equal((await fixture.fake.records()).filter((row) => row.method === 'POST').length, 0)
    } finally {
      socket?.terminate()
      await fixture.dispose()
    }
  },
)
