import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { processingFixture } from '../support/processing.ts'
import { saveAgentSettings } from '../../src/agents/settings.ts'

for (const provider of ['claude', 'codex'] as const) {
  test(
    'paired guest runs a sealed ' + provider + ' session through Processing',
    {
      skip: !process.env.INTAKE_VM_PAIR,
      timeout: 120000,
    },
    async (t) => {
      const fixture = await processingFixture({ profileId: 'shared-vm-agent/1' })
      const stateRoot = await mkdtemp(join(tmpdir(), 'bench-paired-worker-'))
      t.after(async () => {
        await fixture.dispose()
        await rm(stateRoot, { recursive: true, force: true })
      })
      const capture = await fixture.seedCapture()
      await saveAgentSettings(fixture.api.pool, fixture.config, {
        expected_revision: '0',
        selection: { provider, authentication: 'api_key', model: 'fake-' + provider + '-model' },
        session_concurrency: 1,
      })
      const worker = spawn(
        process.execPath,
        ['--import', 'tsx', 'src/agents/session-worker-main.ts'],
        {
          env: {
            PATH: process.env.PATH,
            HOME: stateRoot,
            USER: process.env.USER,
            INTAKE_VM_PAIR: process.env.INTAKE_VM_PAIR,
            INTAKE_VM_PORT: process.env.INTAKE_VM_PORT,
            INTAKE_AGENT_DATABASE_URL: fixture.runner.url,
            INTAKE_AGENT_SCHEDULER_DATABASE_URL: fixture.scheduler.url,
            INTAKE_AGENT_STATE_ROOT: stateRoot,
            INTAKE_ACTOR_ID: fixture.config.actorId,
            INTAKE_TARGET_ID: fixture.config.targetId,
            INTAKE_TARGET_CONTEXT_ID: fixture.config.targetContextId,
            INTAKE_PROCESSING_CHANNEL_SECRET: fixture.config.channelSecret,
            INTAKE_PROCESSING_PROFILE: 'shared-vm-agent/1',
            INTAKE_CLAUDE_EXECUTABLE: '/host-provider-must-never-run',
            INTAKE_CODEX_EXECUTABLE: '/host-provider-must-never-run',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      const exited = once(worker, 'exit')
      let logs = ''
      worker.stdout.on('data', (b) => (logs += b.toString()))
      worker.stderr.on('data', (b) => (logs += b.toString()))
      try {
        const start = await fixture.http('/batches/' + capture.batch.id + '/processing', {
          schema_version: 'bench-intake-processing/1',
          expected_capture_revision: capture.batch.revision,
          subject_ids: [capture.packetA.id],
          stages: ['research'],
        })
        assert.equal(start.status, 202, JSON.stringify(start.value))
        const deadline = Date.now() + 60000
        let state
        while (Date.now() < deadline && worker.exitCode === null) {
          const result = await fixture.db.pool.query(
            'SELECT session_state,native_session_id FROM agent_session',
          )
          state = result.rows[0]
          if (state && !['running', 'queued'].includes(state.session_state)) break
          await delay(200)
        }
        assert.equal(
          state?.session_state,
          'finished',
          JSON.stringify(state) + ' ' + logs.slice(-1000),
        )
        assert.ok(state.native_session_id)
        const status = await fixture.db.pool.query(
          "SELECT 1 FROM agent_session_outbox WHERE kind='status'",
        )
        assert.equal(status.rowCount, 1)
      } finally {
        worker.kill('SIGTERM')
        await exited
      }
    },
  )
}
