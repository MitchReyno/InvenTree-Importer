import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { BUILT_IN_MODEL_CATALOG, type AgentCatalogModelDto } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { singleProvider } from '../support/agent-settings.ts'
import { saveAgentSettings } from '#/agents/settings.ts'
import { readModelCatalog, refreshModelCatalog } from '#/agents/model-catalog/api.ts'
import { CatalogReadError } from '#/agents/model-catalog/normalise.ts'
import {
  apiKeyGeneration,
  guestReader,
  hostClaudeApiReader,
  hostClaudeSubscriptionReader,
  hostCodexApiReader,
  type CatalogReader,
  type CatalogRead,
} from '#/agents/model-catalog/readers.ts'
import { modelCatalogWorker, type CatalogProviderSetting } from '#/agents/model-catalog/worker.ts'
import {
  CATALOG_MAX_AGE_MS,
  CATALOG_RETRY_MS,
  readCatalogRows,
} from '#/agents/model-catalog/store.ts'
import { nativeAgentHost } from '#/agents/environment.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

const fakeCli = resolve(import.meta.dirname, '../fixtures/model-catalog-cli.cjs')

const opus: AgentCatalogModelDto = {
  id: 'claude-opus-5-5',
  name: 'Opus 5.5',
  older: false,
  default: true,
  efforts: ['low', 'high'],
  default_effort: null,
  usable: null,
}
const sonnet: AgentCatalogModelDto = {
  ...opus,
  id: 'claude-sonnet-5-5',
  name: 'Sonnet 5.5',
  default: false,
}

/** A clock the test moves by hand. */
function clock(start = '2026-11-25T22:12:00.000Z') {
  let time = new Date(start).getTime()
  return {
    now: () => new Date(time),
    advance(ms: number) {
      time += ms
    },
  }
}

/**
 * A guest-like fenced reader: `generation` is the sign-in now, `answers` the reads to give in
 * order (a model list under a generation, a failure, or a promise the test settles).
 */
function fakeReader(start: string, readIn: CatalogReader['readIn'] = 'vm') {
  const state = {
    generation: start,
    reads: 0,
    generationReads: 0,
    answers: [] as (CatalogRead | CatalogReadError | Promise<CatalogRead>)[],
    /** Answers for the next generation checks, before falling back to `generation`. */
    generations: [] as (string | CatalogReadError)[],
  }
  const reader: CatalogReader = {
    readIn,
    source: 'cli',
    fenced: true,
    async read() {
      state.reads++
      const answer = state.answers.shift() ?? {
        generation: state.generation,
        cliVersion: '2.1.319',
        models: [opus],
      }
      if (answer instanceof CatalogReadError) {
        throw answer
      }
      return answer
    },
    async generation() {
      state.generationReads++
      const queued = state.generations.shift()
      if (queued instanceof CatalogReadError) {
        throw queued
      }
      return queued ?? state.generation
    },
  }
  return { state, reader }
}

async function claudeOnly(
  fixture: Fixture,
  authentication: 'subscription' | 'api_key' = 'subscription',
) {
  await saveAgentSettings(
    fixture.api.pool,
    fixture.config,
    singleProvider({
      expected_revision: '0',
      selection: { provider: 'claude', authentication, model: 'claude-opus-5-5' },
    }),
  )
}

function worker(
  fixture: Fixture,
  reader: (key: { provider: string; authentication: string }) => CatalogReader | undefined,
  time = clock(),
  providers?: CatalogProviderSetting[],
) {
  return modelCatalogWorker({
    pool: fixture.runner.pool,
    scope: fixture.config,
    reader,
    now: time.now,
    providers: async () =>
      providers ?? [
        { provider: 'claude', authentication: 'subscription', enabled: true },
        { provider: 'codex', authentication: 'subscription', enabled: false },
      ],
  })
}

