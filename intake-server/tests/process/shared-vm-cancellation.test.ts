import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { runSessionTurn, type SessionDriver } from '#/agents/session/session-runner.ts'
import { saveAgentSettings } from '#/agents/settings.ts'
import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'

test(
  'VM cancellation confirms browser worker removal while its sibling remains live',
  {
    skip: process.env.INTAKE_TEST_VM_LIFECYCLE !== 'controlled',
    timeout: 180000,
  },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'vm-lifecycle-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const fixture = await processingFixture({ profileId: 'shared-vm-agent/2' })
    t.after(() => fixture.dispose())
    const selection = {
      provider: 'claude',
      authentication: 'subscription',
      model: 'haiku',
    } as const
    await saveAgentSettings(fixture.api.pool, fixture.config, {
      selection,
      expected_revision: '0',
      session_concurrency: 2,
    })
    const bridge = await startSessionBridge(
      process.env.INTAKE_VM_PAIR!,
      Number(process.env.INTAKE_VM_PORT),
    )
    t.after(() => bridge.close())
    const capture = await fixture.seedCapture()
    const options = {
      state: 'queued',
      profile: { id: 'shared-vm-agent/2', agent: selection, settingsRevision: '1' },
    } as const
    const first = await lotSession(fixture, capture, capture.packetA, options)
    const second = await lotSession(fixture, capture, capture.packetB, options)
    let finishSibling = false
    const driver: SessionDriver = (turn, context) =>
      bridge.driver(
        {
          ...turn,
          text:
            context.identity.attemptId === first.attempt
              ? 'lifecycle-browser'
              : 'lifecycle-sibling',
          nextDelivery: async () =>
            finishSibling ? { text: 'finish sibling', seq: 1n } : undefined,
        },
        context,
      )
    const deps = {
      pool: fixture.runner.pool,
      config: fixture.config,
      host: { stateRoot: root, env: {}, claudeExecutable: '/unused', codexExecutable: '/unused' },
      toolUrl: 'http://127.0.0.1:1',
      drivers: { 'shared-vm-agent/2': driver },
    }
    const control = new AbortController()
    const cancelled = runSessionTurn(deps, first.attempt, control.signal)
    const sibling = runSessionTurn(deps, second.attempt, control.signal)
    const settled = Promise.allSettled([cancelled, sibling])
    t.after(async () => {
      control.abort()
      finishSibling = true
      await settled
    })
    const state = async () =>
      (
        await fixture.db.pool.query(
          'SELECT attempt_id,session_state,native_session_id,capability_sha256 IS NOT NULL AS capable FROM agent_session WHERE attempt_id=ANY($1::uuid[])',
          [[first.attempt, second.attempt]],
        )
      ).rows
    let rows = await state()
    const deadline = Date.now() + 65000
    while (rows.filter((r) => r.native_session_id).length !== 2 && Date.now() < deadline) {
      await delay(150)
      rows = await state()
    }
    assert.equal(rows.filter((r) => r.native_session_id).length, 2, JSON.stringify(rows))
    const job = await fixture.db.pool.query(
      'SELECT revision::text FROM processing_job WHERE id=$1',
      [first.job],
    )
    const response = await fixture.http(
      '/batches/' + capture.batch.id + '/processing/' + first.job + '/cancellation',
      { expected_revision: job.rows[0].revision, attempt_id: first.attempt },
    )
    assert.equal(response.status, 200, JSON.stringify(response.value))
    assert.equal(await cancelled, 'cancelled')
    rows = await state()
    assert.equal(rows.find((r) => r.attempt_id === first.attempt)?.capable, false)
    assert.equal(rows.find((r) => r.attempt_id === second.attempt)?.session_state, 'running')
    assert.equal(rows.find((r) => r.attempt_id === second.attempt)?.capable, true)
    finishSibling = true
    assert.equal(await sibling, 'finished')
  },
)
