import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSelectionDto } from '@invimport/contracts'
import {
  runClaudeSession,
  runCodexSession,
  type SessionTurn,
} from '#/agents/session/session-adapters.ts'

const TOOLS = ['ask', 'fetch_evidence', 'propose', 'read_inbox', 'reply', 'status']

/** The fake CLI, a stub app tool endpoint and a private session directory for one adapter. */
async function harness(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'session-effort-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const executable = join(root, 'provider.cjs')
  const source = await readFile(new URL('./fixtures/session-agent.cjs', import.meta.url), 'utf8')
  await writeFile(executable, '#!/usr/bin/env node\n' + source)
  await chmod(executable, 0o755)
  // Every app tool call succeeds with nothing to report.
  const tools = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      const { id } = JSON.parse(body) as { id: number }
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({ jsonrpc: '2.0', id, result: { structuredContent: { ok: true } } }),
      )
    })
  })
  tools.listen(0, '127.0.0.1')
  await once(tools, 'listening')
  t.after(() => tools.close())
  const cwd = join(root, 'session')
  await mkdir(cwd, { mode: 0o700 })
  const log = join(root, 'events')
  const codexHome = join(root, 'codex-home')
  await mkdir(codexHome, { mode: 0o700 })
  return {
    cwd,
    host: { claudeExecutable: executable, codexExecutable: executable, stateRoot: root, env: {} },
    env: { PATH: process.env.PATH, CODEX_HOME: codexHome, OPENAI_API_KEY: 'test-key' },
    toolUrl: `http://127.0.0.1:${(tools.address() as AddressInfo).port}/mcp`,
    useMode: (mode: string) =>
      writeFile(join(cwd, 'fake-session.json'), JSON.stringify({ mode, log, tools: TOOLS })),
    events: async () =>
      (await readFile(log, 'utf8').catch(() => ''))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

type Harness = Awaited<ReturnType<typeof harness>>

/** A turn that records what the adapter reported; `deliver` hands it one operator item. */
function sessionTurn(
  h: Harness,
  { resume, deliver = false }: { resume?: string; deliver?: boolean } = {},
) {
  const reported = { started: [] as string[], efforts: [] as string[], order: [] as string[] }
  let pending = deliver
  const turn: SessionTurn = {
    instructions: 'Follow the app rules.',
    text: 'Opening text',
    resume,
    toolUrl: h.toolUrl,
    capability: 'test-capability',
    tools: TOOLS,
    nextDelivery: async () => {
      if (!pending) {
        return undefined
      }
      pending = false
      return { text: 'Operator item, sequence 1', seq: 1n }
    },
    onDelivered: () => {},
    onStarted: async ({ providerSessionId }) => {
      reported.started.push(providerSessionId)
      reported.order.push('started')
    },
    onEffortSent: async (effort) => {
      reported.efforts.push(effort)
      reported.order.push('effort')
    },
  }
  return { turn, reported }
}

const claude = (effort?: string): AgentSelectionDto => ({
  provider: 'claude',
  authentication: 'subscription',
  model: 'claude-opus-5-5',
  ...(effort ? { effort } : {}),
})
const codex = (effort?: string): AgentSelectionDto => ({
  provider: 'codex',
  authentication: 'api_key',
  model: 'gpt-6.2-sol',
  ...(effort ? { effort } : {}),
})

const signal = () => AbortSignal.timeout(20_000)

test('a Claude turn passes the sealed effort on fresh and resumed turns, and reports it', async (t) => {
  const h = await harness(t)
  await h.useMode('normal')
  const fresh = sessionTurn(h)
  await runClaudeSession(h.host, claude('high'), fresh.turn, h.cwd, h.env, signal())
  const resumed = sessionTurn(h, { resume: fresh.reported.started[0] })
  await runClaudeSession(h.host, claude('high'), resumed.turn, h.cwd, h.env, signal())
  const args = (await h.events()).filter((event) => event.event === 'claude-args')
  assert.deepEqual(args, [
    { event: 'claude-args', model: 'claude-opus-5-5', effort: 'high' },
    {
      event: 'claude-args',
      model: 'claude-opus-5-5',
      effort: 'high',
      resume: fresh.reported.started[0],
    },
  ])
  assert.deepEqual(fresh.reported.efforts, ['high'])
  assert.deepEqual(resumed.reported.efforts, ['high'])
})

test('a Claude turn on Default passes no effort and reports none', async (t) => {
  const h = await harness(t)
  await h.useMode('normal')
  const fresh = sessionTurn(h)
  await runClaudeSession(h.host, claude(), fresh.turn, h.cwd, h.env, signal())
  const resumed = sessionTurn(h, { resume: fresh.reported.started[0] })
  await runClaudeSession(h.host, claude(), resumed.turn, h.cwd, h.env, signal())
  const args = (await h.events()).filter((event) => event.event === 'claude-args')
  assert.equal(args.length, 2)
  assert.ok(args.every((event) => !('effort' in event)))
  assert.deepEqual([...fresh.reported.efforts, ...resumed.reported.efforts], [])
})

test('every Codex turn/start carries the sealed effort, and neither thread/start nor turn/steer does', async (t) => {
  const h = await harness(t)
  await h.useMode('deliver')
  const fresh = sessionTurn(h, { deliver: true })
  await runCodexSession(h.host, codex('xhigh'), fresh.turn, h.cwd, h.env, signal())
  await h.useMode('normal')
  const resumed = sessionTurn(h, { resume: fresh.reported.started[0] })
  await runCodexSession(h.host, codex('xhigh'), resumed.turn, h.cwd, h.env, signal())
  const events = await h.events()
  const starts = events.filter((event) => event.event === 'turn-start')
  assert.equal(starts.length, 2)
  assert.ok(starts.every((event) => event.effort === 'xhigh'))
  const threadStart = events.find((event) => event.event === 'thread-start')
  assert.ok(threadStart && !(threadStart.keys as string[]).includes('effort'))
  const steer = events.find((event) => event.event === 'steer')
  assert.ok(steer, JSON.stringify(events))
  assert.ok(!(steer.keys as string[]).includes('effort'))
  assert.ok(events.some((event) => event.event === 'resume'))
  // Reported once per turn, after the start it follows.
  assert.deepEqual(fresh.reported.order, ['started', 'effort'])
  assert.deepEqual(resumed.reported.efforts, ['xhigh'])
})

test('a Codex turn on Default sends no effort field and reports none', async (t) => {
  const h = await harness(t)
  await h.useMode('normal')
  const fresh = sessionTurn(h)
  await runCodexSession(h.host, codex(), fresh.turn, h.cwd, h.env, signal())
  const resumed = sessionTurn(h, { resume: fresh.reported.started[0] })
  await runCodexSession(h.host, codex(), resumed.turn, h.cwd, h.env, signal())
  const starts = (await h.events()).filter((event) => event.event === 'turn-start')
  assert.equal(starts.length, 2)
  assert.ok(starts.every((event) => !(event.keys as string[]).includes('effort')))
  assert.deepEqual([...fresh.reported.efforts, ...resumed.reported.efforts], [])
})

test('a Codex turn that fails after its start is reported never sends turn/start or reports an effort', async (t) => {
  const h = await harness(t)
  await h.useMode('normal')
  const { turn, reported } = sessionTurn(h)
  turn.onStarted = async () => {
    reported.order.push('started')
    throw new Error('start_not_recorded')
  }
  await assert.rejects(
    runCodexSession(h.host, codex('high'), turn, h.cwd, h.env, signal()),
    /start_not_recorded/,
  )
  assert.ok(!(await h.events()).some((event) => event.event === 'turn-start'))
  assert.deepEqual(reported.order, ['started'])
})