/** Waits until the fake reader has been asked for its `count`th read. */
async function readStarted(state: { reads: number }, count: number) {
  for (let i = 0; i < 250 && state.reads < count; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal(state.reads, count)
}

async function round(catalog: ReturnType<typeof modelCatalogWorker>) {
  await catalog.pass()
  await catalog.idle()
}

async function claudeRow(fixture: Fixture, authentication = 'subscription') {
  const rows = await readCatalogRows(fixture.db.pool, fixture.config)
  return rows.find((row) => row.provider === 'claude' && row.authentication === authentication)
}

test('a good read is stored with its time, CLI version and sign-in generation', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const time = clock()
  const { state, reader } = fakeReader('rev-a')
  const catalog = worker(fixture, (key) => (key.provider === 'claude' ? reader : undefined), time)
  t.after(() => catalog.close())

  // Before any read, the API answers the built-in list.
  const before = await readModelCatalog(fixture.api.pool, fixture.config)
  assert.equal(before.claude.state, 'never_read')
  assert.equal(before.claude.builtin, true)
  assert.deepEqual(before.claude.models, [...BUILT_IN_MODEL_CATALOG.claude])

  await round(catalog)
  assert.equal(state.reads, 1)
  const row = await claudeRow(fixture)
  assert.deepEqual(row?.models, [opus])
  assert.equal(row?.cliVersion, '2.1.319')
  assert.equal(row?.signInGeneration, 'rev-a')
  assert.equal(row?.readAt?.toISOString(), '2026-11-25T22:12:00.000Z')
  const answer = await readModelCatalog(fixture.api.pool, fixture.config)
  assert.deepEqual(answer.claude, {
    state: 'current',
    authentication: 'subscription',
    source: 'cli',
    read_in: 'vm',
    cli_version: '2.1.319',
    read_at: '2026-11-25T22:12:00.000Z',
    attempted_at: '2026-11-25T22:12:00.000Z',
    failure: null,
    builtin: false,
    models: [opus],
  })
  // A disabled provider isn't read, and keeps the built-in list.
  assert.equal(answer.codex.state, 'never_read')

  // Not due again until 12 hours after the read.
  time.advance(CATALOG_MAX_AGE_MS - 1)
  await round(catalog)
  assert.equal(state.reads, 1)
  time.advance(1)
  await round(catalog)
  assert.equal(state.reads, 2)
})

test('a failed read keeps the last list and records a fixed code; it is retried after 5 minutes', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const time = clock()
  const { state, reader } = fakeReader('rev-a')
  const catalog = worker(fixture, () => reader, time)
  t.after(() => catalog.close())
  await round(catalog)

  time.advance(CATALOG_MAX_AGE_MS)
  state.answers.push(new CatalogReadError('timeout'))
  await round(catalog)
  const failed = await readModelCatalog(fixture.api.pool, fixture.config)
  assert.equal(failed.claude.state, 'failed')
  assert.equal(failed.claude.failure, 'timeout')
  assert.deepEqual(failed.claude.models, [opus])
  assert.equal(failed.claude.read_at, '2026-11-25T22:12:00.000Z')
  assert.notEqual(failed.claude.attempted_at, failed.claude.read_at)

  time.advance(CATALOG_RETRY_MS - 1)
  await round(catalog)
  assert.equal(state.reads, 2)
  time.advance(1)
  await round(catalog)
  assert.equal(state.reads, 3)
  assert.equal((await readModelCatalog(fixture.api.pool, fixture.config)).claude.state, 'current')
})

test("the guest CLI's offline alias list fails the read and keeps the stored list", async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const recorded = (name: string) =>
    (
      JSON.parse(
        readFileSync(new URL(`../fixtures/model-catalog/${name}`, import.meta.url), 'utf8'),
      ) as { models: unknown }
    ).models
  let raw = recorded('claude-initialize-2.1.319.json')
  const reader = guestReader(async (_provider, kind) => {
    if (kind === 'generation') {
      return { kind: 'generation', generation: 'rev-a' }
    }
    return { kind: 'read', read: { generation: 'rev-a', cliVersion: '2.1.319', raw } }
  }, 'claude')
  const time = clock()
  const catalog = worker(fixture, () => reader, time)
  t.after(() => catalog.close())
  await round(catalog)
  assert.equal((await claudeRow(fixture))?.models?.length, 13)

  // The guest's egress failed: the CLI answers its built-in aliases, none by exact ID.
  raw = recorded('claude-initialize-offline-2.1.319.json')
  time.advance(CATALOG_MAX_AGE_MS)
  await round(catalog)
  const answer = await readModelCatalog(fixture.api.pool, fixture.config)
  assert.equal(answer.claude.state, 'failed')
  assert.equal(answer.claude.failure, 'unavailable')
  assert.equal(answer.claude.models.length, 13)
  assert.equal(answer.claude.read_at, '2026-11-25T22:12:00.000Z')
})

