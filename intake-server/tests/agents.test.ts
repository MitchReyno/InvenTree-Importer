import { AgentChild } from '../src/agents/child.ts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { AgentSelectionDto } from '@invimport/contracts'
import { validate } from '@invimport/contracts'
import { agentEnvironment, nativeAgentHost } from '../src/agents/environment.ts'
import { runCodex } from '../src/agents/codex.ts'
import { runClaude } from '../src/agents/claude.ts'
import { decodeNativeResult } from '../src/agents/result.ts'

async function fixture(mode = 'success') {
  const root = await mkdtemp(join(tmpdir(), 'native-agent-test-'))
  await mkdir(join(root, 'codex'), { mode: 0o700 })
  await mkdir(join(root, 'codex-api'), { mode: 0o700 })
  const executable = join(root, 'provider.cjs')
  const code = await readFile(new URL('./fixtures/native-agent.cjs', import.meta.url), 'utf8')
  await writeFile(
    executable,
    '#!/usr/bin/env node\nprocess.argv.splice(2, 0, "--stub-mode", ' +
      JSON.stringify(mode) +
      ');\n' +
      code,
    { mode: 0o700 },
  )
  return nativeAgentHost({
    PATH: process.env.PATH,
    HOME: root,
    USER: process.env.USER,
    INTAKE_AGENT_STATE_ROOT: root,
    INTAKE_CODEX_EXECUTABLE: executable,
    INTAKE_CLAUDE_EXECUTABLE: executable,
    OPENAI_API_KEY: 'synthetic-openai',
    ANTHROPIC_API_KEY: 'synthetic-claude',
  })
}
const prompt = {
  instructions: 'Controlled fixture',
  text: JSON.stringify({
    subject_id: '00000000-0000-4000-8000-000000000001',
    inspected_sources: [
      {
        kind: 'note',
        note_id: '00000000-0000-4000-8000-000000000002',
        text_sha256: 'a'.repeat(64),
      },
    ],
  }),
  images: [],
}

for (const provider of ['codex', 'claude'] as const) {
  for (const authentication of ['api_key', 'subscription'] as const) {
    test(`${provider} ${authentication} passes structured evidence through the controlled CLI and returns only a validated result`, async () => {
      const host = await fixture()
      const selection = { provider, authentication, model: 'test-model' }
      const env = agentEnvironment(host, selection, host.stateRoot)
      const progress: unknown[] = []
      const run = provider === 'codex' ? runCodex : runClaude
      const result = await run(
        host,
        selection,
        prompt,
        host.stateRoot,
        env,
        AbortSignal.timeout(5000),
        async (value) => {
          progress.push(value)
        },
      )
      assert.equal(result.proposal?.summary, 'Controlled source-bound suggestion.')
      assert.equal(progress.length, 1)
    })
  }
  for (const mode of ['tool', 'malformed', 'oversize']) {
    test(`${provider} refuses ${mode} output instead of exposing it as a successful session`, async () => {
      const host = await fixture(mode)
      const selection: AgentSelectionDto = { provider, authentication: 'api_key', model: 'test' }
      const run = provider === 'codex' ? runCodex : runClaude
      await assert.rejects(
        run(
          host,
          selection,
          prompt,
          host.stateRoot,
          agentEnvironment(host, selection, host.stateRoot),
          AbortSignal.timeout(3000),
          async () => {},
        ),
      )
    })
  }
  test(`${provider} cancellation reaps a CLI that ignores SIGTERM`, async () => {
    const host = await fixture('hang')
    const selection: AgentSelectionDto = { provider, authentication: 'api_key', model: 'test' }
    const run = provider === 'codex' ? runCodex : runClaude
    const controller = new AbortController()
    const pending = run(
      host,
      selection,
      prompt,
      host.stateRoot,
      agentEnvironment(host, selection, host.stateRoot),
      AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]),
      async () => {},
    )
    const rejection = assert.rejects(pending)
    let pid: number | undefined
    const deadline = Date.now() + 3000
    while (!pid && Date.now() < deadline) {
      try {
        pid = Number(await readFile(join(host.stateRoot, 'stub-hang-ready'), 'utf8'))
      } catch {
        await delay(10)
      }
    }
    assert.ok(pid, 'fixture reached its SIGTERM-resistant inference stand-in')
    controller.abort()
    await rejection
    assert.throws(() => process.kill(pid!, 0), { code: 'ESRCH' })
  })
}

test('authentication environment never inherits an application key, provider token, proxy or alternate endpoint', async () => {
  const host = await fixture()
  host.env.INTAKE_DEV_API_KEY = 'synthetic-inventory'
  host.env.ANTHROPIC_AUTH_TOKEN = 'synthetic-token'
  host.env.CLAUDE_CODE_OAUTH_TOKEN = 'synthetic-oauth'
  host.env.HTTPS_PROXY = 'http://untrusted.invalid'
  host.env.OPENAI_BASE_URL = 'http://untrusted.invalid'
  for (const provider of ['codex', 'claude'] as const) {
    const subscription = agentEnvironment(
      host,
      { provider, authentication: 'subscription', model: 'test' },
      host.stateRoot,
    )
    assert.equal(subscription.OPENAI_API_KEY, undefined)
    assert.equal(subscription.ANTHROPIC_API_KEY, undefined)
    for (const name of [
      'INTAKE_DEV_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'CLAUDE_CODE_OAUTH_TOKEN',
      'HTTPS_PROXY',
      'OPENAI_BASE_URL',
    ]) {
      assert.equal(subscription[name], undefined)
    }
  }
})

test('settings contracts and structured outcomes refuse credentials, missing models and ambiguous results', () => {
  validate('AgentSettings', { revision: '0', selection: null })
  assert.throws(() =>
    validate('AgentSettingsUpdate', {
      expected_revision: '0',
      selection: { provider: 'claude', authentication: 'subscription', model: '' },
    }),
  )
  assert.throws(() =>
    validate('AgentSelection', {
      provider: 'claude',
      authentication: 'subscription',
      model: 'sonnet',
      api_key: 'private',
    }),
  )
  assert.throws(() => decodeNativeResult({ proposal: null, question: null }))
})

test('cancellation interrupts a backpressured stdin write and reaps before returning', async () => {
  const host = await fixture('no-read')
  const controller = new AbortController()
  const child = new AgentChild(
    host.claudeExecutable,
    [],
    host.stateRoot,
    agentEnvironment(
      host,
      { provider: 'claude', authentication: 'api_key', model: 'test' },
      host.stateRoot,
    ),
    controller.signal,
  )
  const writing = assert.rejects(child.send({ text: 'x'.repeat(2 * 1024 * 1024) }))
  await delay(200)
  controller.abort()
  await writing
  await child.close()
})

test('Codex refuses an unexpected tool when it starts, before any completed-tool output', async () => {
  const host = await fixture('started_tool')
  const selection: AgentSelectionDto = {
    provider: 'codex',
    authentication: 'api_key',
    model: 'test',
  }
  await assert.rejects(
    runCodex(
      host,
      selection,
      prompt,
      host.stateRoot,
      agentEnvironment(host, selection, host.stateRoot),
      AbortSignal.timeout(3000),
      async () => {},
    ),
    { message: 'agent_tool_refused' },
  )
})
