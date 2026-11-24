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
} from '#/agents/provider-status-channel.ts'
import { readProviderStatus, workerStatusSource } from '#/agents/provider-status.ts'
import type { BridgeProviderStatuses } from '#/agents/shared-vm/coordinator.ts'

const revision = '9f7a2b3c-1d4e-4f5a-8b6c-7d8e9f0a1b2c'
const statuses: BridgeProviderStatuses = {
  claude: { state: 'saved', revision, saved_at: '2026-11-23T22:00:00.000Z' },
  codex: { state: 'signing_in' },
}

type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Capture = Awaited<ReturnType<Fixture['seedCapture']>>
type Selection = { provider: 'claude' | 'codex'; authentication: 'subscription' | 'api_key' }

test(
  'the API asks the session worker through the database and gives up at its deadline',
  { timeout: 90000 },
  async (t) => {
    const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
    t.after(() => fixture.dispose())

    // No worker: the request ends at its deadline and returns its connection.
    let started = Date.now()
    assert.equal(await requestProviderStatus(fixture.api.pool, fixture.config, 300), undefined)
    assert.ok(Date.now() - started < 1500)

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
    let answer: BridgeProviderStatuses | undefined
    for (let i = 0; i < 50 && !answer; i++) {
      answer = await requestProviderStatus(fixture.api.pool, fixture.config, 300)
    }
    assert.deepEqual(answer, statuses)

    // A request signed for another secret or scope is not answered.
    const before = reads
    for (const other of [
      { ...fixture.config, channelSecret: 'another-channel-secret-of-enough-length' },
      { ...fixture.config, targetContextId: '00000000-0000-4000-8000-0000000000aa' },
    ]) {
      assert.equal(await requestProviderStatus(fixture.api.pool, other, 300), undefined)
    }
    assert.equal(reads, before)

    // A forged reply from another database role is ignored.
    const forging = setInterval(() => {
      void fixture.db.pool
        .query('SELECT pg_notify($1, $2)', [
          STATUS_REPLY_CHANNEL,
          '0'.repeat(64) + '.' + JSON.stringify({ id: 'any', status: statuses }),
        ])
        .catch(() => {})
    }, 20)
    t.after(() => clearInterval(forging))
    assert.deepEqual(await requestProviderStatus(fixture.api.pool, fixture.config), statuses)
    clearInterval(forging)

    // A worker that answers after the deadline is not waited for, and its late reply is ignored.
    slow = true
    started = Date.now()
    assert.equal(await requestProviderStatus(fixture.api.pool, fixture.config, 300), undefined)
    assert.ok(Date.now() - started < 700)
    await new Promise((resolve) => setTimeout(resolve, 900))
    slow = false
    assert.deepEqual(await requestProviderStatus(fixture.api.pool, fixture.config), statuses)
    assert.equal(fixture.api.pool.waitingCount, 0)
  },
)

test(
  'the provider status route reads the worker, with no revision, token or account',
  { timeout: 90000 },
  async (t) => {
    const fixture = await processingFixture({ profileId: 'shared-vm-agent/3' })
    t.after(() => fixture.dispose())
    const worker = serveProviderStatusRequests(fixture.runner.pool, fixture.config, async () => ({
      ...statuses,
      codex: { state: 'unknown', reason: 'timeout' },
    }))
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
      last_sign_in_failure: null,
    })
    assert.deepEqual(body.codex, {
      state: 'unknown',
      reason: 'timeout',
      last_sign_in_failure: null,
    })
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
    const slots = await freeSlots(fixture, 2)
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
    const tie = await settledSession(
      fixture,
      slots,
      root,
      { provider: 'claude', authentication: 'api_key' },
      finishes,
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
