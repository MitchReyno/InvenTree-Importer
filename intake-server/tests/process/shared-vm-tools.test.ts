import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { startSessionToolServer } from '../../src/agents/tools/server.ts'
import { runSessionTurn, type SessionDriver } from '../../src/agents/session/session-runner.ts'
import { startSessionBridge } from '../../src/agents/shared-vm/coordinator.ts'

// The caller stages a fresh synthetic picture and supplies its answer only to the assertion.
for (const provider of ['claude', 'codex'] as const) {
  test(
    'shared VM built-ins through the paired ' + provider + ' subscription',
    {
      skip: process.env.INTAKE_TEST_TOOL_PROVIDER !== provider,
      timeout: 220000,
    },
    async (t) => {
      const fixtureName = process.env.INTAKE_TEST_TOOL_CASE
      assert.match(fixtureName ?? '', /^qualification\.[a-zA-Z0-9]{8}$/)
      const folder = '/home/node/sessions/' + fixtureName
      const marker = process.env.INTAKE_TEST_IMAGE_WORD
      assert.match(marker ?? '', /^[A-Z]{5}$/)
      const fixture = await processingFixture({ profileId: 'shared-vm-agent/2' })
      t.after(() => fixture.dispose())
      const stateRoot = await mkdtemp(join(tmpdir(), 'bench-tool-test-'))
      t.after(() => rm(stateRoot, { recursive: true, force: true }))
      const server = await startSessionToolServer({
        pool: fixture.runner.pool,
        config: fixture.config,
        statusIntervalMs: 0,
      })
      t.after(() => server.close())
      const bridge = await startSessionBridge(
        process.env.INTAKE_VM_PAIR!,
        Number(process.env.INTAKE_VM_PORT),
      )
      t.after(() => bridge.close())
      const capture = await fixture.seedCapture()
      const { attempt } = await lotSession(fixture, capture, capture.packetA, {
        state: 'queued',
        profile: {
          id: 'shared-vm-agent/2',
          agent: {
            provider,
            authentication: 'subscription',
            model: provider === 'claude' ? 'haiku' : 'gpt-6.1-sol',
          },
          settingsRevision: '1',
        },
      })
      const driver: SessionDriver = (turn, context) =>
        bridge.driver(
          {
            ...turn,
            text: `Run this synthetic workspace qualification. For Codex use functions.exec with image((await tools.view_image({path: imagePath})).image_url) and text(await tools.exec_command({cmd: command})). For Claude use Read, Write and Bash. The paths below are inside this guest. Inspect ${folder}/image.png visually with your built-in image reader and read its five capital letters. Write ${folder}/qualification.py and execute this Python script which fetches https://www.rfc-editor.org/rfc/rfc9110.txt via bench-web, saves it to ${folder}/rfc.txt, reads it back and extracts its ISSN. Use the intake status tool to record exactly: image=<letters> issn=<value>. Then stop.`,
          },
          context,
        )
      const result = await runSessionTurn(
        {
          pool: fixture.runner.pool,
          config: fixture.config,
          host: { stateRoot, env: {}, claudeExecutable: '/unused', codexExecutable: '/unused' },
          toolUrl: server.url,
          drivers: { 'shared-vm-agent/2': driver },
        },
        attempt,
        AbortSignal.timeout(190000),
      )
      assert.equal(result, 'finished')
      const messages = await fixture.db.pool.query(
        "SELECT payload::text AS text FROM agent_session_outbox WHERE kind='status' AND session_id=$1",
        [attempt],
      )
      assert.ok(
        messages.rows.some((row) => row.text.includes('image=' + marker + ' issn=2070-1721')),
      )
    },
  )
}
