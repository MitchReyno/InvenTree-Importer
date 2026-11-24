import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { ProviderStatusDto } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { runSessionTurn, type SessionDriver } from '#/agents/session/session-runner.ts'
import { NativeSessionError, type ProviderErrorDto } from '#/agents/failure-model.ts'
import {
  requestProviderStatus,
  serveProviderStatusRequests,
  STATUS_REPLY_CHANNEL,
  STATUS_REQUEST_CHANNEL,
} from '#/agents/provider-status-channel.ts'
import { readProviderStatus, workerStatusSource } from '#/agents/provider-status.ts'
import type { BridgeProviderStatuses } from '#/agents/shared-vm/coordinator.ts'

const revision = '9f7a2b3c-1d4e-4f5a-8b6c-7d8e9f0a1b2c'
const checkedAt = '2026-11-24T00:10:58.000Z'
const statuses: BridgeProviderStatuses = {
  claude: { state: 'saved', revision, saved_at: '2026-11-23T22:00:00.000Z', checked_at: checkedAt },
  codex: { state: 'signing_in', checked_at: checkedAt },
}

type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Capture = Awaited<ReturnType<Fixture['seedCapture']>>
type Selection = { provider: 'claude' | 'codex'; authentication: 'subscription' | 'api_key' }

/** What the worker sends the API: the same statuses without Claude's revision. */
const display = {
  claude: { state: 'saved', saved_at: '2026-11-23T22:00:00.000Z', checked_at: checkedAt },
  codex: { state: 'signing_in', checked_at: checkedAt },
}

/** Listens on `channel` as another database role would, keeping every payload seen. */
async function eavesdrop(fixture: Fixture, channel: string) {
  const client = await fixture.db.pool.connect()
  const payloads: string[] = []
  client.on('notification', (message) => payloads.push(message.payload ?? ''))
  await client.query(`LISTEN ${channel}`)
  return {
    payloads,
    async close() {
      await client.query(`UNLISTEN ${channel}`).catch(() => {})
      client.release()
    },
  }
}

const bodyOf = (payload: string) => JSON.parse(payload.slice(65)) as { id: string }