test('the API may only read the table and request a refresh, which can invalidate at once', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const { reader } = fakeReader('rev-a')
  const catalog = worker(fixture, () => reader)
  t.after(() => catalog.close())
  await round(catalog)

  const receipt = await refreshModelCatalog(fixture.api.pool, fixture.config, {
    provider: 'claude',
    invalidate: true,
  })
  assert.deepEqual(receipt, {
    provider: 'claude',
    authentication: 'subscription',
    stale_sign_in: true,
  })
  const marked = await fixture.db.pool.query(
    'SELECT stale_sign_in, invalidation_seq, refresh_requested_at FROM agent_model_catalog WHERE provider=$1',
    ['claude'],
  )
  assert.equal(marked.rows[0].stale_sign_in, true)
  assert.equal(marked.rows[0].invalidation_seq, '1')
  assert.ok(marked.rows[0].refresh_requested_at)
  const stale = await readModelCatalog(fixture.api.pool, fixture.config)
  assert.equal(stale.claude.state, 'stale_sign_in')
  assert.deepEqual(stale.claude.models, [opus])

  const refused = [
    `UPDATE agent_model_catalog SET stale_sign_in=false`,
    `UPDATE agent_model_catalog SET models='[]'::jsonb`,
    `DELETE FROM agent_model_catalog`,
    `INSERT INTO agent_model_catalog (actor_id,target_id,target_context_id,provider,authentication)
      VALUES ('${fixture.config.actorId}','${fixture.config.targetId}','${fixture.config.targetContextId}','codex','api_key')`,
  ]
  for (const statement of refused) {
    await assert.rejects(fixture.api.pool.query(statement), { code: '42501' }, statement)
  }
  // The runner, which writes the table, can't call the API's function.
  await assert.rejects(
    fixture.runner.pool.query('SELECT request_model_catalog_refresh($1,$2,$3,$4,$5,$6)', [
      fixture.config.actorId,
      fixture.config.targetId,
      fixture.config.targetContextId,
      'claude',
      'subscription',
      true,
    ]),
    { code: '42501' },
  )
})

test('a refresh request is read and cleared, and one made during the read stays', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const { state, reader } = fakeReader('rev-a')
  const catalog = worker(fixture, () => reader)
  t.after(() => catalog.close())
  await round(catalog)

  await refreshModelCatalog(fixture.api.pool, fixture.config, { provider: 'claude' })
  assert.equal((await readModelCatalog(fixture.api.pool, fixture.config)).claude.state, 'reading')
  let release!: (read: CatalogRead) => void
  state.answers.push(new Promise((resolve) => (release = resolve)))
  await catalog.pass()
  await readStarted(state, 2)
  // Check again while that read runs: it is answered by a later read, not this one.
  await refreshModelCatalog(fixture.api.pool, fixture.config, { provider: 'claude' })
  release({ generation: 'rev-a', cliVersion: '2.1.319', models: [sonnet] })
  await catalog.idle()
  assert.ok((await claudeRow(fixture))?.refreshRequestedAt)
  await round(catalog)
  assert.equal(state.reads, 3)
  const row = await claudeRow(fixture)
  assert.equal(row?.refreshRequestedAt, null)
  assert.equal((await readModelCatalog(fixture.api.pool, fixture.config)).claude.state, 'current')
})

test('a reply read before a guest sign-in change is discarded by the generation check and read again', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const { state, reader } = fakeReader('rev-a')
  const catalog = worker(fixture, () => reader)
  t.after(() => catalog.close())
  await round(catalog)

  // The guest commits a new token after the read started, before any invalidation arrives.
  let release!: (read: CatalogRead) => void
  state.answers.push(new Promise((resolve) => (release = resolve)))
  await refreshModelCatalog(fixture.api.pool, fixture.config, { provider: 'claude' })
  await catalog.pass()
  await readStarted(state, 2)
  state.generation = 'rev-b'
  release({ generation: 'rev-a', cliVersion: '2.1.319', models: [sonnet] })
  await catalog.idle()
  assert.equal(state.reads, 3)
  const row = await claudeRow(fixture)
  assert.equal(row?.signInGeneration, 'rev-b')
  assert.deepEqual(row?.models, [opus])
  assert.equal(row?.staleSignIn, false)
})

test('a delayed reply from before an invalidation is discarded and read again', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const { state, reader } = fakeReader('rev-a')
  const catalog = worker(fixture, () => reader)
  t.after(() => catalog.close())
  await round(catalog)

  let release!: (read: CatalogRead) => void
  state.answers.push(new Promise((resolve) => (release = resolve)))
  await refreshModelCatalog(fixture.api.pool, fixture.config, { provider: 'claude' })
  await catalog.pass()
  await readStarted(state, 2)
  // The dialog confirms a new token; the old generation's reply arrives after.
  state.generation = 'rev-b'
  await refreshModelCatalog(fixture.api.pool, fixture.config, {
    provider: 'claude',
    invalidate: true,
  })
  release({ generation: 'rev-a', cliVersion: '2.1.319', models: [sonnet] })
  await catalog.idle()
  assert.equal(state.reads, 3)
  const row = await claudeRow(fixture)
  assert.deepEqual(row?.models, [opus])
  assert.equal(row?.signInGeneration, 'rev-b')
  assert.equal(row?.staleSignIn, false)
})

