import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AgentChild } from '#/agents/child.ts'
import {
  CLAUDE_CATALOG_ARGS,
  readClaudeCliModels,
  readCodexCliModels,
} from '#/agents/model-catalog/cli-readers.ts'
import { CatalogReadError, claudeCliModels, codexModels } from '#/agents/model-catalog/normalise.ts'
import { hostClaudeApiReader, hostCodexApiReader } from '#/agents/model-catalog/readers.ts'
import { nativeAgentHost } from '#/agents/environment.ts'
import { NativeSessionError } from '#/agents/failure-model.ts'

const fakeCli = resolve(import.meta.dirname, 'fixtures/model-catalog-cli.cjs')

async function frames(log: string) {
  return (await readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

test('no catalogue read writes anything but its catalogue requests', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-cli-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const log = join(root, 'cli.log')
  const env = { PATH: process.env.PATH, MODEL_CATALOG_LOG: log }

  const claude = await readClaudeCliModels(fakeCli, root, env, AbortSignal.timeout(10_000))
  assert.equal(claude.cliVersion, '2.1.319')
  assert.equal(claudeCliModels(claude.raw).length, 13)
  const codex = await readCodexCliModels(
    () => new AgentChild(fakeCli, ['app-server'], root, env, AbortSignal.timeout(10_000)),
  )
  assert.equal(codex.cliVersion, '0.166.0')
  assert.equal(codexModels(codex.raw as unknown[]).length, 10)

  const seen = await frames(log)
  const claudeArgs = seen.find((frame) => frame.started === 'claude')?.args
  assert.deepEqual(claudeArgs, CLAUDE_CATALOG_ARGS)
  const received = seen.filter((frame) => 'received' in frame).map((frame) => frame.received)
  assert.deepEqual(
    received.map((message) => {
      const value = message as { type?: string; method?: string; request?: { subtype?: string } }
      return value.method ?? `${value.type}:${value.request?.subtype}`
    }),
    ['control_request:initialize', 'initialize', 'initialized', 'model/list'],
  )
})

test('a CLI that never answers is stopped and reaped when the read is abandoned', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-cli-hang-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const log = join(root, 'cli.log')
  const env = { PATH: process.env.PATH, MODEL_CATALOG_LOG: log, MODEL_CATALOG_MODE: 'hang' }
  await assert.rejects(
    readClaudeCliModels(fakeCli, root, env, AbortSignal.timeout(500)),
    (error) => error instanceof CatalogReadError && error.code === 'timeout',
  )
  const pid = (await frames(log)).find((frame) => 'started' in frame)?.pid as number
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})

test('an oversized models API reply is refused while it streams, and its body cancelled', async () => {
  let pulled = 0
  let cancelled = false
  const chunk = new Uint8Array(64 * 1024).fill(0x20)
  const fetcher: typeof fetch = async () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled++
          controller.enqueue(chunk)
        },
        cancel() {
          cancelled = true
        },
      }),
      { status: 200 },
    )
  const reader = hostClaudeApiReader('secret', () => 'sk-ant-api-key', fetcher)
  await assert.rejects(
    reader.read(AbortSignal.timeout(10_000)),
    (error) => error instanceof CatalogReadError && error.code === 'malformed',
  )
  assert.ok(cancelled)
  // About 1 MiB was read: 17 chunks of 64 KiB, not the endless stream.
  assert.ok(pulled <= 20, `pulled ${pulled}`)
})

test('a host OpenAI key gone from the environment reads as signed out', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-codex-gone-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const host = nativeAgentHost({
    INTAKE_AGENT_STATE_ROOT: join(root, 'state'),
    INTAKE_CODEX_EXECUTABLE: fakeCli,
    PATH: process.env.PATH,
    HOME: root,
  })
  // The key source still had a key when the read began; the environment a CLI gets has none.
  const reader = hostCodexApiReader(
    host,
    'secret',
    () => 'sk-openai-key',
    async () => {
      throw new Error('no models API call is expected')
    },
  )
  await assert.rejects(
    reader.read(AbortSignal.timeout(10_000)),
    (error) => error instanceof CatalogReadError && error.code === 'signed_out',
  )
})

test('an environment failure other than a missing key is not read as signed out', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'catalog-codex-env-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const host = nativeAgentHost({
    INTAKE_AGENT_STATE_ROOT: join(root, 'state'),
    PATH: process.env.PATH,
  })
  // A typed error with another code, whose message alone would pass for a missing key.
  const boom = new NativeSessionError('agent_home_unavailable')
  Object.defineProperty(boom, 'message', { value: 'agent_login_required' })
  host.env = new Proxy(host.env, {
    get(target, name) {
      if (name === 'OPENAI_API_KEY') {
        throw boom
      }
      return Reflect.get(target, name) as unknown
    },
  })
  const reader = hostCodexApiReader(host, 'secret', () => 'sk-openai-key')
  await assert.rejects(reader.read(AbortSignal.timeout(10_000)), (error) => error === boom)
})