async function waitUntil(check: () => boolean, what: string) {
  for (let i = 0; i < 200 && !check(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  assert.ok(check(), 'timed out waiting for ' + what)
}

test(
  'the API asks the session worker through the database and gives up at its deadline',
  { timeout: 90000 },
  async (t) => {
    const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
    t.after(() => fixture.dispose())
    const requests = await eavesdrop(fixture, STATUS_REQUEST_CHANNEL)
    const replies = await eavesdrop(fixture, STATUS_REPLY_CHANNEL)
    await using _listeners = {
      [Symbol.asyncDispose]: async () => {
        await requests.close()
        await replies.close()
      },
    }

    // No worker: the request ends at its deadline and returns its connection.
    let started = Date.now()
    assert.equal(await requestProviderStatus(fixture.api.pool, fixture.config, 300), undefined)
    assert.ok(Date.now() - started < 1500)

    // A reply forged for the request in flight, with a wrong MAC, is ignored.
    requests.payloads.length = 0
    const forged = requestProviderStatus(fixture.api.pool, fixture.config, 600)
    await waitUntil(() => requests.payloads.length === 1, 'the request')
    await fixture.db.pool.query('SELECT pg_notify($1, $2)', [
      STATUS_REPLY_CHANNEL,
      'f'.repeat(64) +
        '.' +
        JSON.stringify({ id: bodyOf(requests.payloads[0]).id, status: display }),
    ])
    assert.equal(await forged, undefined)

    // Taking a connection counts against the deadline too.
    const held = await Promise.all(
      Array.from({ length: fixture.api.pool.options.max }, () => fixture.api.pool.connect()),
    )
    started = Date.now()
    assert.equal(await requestProviderStatus(fixture.api.pool, fixture.config, 300), undefined)
    assert.ok(Date.now() - started < 1000)
    for (const client of held) {
      client.release()
    }

    let reads = 0
    let slow = false
    const worker = serveProviderStatusRequests(fixture.runner.pool, fixture.config, async () => {
      reads++
      if (slow) {
        await new Promise((resolve) => setTimeout(resolve, 800))
      }
      return statuses
    })
    // Before the fixture's own cleanup, which waits for the worker's connection.
    await using _worker = { [Symbol.asyncDispose]: () => worker.close() }
    let answer: unknown
    for (let i = 0; i < 50 && !answer; i++) {
      answer = await requestProviderStatus(fixture.api.pool, fixture.config, 300)
    }
    assert.deepEqual(answer, display)
    // Nothing on the shared channels carries the credential revision.
    assert.ok(replies.payloads.length > 0)
    for (const payload of [...requests.payloads, ...replies.payloads]) {
      assert.ok(!payload.includes(revision))
    }

    // A replayed request is answered once.
    requests.payloads.length = 0
    replies.payloads.length = 0
    assert.deepEqual(await requestProviderStatus(fixture.api.pool, fixture.config), display)
    const original = requests.payloads[0]
    for (let i = 0; i < 3; i++) {
      await fixture.db.pool.query('SELECT pg_notify($1, $2)', [STATUS_REQUEST_CHANNEL, original])
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
    const replyIds = replies.payloads.map((payload) => bodyOf(payload).id)
    assert.deepEqual(replyIds, [bodyOf(original).id])

    // A request signed for another secret or scope is not answered.
    const before = reads
    for (const other of [
      { ...fixture.config, channelSecret: 'another-channel-secret-of-enough-length' },
      { ...fixture.config, targetContextId: '00000000-0000-4000-8000-0000000000aa' },
    ]) {
      assert.equal(await requestProviderStatus(fixture.api.pool, other, 300), undefined)
    }
    assert.equal(reads, before)

    // A worker that answers after the deadline is not waited for, and sends nothing late.
    slow = true
    replies.payloads.length = 0
    started = Date.now()
    assert.equal(await requestProviderStatus(fixture.api.pool, fixture.config, 300), undefined)
    assert.ok(Date.now() - started < 700)
    await new Promise((resolve) => setTimeout(resolve, 900))
    assert.deepEqual(replies.payloads, [])
    slow = false
    assert.deepEqual(await requestProviderStatus(fixture.api.pool, fixture.config), display)

    // The API's connection lost while it waits ends that read, without failing the process.
    slow = true
    const waiting = requestProviderStatus(fixture.api.pool, fixture.config, 1500)
    await new Promise((resolve) => setTimeout(resolve, 150))
    const killed = await fixture.db.pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = current_database() AND usename = $1 AND query LIKE '%pg_notify%'`,
      [fixture.api.name],
    )
    assert.equal(killed.rowCount, 1)
    started = Date.now()
    assert.equal(await waiting, undefined)
    assert.ok(Date.now() - started < 1400)
    slow = false
    assert.deepEqual(await requestProviderStatus(fixture.api.pool, fixture.config), display)
    assert.equal(fixture.api.pool.waitingCount, 0)
  },
)

test(
  'the provider status route reads the worker, with no revision, token or account, and Check again asks afresh',
  { timeout: 90000 },
  async (t) => {
    const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
    t.after(() => fixture.dispose())
    const refreshes: boolean[] = []
    let codex: BridgeProviderStatuses['codex'] = { state: 'unknown', reason: 'checking' }
    const worker = serveProviderStatusRequests(
      fixture.runner.pool,
      fixture.config,
      async (_budgetMs, refresh) => {
        refreshes.push(refresh)
        return { ...statuses, codex }
      },
    )
    // Before the fixture's own cleanup, which waits for the worker's connection.
    await using _worker = { [Symbol.asyncDispose]: () => worker.close() }
    let body: ProviderStatusDto | undefined
    for (let i = 0; i < 50; i++) {
      const response = await fixture.http('/agents/provider-status')
      assert.equal(response.status, 200)
      body = response.value as ProviderStatusDto
      if (body.claude.state !== 'unknown') {
        break
      }
      // The route reuses a read for a few seconds; a fresh source reads again.
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.ok(body)
    assert.deepEqual(body.claude, {
      state: 'saved',
      saved_at: '2026-11-23T22:00:00.000Z',
      checked_at: checkedAt,
      last_sign_in_failure: null,
    })
    // No Codex check has finished yet: unknown, never signed out.
    assert.deepEqual(body.codex, {
      state: 'unknown',
      reason: 'checking',
      last_sign_in_failure: null,
    })
    assert.ok(!JSON.stringify(body).includes(revision))
    assert.ok(refreshes.every((refresh) => !refresh))

    // Within the reuse window a plain read doesn't reach the worker; Check again does, and its
    // answer is reused by the next plain read.
    codex = { state: 'signed_in', checked_at: checkedAt }
    const asked = refreshes.length
    const reused = (await fixture.http('/agents/provider-status')).value as ProviderStatusDto
    assert.equal(reused.codex.state, 'unknown')
    assert.equal(refreshes.length, asked)
    const forced = await fixture.http('/agents/provider-status?refresh=true')
    assert.equal(forced.status, 200)
    assert.deepEqual((forced.value as ProviderStatusDto).codex, {
      state: 'signed_in',
      checked_at: checkedAt,
      last_sign_in_failure: null,
    })
    assert.deepEqual(refreshes.slice(asked), [true])
    const after = (await fixture.http('/agents/provider-status')).value as ProviderStatusDto
    assert.equal(after.codex.state, 'signed_in')
    assert.equal(refreshes.length, asked + 1)

    // Anything else in the query is refused.
    assert.equal((await fixture.http('/agents/provider-status?refresh=1')).status, 400)
    assert.ok(!JSON.stringify(body).includes(revision))
  },
)

test(
  'without an answering worker, and without agent sessions, nothing reads as signed out',
  { timeout: 90000 },
  async (t) => {
    const vm = await processingFixture({ profileId: 'shared-vm-agent/3' })
    t.after(() => vm.dispose())
    const silent = await readProviderStatus(
      vm.api.pool,
      vm.config,
      workerStatusSource(vm.api.pool, vm.config),
    )
    assert.deepEqual(
      [silent.claude, silent.codex].map((status) => status.state === 'unknown' && status.reason),
      ['worker_unavailable', 'worker_unavailable'],
    )

    const unreachable = await readProviderStatus(vm.api.pool, vm.config, async () => ({
      statuses: {
        claude: { state: 'unknown', reason: 'vm_unreachable' },
        codex: { state: 'unknown', reason: 'vm_unreachable' },
      },
      readAt: new Date('2026-11-24T00:00:00.000Z'),
    }))
    assert.deepEqual(unreachable, {
      claude: { state: 'unknown', reason: 'vm_unreachable', last_sign_in_failure: null },
      codex: { state: 'unknown', reason: 'vm_unreachable', last_sign_in_failure: null },
      read_at: '2026-11-24T00:00:00.000Z',
    })

    const native = await processingFixture()
    t.after(() => native.dispose())
    const none = await readProviderStatus(
      native.api.pool,
      native.config,
      workerStatusSource(native.api.pool, native.config),
    )
    assert.deepEqual(
      [none.claude, none.codex].map((status) => status.state === 'unknown' && status.reason),
      ['not_configured', 'not_configured'],
    )
  },
)

/** A lot and step with no job yet: each holds one job, so each session needs its own. */
type Slot = { capture: Capture; lot: { id: string }; stage: 'research' | 'images' }

async function freeSlots(fixture: Fixture, captures: number) {
  const slots: Slot[] = []
  for (let i = 0; i < captures; i++) {
    const capture = await fixture.seedCapture()
    for (const lot of [capture.packetA, capture.packetB]) {
      for (const stage of ['research', 'images'] as const) {
        slots.push({ capture, lot, stage })
      }
    }
  }
  return slots[Symbol.iterator]()
}

/** Queues a session in the next free slot and settles its turn through the real session runner. */
async function settledSession(
  fixture: Fixture,
  slots: Iterator<Slot>,
  root: string,
  selection: Selection,
  outcome: SessionDriver,
) {
  const { capture, lot, stage } = slots.next().value as Slot
  const session = await lotSession(fixture, capture, lot, {
    state: 'queued',
    stage,
    profile: {
      id: 'shared-vm-agent/1',
      agent: { ...selection, model: selection.provider === 'claude' ? 'haiku' : 'gpt-6.1-sol' },
      settingsRevision: '1',
    },
  })
  await runSessionTurn(
    {
      pool: fixture.runner.pool,
      config: fixture.config,
      host: { stateRoot: root, env: {}, claudeExecutable: '/unused', codexExecutable: '/unused' },
      toolUrl: 'http://127.0.0.1:1',
      drivers: { 'shared-vm-agent/1': outcome },
    },
    session.attempt,
    AbortSignal.timeout(30000),
  )
  return session.attempt
}

const refused = (code: string, providerError?: ProviderErrorDto): SessionDriver => {
  return async () => {
    throw new NativeSessionError(code, providerError ? { providerError } : undefined)
  }
}

const finishes: SessionDriver = async (turn) => {
  await turn.onStarted({ providerSessionId: 'fixture-session', actualModel: 'haiku' })
}

/** Sets a session's queue time; a trigger keeps it immutable, so this bypasses triggers. */
async function queuedAt(fixture: Fixture, attempt: string, at: string) {
  const client = await fixture.db.pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL session_replication_role = replica')
    await client.query('UPDATE agent_session SET queued_at=$2 WHERE attempt_id=$1', [attempt, at])
    await client.query('COMMIT')
  } finally {
    client.release()
  }
}

async function lines(fixture: Fixture) {
  const status = await readProviderStatus(fixture.api.pool, fixture.config, async () => ({
    statuses,
    readAt: new Date(),
  }))
  return { claude: status.claude.last_sign_in_failure, codex: status.codex.last_sign_in_failure }
}

test(
  'the last-session line shows only a subscription sign-in the provider refused',
  { timeout: 90000 },
  async (t) => {
    const fixture = await processingFixture({ profileId: 'shared-vm-agent/1' })
    t.after(() => fixture.dispose())
    const root = await mkdtemp(join(tmpdir(), 'sign-in-line-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const slots = await freeSlots(fixture, 3)
    const claudeSubscription = { provider: 'claude', authentication: 'subscription' } as const
    const codexSubscription = { provider: 'codex', authentication: 'subscription' } as const
    assert.deepEqual(await lines(fixture), { claude: null, codex: null })

    // Missing credentials, a missing token and an unreachable guest are not the provider's refusal.
    const notRefusals = [
      refused('agent_credentials_unavailable'),
      refused('agent_login_required'),
      refused('agent_process_unavailable'),
    ]
    for (const [i, outcome] of notRefusals.entries()) {
      const attempt = await settledSession(fixture, slots, root, claudeSubscription, outcome)
      await queuedAt(fixture, attempt, `2026-11-24T00:0${i}:00.000Z`)
      assert.equal((await lines(fixture)).claude, null)
    }

    // Claude's refusal of the subscription, on the latest session.
    const claudeRefusal = await settledSession(
      fixture,
      slots,
      root,
      claudeSubscription,
      refused('agent_login_required', {
        kind: 'authentication_failed',
        result: null,
        http_status: null,
      }),
    )
    await queuedAt(fixture, claudeRefusal, '2026-11-24T00:10:00.000Z')
    const shown = (await lines(fixture)).claude
    assert.equal(shown?.attempt_id, claudeRefusal)
    const failure = await fixture.db.pool.query(
      'SELECT id, diagnostic FROM agent_session_failure WHERE attempt_id=$1',
      [claudeRefusal],
    )
    assert.deepEqual(shown, {
      attempt_id: claudeRefusal,
      failure_id: failure.rows[0].id,
      failed_at: failure.rows[0].diagnostic.timestamp,
    })

    // An API-key session queued at the same time hides it, as does a newer one that didn't fail.
    // The tying API-key session was refused too, with a 401: only a subscription refusal counts.
    const tie = await settledSession(
      fixture,
      slots,
      root,
      { provider: 'claude', authentication: 'api_key' },
      refused('agent_login_required', {
        kind: 'authentication_failed',
        result: null,
        http_status: 401,
      }),
    )
    await queuedAt(fixture, tie, '2026-11-24T00:10:00.000Z')
    assert.equal((await lines(fixture)).claude, null)
    await queuedAt(fixture, tie, '2026-11-24T00:09:00.000Z')
    assert.equal((await lines(fixture)).claude?.attempt_id, claudeRefusal)
    const newer = await settledSession(fixture, slots, root, claudeSubscription, finishes)
    await queuedAt(fixture, newer, '2026-11-24T00:11:00.000Z')
    assert.equal((await lines(fixture)).claude, null)

    // Codex: an HTTP 401 counts; a newer refusal of another kind hides it.
    assert.equal((await lines(fixture)).codex, null)
    const codexRefusal = await settledSession(
      fixture,
      slots,
      root,
      codexSubscription,
      refused('agent_turn_failed', { kind: 'other', result: null, http_status: 401 }),
    )
    await queuedAt(fixture, codexRefusal, '2026-11-24T00:12:00.000Z')
    assert.equal((await lines(fixture)).codex?.attempt_id, codexRefusal)
    // Claude's latest session is unaffected by Codex's.
    assert.equal((await lines(fixture)).claude, null)
    // Codex's own refusal kind counts without an HTTP status, and shows through the route.
    const unauthorized = await settledSession(
      fixture,
      slots,
      root,
      codexSubscription,
      refused('agent_turn_failed', { kind: 'unauthorized', result: null, http_status: null }),
    )
    await queuedAt(fixture, unauthorized, '2026-11-24T00:12:30.000Z')
    const route = (await fixture.http('/agents/provider-status')).value as ProviderStatusDto
    assert.equal(route.codex.last_sign_in_failure?.attempt_id, unauthorized)
    assert.equal(route.claude.last_sign_in_failure, null)
    const rateLimited = await settledSession(
      fixture,
      slots,
      root,
      codexSubscription,
      refused('agent_turn_failed', {
        kind: 'usageLimitExceeded',
        result: null,
        http_status: 429,
      }),
    )
    await queuedAt(fixture, rateLimited, '2026-11-24T00:13:00.000Z')
    assert.equal((await lines(fixture)).codex, null)

    // Another scope sees none of these sessions.
    const other = await readProviderStatus(
      fixture.api.pool,
      { ...fixture.config, targetContextId: '00000000-0000-4000-8000-0000000000bb' },
      async () => ({ statuses, readAt: new Date() }),
    )
    assert.equal(other.claude.last_sign_in_failure, null)
    assert.equal(other.codex.last_sign_in_failure, null)
  },
)