test('an invalidation during a read discards its reply even before the generation moves', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const { state, reader } = fakeReader('rev-a')
  const catalog = worker(fixture, () => reader)
  t.after(() => catalog.close())
  await round(catalog)

  let release!: (read: CatalogRead) => void
  state.answers.push(new Promise((resolve) => (release = resolve)))
  await refreshModelCatalog(fixture.api.pool, fixture.config, { provider: 'claude' })
  await catalog.pass()
  await readStarted(state, 2)
  // The dialog's invalidation lands while the guest still reports the old generation.
  await refreshModelCatalog(fixture.api.pool, fixture.config, {
    provider: 'claude',
    invalidate: true,
  })
  release({ generation: 'rev-a', cliVersion: '2.1.319', models: [sonnet] })
  await catalog.idle()
  assert.equal(state.reads, 3)
  assert.deepEqual((await claudeRow(fixture))?.models, [opus])
})

test('a sign-in found by the generation poll marks the list stale and asks for a read', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const time = clock()
  const { state, reader } = fakeReader('rev-a')
  const catalog = worker(fixture, () => reader, time)
  t.after(() => catalog.close())
  await round(catalog)

  // Changed through the guest's management service, without the app's dialog.
  state.generation = 'rev-b'
  state.answers.push(new CatalogReadError('timeout'))
  time.advance(59_999)
  await round(catalog)
  assert.equal(state.reads, 1)
  time.advance(1)
  await round(catalog)
  // The poll saw it, marked the list and read again; that reread failed.
  assert.equal(state.reads, 2)
  const failed = await readModelCatalog(fixture.api.pool, fixture.config)
  assert.equal(failed.claude.state, 'stale_sign_in')
  assert.deepEqual(failed.claude.models, [opus])
  assert.equal((await claudeRow(fixture))?.staleSignIn, true)

  // Still stale until a list read under rev-b is published.
  time.advance(CATALOG_RETRY_MS)
  await round(catalog)
  const current = await readModelCatalog(fixture.api.pool, fixture.config)
  assert.equal(current.claude.state, 'current')
  assert.equal((await claudeRow(fixture))?.signInGeneration, 'rev-b')
})

test('a CLI version a turn reports that differs from the stored list asks for a read', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const { state, reader } = fakeReader('rev-a')
  const catalog = worker(fixture, () => reader)
  t.after(() => catalog.close())
  await round(catalog)

  await catalog.cliVersionReported('claude', 'subscription', '2.1.319')
  assert.equal((await claudeRow(fixture))?.refreshRequestedAt, null)
  await catalog.cliVersionReported('claude', 'subscription', '2.1.320')
  assert.ok((await claudeRow(fixture))?.refreshRequestedAt)
  await round(catalog)
  assert.equal(state.reads, 2)
})

test('a mode with no route to its key keeps the built-in list and clears its requests', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture, 'api_key')
  const catalog = worker(fixture, () => undefined, clock(), [
    { provider: 'claude', authentication: 'api_key', enabled: true },
  ])
  t.after(() => catalog.close())
  // A list a host profile stored for this scope before it moved to the shared VM.
  await fixture.db.pool.query(
    `INSERT INTO agent_model_catalog
        (actor_id,target_id,target_context_id,provider,authentication,models,source,read_in,read_at)
      VALUES ($1,$2,$3,'claude','api_key',$4::jsonb,'api','host',now())`,
    [
      fixture.config.actorId,
      fixture.config.targetId,
      fixture.config.targetContextId,
      JSON.stringify([sonnet]),
    ],
  )
  await refreshModelCatalog(fixture.api.pool, fixture.config, { provider: 'claude' })
  await round(catalog)
  const answer = await readModelCatalog(fixture.api.pool, fixture.config)
  assert.deepEqual(answer.claude.models, [...BUILT_IN_MODEL_CATALOG.claude])
  assert.equal(answer.claude.authentication, 'api_key')
  assert.equal(answer.claude.state, 'never_read')
  assert.equal(answer.claude.builtin, true)
})

