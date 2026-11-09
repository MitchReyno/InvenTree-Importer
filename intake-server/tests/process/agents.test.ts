import { processingMediaFixture } from '../support/processing-media.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { processingFixture } from '../support/processing.ts'
import { saveAgentSettings } from '../../src/agents/settings.ts'
import { listAgentSessions } from '../../src/agents/session/sessions.ts'
import { nativeProfileId } from '../../src/agents/policy.ts'

for (const provider of ['codex', 'claude'] as const) {
  test(
    `supervised ${provider} worker delivers a real queued command to a controlled CLI, settles and retains model history`,
    { timeout: 45000 },
    async (t) => {
      const fixture = await processingFixture({ profileId: nativeProfileId })
      t.after(() => fixture.dispose())
      const capture = await fixture.seedCapture()
      const media = await processingMediaFixture(fixture, capture.batch.id)
      t.after(() => media.dispose())
      await media.upload(capture.packetA.id, 'Synthetic image for native staging')
      await media.decodeNext()
      const root = await mkdtemp(join(tmpdir(), 'native-worker-test-'))
      const executable = join(root, 'provider.cjs')
      await writeFile(
        executable,
        '#!/usr/bin/env node\n' +
          (await readFile(new URL('../fixtures/native-agent.cjs', import.meta.url), 'utf8')),
        { mode: 0o700 },
      )
      const stateRoot = join(root, 'state')
      await mkdir(stateRoot, { mode: 0o700 })
      const worker = spawn(
        process.execPath,
        [
          '--import',
          'tsx',
          fileURLToPath(new URL('../../src/agents/worker-main.ts', import.meta.url)),
        ],
        {
          cwd: fileURLToPath(new URL('../../', import.meta.url)),
          env: {
            PATH: process.env.PATH,
            HOME: root,
            USER: process.env.USER,
            INTAKE_AGENT_DATABASE_URL: fixture.runner.url,
            INTAKE_AGENT_SCHEDULER_DATABASE_URL: fixture.scheduler.url,
            INTAKE_AGENT_STATE_ROOT: stateRoot,
            INTAKE_BLOB_ROOT: media.root,
            INTAKE_CODEX_EXECUTABLE: executable,
            INTAKE_CLAUDE_EXECUTABLE: executable,
            INTAKE_ACTOR_ID: fixture.config.actorId,
            INTAKE_TARGET_ID: fixture.config.targetId,
            INTAKE_TARGET_CONTEXT_ID: fixture.config.targetContextId,
            INTAKE_PROCESSING_CHANNEL_SECRET: fixture.config.channelSecret,
            INTAKE_PROCESSING_PROFILE: nativeProfileId,
            OPENAI_API_KEY: 'synthetic-only',
            ANTHROPIC_API_KEY: 'synthetic-only',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      let output = ''
      worker.stdout.on('data', (bytes: Buffer) => {
        output += bytes.toString()
      })
      worker.stderr.on('data', (bytes: Buffer) => {
        output += bytes.toString()
      })
      const exited = new Promise<number | null>((resolve) => worker.once('exit', resolve))
      try {
        const deadline = Date.now() + 15000
        while (
          !output.includes('supervisor ready') &&
          worker.exitCode === null &&
          Date.now() < deadline
        ) {
          await delay(50)
        }
        assert.match(output, /supervisor ready/)
        await saveAgentSettings(fixture.api.pool, fixture.config, {
          expected_revision: '0',
          selection: {
            provider,
            authentication: 'api_key',
            model: `controlled-${provider}-model`,
          },
        })
        const started = await fixture.http(`/batches/${capture.batch.id}/processing`, {
          schema_version: 'bench-intake-processing/1',
          expected_capture_revision: capture.batch.revision,
          subject_ids: [capture.packetA.id],
          stages: ['reading'],
        })
        assert.equal(started.status, 202)
        let session = (await listAgentSessions(fixture.api.pool, fixture.config)).sessions[0]
        const finish = Date.now() + 15000
        while (session.state !== 'ready' && Date.now() < finish) {
          await delay(100)
          session = (await listAgentSessions(fixture.api.pool, fixture.config)).sessions[0]
        }
        assert.equal(session.state, 'ready', output)
        assert.equal(session.selection?.model, `controlled-${provider}-model`)
        assert.equal(session.actual_model, `controlled-${provider}-model`)
        assert.ok(session.native_session_id)
        assert.equal(session.progress, 'settled')
        assert.ok(session.finished_at)
        assert.equal(session.occupies_lane, false)
        const current = await fixture.http(`/batches/${capture.batch.id}/processing`)
        assert.equal(
          current.value.jobs[0].proposals[0].value.summary,
          'Controlled source-bound suggestion.',
        )
        assert.equal(current.value.jobs[0].proposals[0].value.sources[0].kind, 'media_version')
        worker.kill('SIGTERM')
        const status = await Promise.race([exited, delay(10000).then(() => 'timeout')])
        assert.equal(status, 0, output)
      } finally {
        if (worker.exitCode === null) {
          worker.kill('SIGKILL')
          await exited
        }
      }
    },
  )
}
