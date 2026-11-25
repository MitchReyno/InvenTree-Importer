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