test('on a host profile, an API-key reply is discarded when the key changed during the read', async (t) => {
  const fixture = await processingFixture({ profileId: 'native-agent/2' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture, 'api_key')
  let key = 'sk-ant-api-first'
  const requests: { key: string | null; url: string }[] = []
  const fetcher: typeof fetch = async (url, init) => {
    const headers = new Headers(init?.headers)
    requests.push({ key: headers.get('x-api-key'), url: String(url) })
    const name = requests.length === 1 ? 'Claude Sonnet 5.5' : 'Claude Opus 5.5'
    const id = requests.length === 1 ? 'claude-sonnet-5-5' : 'claude-opus-5-5'
    // The key is replaced while the first reply is on its way.
    key = 'sk-ant-api-second'
    return Response.json({ data: [{ id, display_name: name }], has_more: false })
  }
  const secret = fixture.config.channelSecret
  const reader = hostClaudeApiReader(secret, () => key, fetcher)
  const catalog = worker(fixture, () => reader, clock(), [
    { provider: 'claude', authentication: 'api_key', enabled: true },
  ])
  t.after(() => catalog.close())
  await round(catalog)
  assert.deepEqual(
    requests.map((request) => request.key),
    ['sk-ant-api-first', 'sk-ant-api-second'],
  )
  assert.ok(
    requests.every((request) => request.url.startsWith('https://api.anthropic.com/v1/models?')),
  )
  const row = await claudeRow(fixture, 'api_key')
  assert.deepEqual(
    row?.models?.map((model) => model.id),
    ['claude-opus-5-5'],
  )
  assert.equal(row?.signInGeneration, apiKeyGeneration(secret, 'claude', 'sk-ant-api-second'))
  // The generation is an HMAC: the key itself is stored nowhere.
  const stored = await fixture.db.pool.query(
    'SELECT row_to_json(c)::text AS text FROM agent_model_catalog c',
  )
  assert.ok(stored.rows.every((value) => !value.text.includes('sk-ant-api')))
  assert.equal(row?.source, 'api')
  assert.equal(row?.readIn, 'host')
})

test('a host subscription read uses only the CLI and is stored with no generation or fence', async (t) => {
  const fixture = await processingFixture({ profileId: 'native-agent/2' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const root = await mkdtemp(join(tmpdir(), 'catalog-host-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const log = join(root, 'state', 'model-catalog', 'model-catalog-cli.log')
  const host = nativeAgentHost({
    INTAKE_AGENT_STATE_ROOT: join(root, 'state'),
    INTAKE_CLAUDE_EXECUTABLE: fakeCli,
    PATH: process.env.PATH,
    HOME: root,
  })
  // A subscription read must never reach a models API.
  let fetched = 0
  const original = globalThis.fetch
  globalThis.fetch = async (...args) => {
    fetched++
    return original(...args)
  }
  t.after(() => {
    globalThis.fetch = original
  })
  const catalog = worker(fixture, () => hostClaudeSubscriptionReader(host))
  t.after(() => catalog.close())
  await round(catalog)
  const row = await claudeRow(fixture)
  assert.equal(row?.models?.length, 13)
  assert.equal(row?.signInGeneration, null)
  assert.equal(row?.latestGeneration, null)
  assert.equal(row?.readIn, 'host')
  assert.equal(fetched, 0)
  const frames = (await readFile(log, 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  const received = frames.filter((frame) => 'received' in frame).map((frame) => frame.received)
  // Only `initialize`: no user message, so no turn.
  assert.equal(received.length, 1)
  assert.deepEqual((received[0] as { request: unknown }).request, { subtype: 'initialize' })
  const started = frames.find((frame) => 'started' in frame) as { args: string[] }
  assert.ok(started.args.includes('--setting-sources'))
  assert.ok(!started.args.includes('--model'))
})

test('the routes answer each provider and accept a refresh through CSRF', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const read = await fixture.http('/agents/models')
  assert.equal(read.status, 200)
  assert.equal((read.value as { claude: { state: string } }).claude.state, 'never_read')
  const refreshed = await fixture.http('/agents/models/refresh', {
    provider: 'codex',
    invalidate: true,
  })
  assert.equal(refreshed.status, 202)
  assert.deepEqual(refreshed.value, {
    provider: 'codex',
    authentication: 'subscription',
    stale_sign_in: true,
  })
  const reading = await fixture.http('/agents/models')
  assert.equal((reading.value as { codex: { state: string } }).codex.state, 'reading')
  const refused = await fixture.http('/agents/models/refresh', { provider: 'codex', token: 'x' })
  assert.equal(refused.status, 400)
})

test('a list read on another route is never served, in either direction, even when the new read fails', async (t) => {
  for (const [profileId, storedIn] of [
    ['shared-vm-agent/3', 'host'],
    ['native-agent/2', 'vm'],
  ] as const) {
    const fixture = await processingFixture({ profileId })
    t.after(() => fixture.dispose())
    await claudeOnly(fixture)
    await fixture.db.pool.query(
      `INSERT INTO agent_model_catalog
          (actor_id,target_id,target_context_id,provider,authentication,models,source,read_in,read_at)
        VALUES ($1,$2,$3,'claude','subscription',$4::jsonb,'cli',$5,now())`,
      [
        fixture.config.actorId,
        fixture.config.targetId,
        fixture.config.targetContextId,
        JSON.stringify([sonnet]),
        storedIn,
      ],
    )
    const before = await readModelCatalog(fixture.api.pool, fixture.config)
    assert.equal(before.claude.builtin, true, profileId)
    const { state, reader } = fakeReader('rev-a', storedIn === 'vm' ? 'host' : 'vm')
    let fail!: (error: CatalogReadError) => void
    state.answers.push(
      new Promise<CatalogRead>((_resolve, reject) => {
        fail = reject
      }),
    )
    const catalog = worker(fixture, () => reader)
    await catalog.pass()
    await readStarted(state, 1)
    // This route's read is running: it says so over the built-in list.
    const reading = await readModelCatalog(fixture.api.pool, fixture.config)
    assert.equal(reading.claude.state, 'reading', profileId)
    assert.equal(reading.claude.builtin, true, profileId)
    fail(new CatalogReadError('timeout'))
    await catalog.idle()
    await catalog.close()
    const after = await readModelCatalog(fixture.api.pool, fixture.config)
    assert.equal(after.claude.builtin, true, profileId)
    assert.deepEqual(after.claude.models, [...BUILT_IN_MODEL_CATALOG.claude])
    assert.equal(after.claude.state, 'never_read', profileId)
    assert.equal(after.claude.failure, 'timeout', profileId)
    assert.equal(after.claude.read_at, null, profileId)
  }
})

test('the generation poll runs while a read of the same provider is still in flight', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const time = clock()
  const { state, reader } = fakeReader('rev-a')
  const catalog = worker(fixture, () => reader, time)
  t.after(() => catalog.close())
  await round(catalog)

  let release!: (read: CatalogRead) => void
  state.answers.push(new Promise((resolve) => (release = resolve)))
  await refreshModelCatalog(fixture.api.pool, fixture.config, { provider: 'claude' })
  await catalog.pass()
  await readStarted(state, 2)
  // The sign-in changes outside the dialogs while that read hangs; the poll still sees it.
  state.generation = 'rev-b'
  time.advance(60_000)
  await catalog.pass()
  for (let i = 0; i < 100 && !(await claudeRow(fixture))?.staleSignIn; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal((await claudeRow(fixture))?.staleSignIn, true)
  assert.equal((await claudeRow(fixture))?.latestGeneration, 'rev-b')
  release({ generation: 'rev-a', cliVersion: '2.1.319', models: [sonnet] })
  await catalog.idle()
  await round(catalog)
  const row = await claudeRow(fixture)
  assert.equal(row?.signInGeneration, 'rev-b')
  assert.deepEqual(row?.models, [opus])
})

test('a disabled provider with a stored list is still polled for sign-in changes', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const time = clock()
  const { state, reader } = fakeReader('rev-a')
  let enabled = true
  const catalog = modelCatalogWorker({
    pool: fixture.runner.pool,
    scope: fixture.config,
    reader: () => reader,
    now: time.now,
    providers: async () => [{ provider: 'claude', authentication: 'subscription', enabled }],
  })
  t.after(() => catalog.close())
  await round(catalog)
  enabled = false
  state.generation = 'rev-b'
  time.advance(60_000)
  // The read the poll requests fails, so the list stays marked as from the earlier sign-in.
  state.answers.push(new CatalogReadError('timeout'))
  await round(catalog)
  assert.equal(state.reads, 2)
  assert.equal(
    (await readModelCatalog(fixture.api.pool, fixture.config)).claude.state,
    'stale_sign_in',
  )
})

test('repeated admissions of one CLI version request one read, and an API list none', async (t) => {
  const fixture = await processingFixture({ profileId: 'native-agent/2' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture, 'api_key')
  const fetcher: typeof fetch = async () =>
    Response.json({
      data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }],
      has_more: false,
    })
  const reader = hostClaudeApiReader(fixture.config.channelSecret, () => 'sk-ant-api-key', fetcher)
  const subscription = fakeReader('rev-a')
  const catalog = worker(
    fixture,
    (key) => (key.authentication === 'api_key' ? reader : subscription.reader),
    clock(),
    [
      { provider: 'claude', authentication: 'api_key', enabled: true },
      { provider: 'codex', authentication: 'subscription', enabled: false },
    ],
  )
  t.after(() => catalog.close())
  await round(catalog)
  for (let i = 0; i < 3; i++) {
    await catalog.cliVersionReported('claude', 'api_key', '2.1.319')
  }
  assert.equal((await claudeRow(fixture, 'api_key'))?.refreshRequestedAt, null)

  // A CLI list: the first admission of a new version requests one read, the repeats none.
  const cli = fakeReader('rev-a')
  const other = worker(fixture, () => cli.reader)
  t.after(() => other.close())
  await round(other)
  await other.cliVersionReported('claude', 'subscription', '2.1.320')
  await round(other)
  assert.equal(cli.state.reads, 2)
  await other.cliVersionReported('claude', 'subscription', '2.1.320')
  await round(other)
  assert.equal(cli.state.reads, 2)
})

test('removing a host API key marks its list stale until a read under a key lands', async (t) => {
  const fixture = await processingFixture({ profileId: 'native-agent/2' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture, 'api_key')
  let key: string | undefined = 'sk-ant-api-first'
  const fetcher: typeof fetch = async () =>
    Response.json({
      data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }],
      has_more: false,
    })
  const reader = hostClaudeApiReader(fixture.config.channelSecret, () => key, fetcher)
  const time = clock()
  const catalog = worker(fixture, () => reader, time, [
    { provider: 'claude', authentication: 'api_key', enabled: true },
  ])
  t.after(() => catalog.close())
  await round(catalog)
  assert.equal((await readModelCatalog(fixture.api.pool, fixture.config)).claude.state, 'current')

  key = undefined
  time.advance(60_000)
  await round(catalog)
  const removed = await readModelCatalog(fixture.api.pool, fixture.config)
  assert.equal(removed.claude.state, 'stale_sign_in')
  assert.equal(removed.claude.models[0].id, 'claude-opus-5-5')

  key = 'sk-ant-api-second'
  time.advance(60_000)
  await round(catalog)
  assert.equal((await readModelCatalog(fixture.api.pool, fixture.config)).claude.state, 'current')
})

test('a read that sampled a sign-in before a poll observed another never makes it current', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const time = clock()
  const { state, reader } = fakeReader('rev-a')
  const catalog = worker(fixture, () => reader, time)
  t.after(() => catalog.close())
  await round(catalog)

  let release!: (read: CatalogRead) => void
  state.answers.push(new Promise((resolve) => (release = resolve)))
  await refreshModelCatalog(fixture.api.pool, fixture.config, { provider: 'claude' })
  await catalog.pass()
  await readStarted(state, 2)
  // A poll commits rev-b while the read is out; then the guest reports rev-a again.
  state.generation = 'rev-b'
  time.advance(60_000)
  await catalog.pass()
  for (let i = 0; i < 100 && (await claudeRow(fixture))?.latestGeneration !== 'rev-b'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.equal((await claudeRow(fixture))?.staleSignIn, true)
  state.generation = 'rev-a'
  release({ generation: 'rev-a', cliVersion: '2.1.319', models: [sonnet] })
  await catalog.idle()
  // The held reply was discarded; the list is the one read after the observation.
  assert.equal(state.reads, 3)
  assert.deepEqual((await claudeRow(fixture))?.models, [opus])
})

test('a CLI version whose refresh request failed is asked for again by the next admission', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const { reader } = fakeReader('rev-a')
  let failNextUpdate = false
  const pool = new Proxy(fixture.runner.pool, {
    get(target, property, receiver) {
      if (property === 'query') {
        return (text: unknown, ...rest: unknown[]) => {
          if (
            failNextUpdate &&
            typeof text === 'string' &&
            text.includes('refresh_seq=refresh_seq+1')
          ) {
            failNextUpdate = false
            return Promise.reject(new Error('connection lost'))
          }
          return (target.query as (...args: unknown[]) => unknown).call(target, text, ...rest)
        }
      }
      return Reflect.get(target, property, receiver) as unknown
    },
  })
  const catalog = modelCatalogWorker({
    pool,
    scope: fixture.config,
    reader: () => reader,
    now: clock().now,
    providers: async () => [{ provider: 'claude', authentication: 'subscription', enabled: true }],
  })
  t.after(() => catalog.close())
  await round(catalog)
  failNextUpdate = true
  await assert.rejects(catalog.cliVersionReported('claude', 'subscription', '2.1.320'))
  assert.equal((await claudeRow(fixture))?.refreshRequestedAt, null)
  await catalog.cliVersionReported('claude', 'subscription', '2.1.320')
  assert.ok((await claudeRow(fixture))?.refreshRequestedAt)
})

test('removing the host OpenAI key marks the Codex list stale until a read under a key lands', async (t) => {
  const fixture = await processingFixture({ profileId: 'native-agent/2' })
  t.after(() => fixture.dispose())
  await saveAgentSettings(
    fixture.api.pool,
    fixture.config,
    singleProvider({
      expected_revision: '0',
      selection: { provider: 'codex', authentication: 'api_key', model: 'gpt-6.2-sol' },
    }),
  )
  const root = await mkdtemp(join(tmpdir(), 'catalog-codex-key-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const host = nativeAgentHost({
    INTAKE_AGENT_STATE_ROOT: join(root, 'state'),
    INTAKE_CODEX_EXECUTABLE: fakeCli,
    PATH: process.env.PATH,
    HOME: root,
    OPENAI_API_KEY: 'sk-openai-first',
  })
  const fetcher: typeof fetch = async () => Response.json({ data: [{ id: 'gpt-6.2-sol' }] })
  const reader = hostCodexApiReader(
    host,
    fixture.config.channelSecret,
    () => host.env.OPENAI_API_KEY,
    fetcher,
  )
  const time = clock()
  const catalog = worker(fixture, () => reader, time, [
    { provider: 'codex', authentication: 'api_key', enabled: true },
  ])
  t.after(() => catalog.close())
  await round(catalog)
  const read = await readModelCatalog(fixture.api.pool, fixture.config)
  assert.equal(read.codex.state, 'current')
  assert.equal(read.codex.models.find((model) => model.id === 'gpt-6.2-sol')?.usable, true)

  host.env = { ...host.env, OPENAI_API_KEY: undefined }
  time.advance(60_000)
  await round(catalog)
  const removed = await readModelCatalog(fixture.api.pool, fixture.config)
  assert.equal(removed.codex.state, 'stale_sign_in')
  assert.equal(removed.codex.models.length, 10)

  host.env = { ...host.env, OPENAI_API_KEY: 'sk-openai-second' }
  time.advance(60_000)
  await round(catalog)
  assert.equal((await readModelCatalog(fixture.api.pool, fixture.config)).codex.state, 'current')
})

test("a poll's first observation, landing while the first read is out, fences that read too", async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const time = clock()
  const { state, reader } = fakeReader('rev-b')
  // The first poll fails, so no generation is known when the first read starts.
  state.generations.push(new CatalogReadError('unavailable'))
  let release!: (read: CatalogRead) => void
  state.answers.push(new Promise((resolve) => (release = resolve)))
  const catalog = worker(fixture, () => reader, time)
  t.after(() => catalog.close())
  await catalog.pass()
  await readStarted(state, 1)
  // The next poll observes rev-b first; the held read's own check then still says rev-a.
  time.advance(60_000)
  await catalog.pass()
  for (let i = 0; i < 100 && (await claudeRow(fixture))?.latestGeneration !== 'rev-b'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  state.generations.push('rev-a')
  release({ generation: 'rev-a', cliVersion: '2.1.319', models: [sonnet] })
  await catalog.idle()
  const row = await claudeRow(fixture)
  assert.deepEqual(row?.models, [opus])
  assert.equal(row?.signInGeneration, 'rev-b')
})

test("another route's failed attempt isn't shown as this route's", async (t) => {
  const fixture = await processingFixture({ profileId: 'native-agent/2' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  await fixture.db.pool.query(
    `INSERT INTO agent_model_catalog
        (actor_id,target_id,target_context_id,provider,authentication,models,source,read_in,
          attempt_in,read_at,attempted_at,failure)
      VALUES ($1,$2,$3,'claude','subscription',$4::jsonb,'cli','vm','vm',now() - interval '1 hour',
        now(),'timeout')`,
    [
      fixture.config.actorId,
      fixture.config.targetId,
      fixture.config.targetContextId,
      JSON.stringify([sonnet]),
    ],
  )
  const answer = await readModelCatalog(fixture.api.pool, fixture.config)
  assert.equal(answer.claude.state, 'never_read')
  assert.equal(answer.claude.failure, null)
  assert.equal(answer.claude.attempted_at, null)
  assert.equal(answer.claude.builtin, true)
})

test('overlapping admissions of one new CLI version write one refresh request', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
  t.after(() => fixture.dispose())
  await claudeOnly(fixture)
  const { reader } = fakeReader('rev-a')
  let requests = 0
  const pool = new Proxy(fixture.runner.pool, {
    get(target, property, receiver) {
      if (property === 'query') {
        return (text: unknown, ...rest: unknown[]) => {
          if (typeof text === 'string' && text.includes('refresh_seq=refresh_seq+1')) {
            requests++
          }
          return (target.query as (...args: unknown[]) => unknown).call(target, text, ...rest)
        }
      }
      return Reflect.get(target, property, receiver) as unknown
    },
  })
  const catalog = modelCatalogWorker({
    pool,
    scope: fixture.config,
    reader: () => reader,
    now: clock().now,
    providers: async () => [{ provider: 'claude', authentication: 'subscription', enabled: true }],
  })
  t.after(() => catalog.close())
  await round(catalog)
  await Promise.all([
    catalog.cliVersionReported('claude', 'subscription', '2.1.320'),
    catalog.cliVersionReported('claude', 'subscription', '2.1.320'),
    catalog.cliVersionReported('claude', 'subscription', '2.1.320'),
  ])
  assert.equal(requests, 1)
})
