import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { transaction } from '#/db/database.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
import { submitSessionInbox } from '#/agents/tools/inbox.ts'
import {
  interruptRunningSessions,
  queueSessionResume,
  runSessionTurn,
} from '#/agents/session/session-runner.ts'

type Provider = 'claude' | 'codex'

async function sessionHarness(provider: Provider) {
  const fixture = await processingFixture()
  const server = await startSessionToolServer({
    pool: fixture.runner.pool,
    config: fixture.config,
    statusIntervalMs: 0,
  })
  const root = await mkdtemp(join(tmpdir(), 'session-adapter-test-'))
  const executable = join(root, 'provider.cjs')
  await writeFile(
    executable,
    '#!/usr/bin/env node\n' +
      (await readFile(new URL('../fixtures/session-agent.cjs', import.meta.url), 'utf8')),
    { mode: 0o700 },
  )
  const stateRoot = join(root, 'state')
  await mkdir(stateRoot, { mode: 0o700 })
  const logFile = join(root, 'session.log')
  const capture = await fixture.seedCapture()
  const session = await lotSession(fixture, capture, capture.packetA, {
    state: 'queued',
    profile: {
      id: 'native-agent/2',
      agent: { provider, authentication: 'api_key', model: `fake-${provider}-model` },
      settingsRevision: '1',
    },
  })
  const host = {
    codexExecutable: executable,
    claudeExecutable: executable,
    stateRoot,
    env: {
      PATH: process.env.PATH,
      HOME: root,
      OPENAI_API_KEY: 'synthetic-only',
      ANTHROPIC_API_KEY: 'synthetic-only',
    },
  }
  const sessionDirectory = join(stateRoot, 'sessions', session.job)
  await mkdir(join(stateRoot, 'sessions'), { mode: 0o700 })
  await mkdir(sessionDirectory, { mode: 0o700 })
  /** The fake reads its mode from the private session directory it runs in. */
  const deps = (mode: string, turnDeadlineMs?: number) => {
    writeFileSync(
      join(sessionDirectory, 'fake-session.json'),
      JSON.stringify({ mode, log: logFile }),
    )
    return {
      pool: fixture.runner.pool,
      config: fixture.config,
      host,
      toolUrl: server.url,
      turnDeadlineMs,
    }
  }
  const events = async () =>
    (await readFile(logFile, 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  const state = async () =>
    (
      await fixture.db.pool.query<{ session_state: string; capability_sha256: Buffer | null }>(
        'SELECT session_state,capability_sha256 FROM agent_session WHERE attempt_id=$1',
        [session.attempt],
      )
    ).rows[0]
  const chat = (key: string, text: string) =>
    submitSessionInbox(fixture.api.pool, {
      binding: fixture.config,
      lineageId: session.job,
      actorId: fixture.identity.actor,
      idempotencyKey: key,
      kind: 'chat',
      payload: { text },
    })
  const toolStatus = (token: string) =>
    fetch(server.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }).then((response) => response.status)
  return {
    fixture,
    session,
    stateRoot,
    deps,
    events,
    state,
    chat,
    toolStatus,
    async dispose() {
      await server.close()
      await fixture.dispose()
    },
  }
}

for (const provider of ['claude', 'codex'] as const) {
  test(
    `${provider}: a session that reports another tool at start is refused`,
    { timeout: 60000 },
    async () => {
      const h = await sessionHarness(provider)
      try {
        const outcome = await runSessionTurn(
          h.deps('extra-tool'),
          h.session.attempt,
          new AbortController().signal,
        )
        assert.equal(outcome, 'failed', JSON.stringify(await h.events()))
        const current = await h.state()
        assert.equal(current.session_state, 'failed')
        assert.equal(current.capability_sha256, null)
      } finally {
        await h.dispose()
      }
    },
  )

  test(
    `${provider}: operator chat reaches the running turn and is acknowledged`,
    { timeout: 60000 },
    async () => {
      const h = await sessionHarness(provider)
      try {
        const running = runSessionTurn(
          h.deps('deliver'),
          h.session.attempt,
          new AbortController().signal,
        )
        const deadline = Date.now() + 20000
        while ((await h.state()).session_state !== 'running' && Date.now() < deadline) {
          await delay(50)
        }
        const receipt = await h.chat('chat-1', 'The reel is 1k ohm.')
        assert.equal(await running, 'finished')
        const events = await h.events()
        const delivered = events.find((event) => event.event === 'delivered')
        assert.match(String(delivered?.text), new RegExp(receipt.item_id))
        const cursor = await h.fixture.db.pool.query<{ acked_seq: string }>(
          'SELECT acked_seq FROM agent_session_cursor WHERE session_lineage_id=$1',
          [h.session.job],
        )
        assert.equal(cursor.rows[0].acked_seq, receipt.seq)
        const config = events.find((event) => event.event === 'mcp-config')
        if (provider === 'claude') {
          assert.equal(config?.contains_capability, false)
        }
        const capability = String(events.find((event) => event.event === 'capability')?.value)
        assert.equal(await h.toolStatus(capability), 401)
      } finally {
        await h.dispose()
      }
    },
  )

  test(
    `${provider}: a finished session resumes with queued chat and the old capability is refused`,
    { timeout: 90000 },
    async () => {
      const h = await sessionHarness(provider)
      try {
        assert.equal(
          await runSessionTurn(h.deps('normal'), h.session.attempt, new AbortController().signal),
          'finished',
        )
        const first = String(
          (await h.events()).find((event) => event.event === 'capability')?.value,
        )
        await h.chat('chat-1', 'Please check the back label.')
        const woken = await transaction(h.fixture.runner.pool, (client) =>
          queueSessionResume(client, h.session.job),
        )
        assert.equal(woken, h.session.attempt)
        assert.equal(
          await runSessionTurn(h.deps('reply'), h.session.attempt, new AbortController().signal),
          'finished',
        )
        const events = await h.events()
        const resumed = events.find((event) => event.event === 'resume')
        assert.ok(resumed?.id, 'the provider conversation was resumed')
        const openings = events.filter((event) => event.event === 'opening')
        assert.match(String(openings.at(-1)?.text), /1 new inbox item/)
        const replies = await h.fixture.db.pool.query(
          "SELECT 1 FROM agent_session_outbox WHERE session_id=$1 AND kind='reply'",
          [h.session.attempt],
        )
        assert.equal(replies.rowCount, 1)
        assert.equal(await h.toolStatus(first), 401)
      } finally {
        await h.dispose()
      }
    },
  )

  test(
    `${provider}: a resume without a transcript keeps the item pending`,
    { timeout: 90000 },
    async () => {
      const h = await sessionHarness(provider)
      try {
        assert.equal(
          await runSessionTurn(h.deps('normal'), h.session.attempt, new AbortController().signal),
          'finished',
        )
        await h.chat('chat-1', 'Anything new?')
        await transaction(h.fixture.runner.pool, (client) =>
          queueSessionResume(client, h.session.job),
        )
        assert.equal(
          await runSessionTurn(
            h.deps('resume-missing'),
            h.session.attempt,
            new AbortController().signal,
          ),
          'resume_unavailable',
        )
        const pending = await h.fixture.db.pool.query<{ count: string }>(
          `SELECT count(*) FROM agent_session_inbox i
         WHERE i.session_lineage_id=$1 AND i.seq > COALESCE((SELECT acked_seq FROM agent_session_cursor c WHERE c.session_lineage_id=$1),0)`,
          [h.session.job],
        )
        assert.equal(pending.rows[0].count, '1')
      } finally {
        await h.dispose()
      }
    },
  )

  test(
    `${provider}: a crash or a worker restart interrupts with no automatic turn`,
    { timeout: 60000 },
    async () => {
      const h = await sessionHarness(provider)
      try {
        assert.equal(
          await runSessionTurn(h.deps('crash'), h.session.attempt, new AbortController().signal),
          'interrupted',
        )
        // A worker that died mid-turn leaves the session running; the next worker start interrupts it.
        await h.fixture.db.pool.query(
          "UPDATE agent_session SET session_state='running',capability_sha256=$2 WHERE attempt_id=$1",
          [h.session.attempt, Buffer.alloc(32, 7)],
        )
        assert.deepEqual(await interruptRunningSessions(h.fixture.runner.pool, h.fixture.config), [
          h.session.attempt,
        ])
        const current = await h.state()
        assert.equal(current.session_state, 'interrupted')
        assert.equal(current.capability_sha256, null)
        await assert.rejects(
          runSessionTurn(h.deps('normal'), h.session.attempt, new AbortController().signal),
          /session_not_queued/,
        )
      } finally {
        await h.dispose()
      }
    },
  )

  test(
    `${provider}: a child that ignores SIGTERM is reaped and the session is interrupted`,
    { timeout: 60000 },
    async () => {
      const h = await sessionHarness(provider)
      try {
        const shutdown = new AbortController()
        const running = runSessionTurn(h.deps('ignore-sigterm'), h.session.attempt, shutdown.signal)
        const deadline = Date.now() + 20000
        while (
          !(await h.events()).some((event) => event.event === 'tool') &&
          Date.now() < deadline
        ) {
          await delay(50)
        }
        shutdown.abort()
        assert.equal(await running, 'interrupted')
        const current = await h.state()
        assert.equal(current.session_state, 'interrupted')
        assert.equal(current.capability_sha256, null)
      } finally {
        await h.dispose()
      }
    },
  )
}

for (const provider of ['claude', 'codex'] as const) {
  test(
    `${provider}: cancelling a running session aborts the child and frees its slot`,
    { timeout: 60000 },
    async () => {
      const h = await sessionHarness(provider)
      try {
        const running = runSessionTurn(
          h.deps('hold'),
          h.session.attempt,
          new AbortController().signal,
        )
        const deadline = Date.now() + 20000
        while (
          !(await h.events()).some((event) => event.event === 'holding') &&
          Date.now() < deadline
        ) {
          await delay(50)
        }
        const job = await h.fixture.db.pool.query<{ revision: string }>(
          'SELECT revision::text FROM processing_job WHERE id=$1',
          [h.session.job],
        )
        const cancelled = await h.fixture.http(
          `/batches/${h.session.manifest.batch_id}/processing/${h.session.job}/cancellation`,
          { expected_revision: job.rows[0].revision, attempt_id: h.session.attempt },
        )
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.value))
        assert.equal(await running, 'cancelled')
        const current = await h.state()
        assert.equal(current.session_state, 'cancelled')
        assert.equal(current.capability_sha256, null)
        const slots = await h.fixture.db.pool.query(
          'SELECT 1 FROM agent_slot WHERE attempt_id IS NOT NULL',
        )
        assert.equal(slots.rowCount, 0)
        const attempt = await h.fixture.db.pool.query<{ state: string }>(
          'SELECT state FROM processing_attempt WHERE id=$1',
          [h.session.attempt],
        )
        assert.equal(attempt.rows[0].state, 'cancelled')
      } finally {
        await h.dispose()
      }
    },
  )
}

test('a queued session cancelled before its claim never runs', { timeout: 60000 }, async () => {
  const h = await sessionHarness('claude')
  try {
    await h.fixture.db.pool.query("UPDATE processing_attempt SET state='cancelled' WHERE id=$1", [
      h.session.attempt,
    ])
    assert.equal(
      await runSessionTurn(h.deps('normal'), h.session.attempt, new AbortController().signal),
      'cancelled',
    )
    assert.equal((await h.state()).session_state, 'cancelled')
    assert.equal((await h.events()).length, 0)
  } finally {
    await h.dispose()
  }
})

test(
  'codex: a dedicated home with its own configuration is refused before start',
  { timeout: 60000 },
  async () => {
    const h = await sessionHarness('codex')
    try {
      const { writeFile: write, mkdir: makeDir } = await import('node:fs/promises')
      const home = join(h.stateRoot, 'codex-api')
      await makeDir(home, { recursive: true, mode: 0o700 })
      await write(join(home, 'config.toml'), 'model = "other"\n')
      assert.equal(
        await runSessionTurn(h.deps('normal'), h.session.attempt, new AbortController().signal),
        'failed',
      )
      assert.equal((await h.events()).length, 0)
    } finally {
      await h.dispose()
    }
  },
)

for (const mode of ['loose-policy', 'command-item', 'wrapped-call', 'server-request'] as const) {
  test(`codex: ${mode} is refused`, { timeout: 60000 }, async () => {
    const h = await sessionHarness('codex')
    try {
      assert.equal(
        await runSessionTurn(h.deps(mode), h.session.attempt, new AbortController().signal),
        'failed',
      )
      const current = await h.state()
      assert.equal(current.session_state, 'failed')
      assert.equal(current.capability_sha256, null)
    } finally {
      await h.dispose()
    }
  })
}

for (const provider of ['claude', 'codex'] as const) {
  test(
    `${provider}: chat accepted during the turn is acknowledged when the turn succeeds`,
    { timeout: 60000 },
    async () => {
      const h = await sessionHarness(provider)
      try {
        const running = runSessionTurn(
          h.deps('deliver-no-ack'),
          h.session.attempt,
          new AbortController().signal,
        )
        const deadline = Date.now() + 20000
        while ((await h.state()).session_state !== 'running' && Date.now() < deadline) {
          await delay(50)
        }
        const receipt = await h.chat('chat-1', 'The reel is 1k ohm.')
        // Without a read_inbox call the turn still settles finished, not queued again.
        assert.equal(await running, 'finished')
        const cursor = await h.fixture.db.pool.query<{ acked_seq: string }>(
          'SELECT acked_seq FROM agent_session_cursor WHERE session_lineage_id=$1',
          [h.session.job],
        )
        assert.equal(cursor.rows[0].acked_seq, receipt.seq)
      } finally {
        await h.dispose()
      }
    },
  )
}

test(
  'a shutdown during the claim settles the session without starting a child',
  { timeout: 60000 },
  async () => {
    const h = await sessionHarness('claude')
    try {
      const shutdown = new AbortController()
      shutdown.abort()
      assert.equal(
        await runSessionTurn(h.deps('normal'), h.session.attempt, shutdown.signal),
        'interrupted',
      )
      assert.equal((await h.events()).length, 0)
      const slots = await h.fixture.db.pool.query(
        'SELECT 1 FROM agent_slot WHERE attempt_id IS NOT NULL',
      )
      assert.equal(slots.rowCount, 0)
    } finally {
      await h.dispose()
    }
  },
)

test(
  'a turn whose attempt is superseded leaves its delivered chat pending',
  { timeout: 60000 },
  async () => {
    const h = await sessionHarness('claude')
    try {
      const running = runSessionTurn(
        h.deps('deliver-no-ack'),
        h.session.attempt,
        new AbortController().signal,
      )
      const deadline = Date.now() + 20000
      while ((await h.state()).session_state !== 'running' && Date.now() < deadline) {
        await delay(50)
      }
      await h.chat('chat-1', 'The reel is 1k ohm.')
      await h.fixture.db.pool.query(
        "UPDATE processing_attempt SET state='superseded' WHERE id=$1",
        [h.session.attempt],
      )
      await running
      const cursor = await h.fixture.db.pool.query<{ acked_seq: string }>(
        'SELECT acked_seq FROM agent_session_cursor WHERE session_lineage_id=$1',
        [h.session.job],
      )
      assert.equal(cursor.rows[0]?.acked_seq ?? '0', '0')
    } finally {
      await h.dispose()
    }
  },
)

for (const provider of ['claude', 'codex'] as const) {
  test(
    `${provider}: a turn that stays alive past its deadline is reaped and fails`,
    { timeout: 60000 },
    async () => {
      const h = await sessionHarness(provider)
      try {
        assert.equal(
          await runSessionTurn(
            h.deps('hold', 1500),
            h.session.attempt,
            new AbortController().signal,
          ),
          'failed',
        )
        const current = await h.state()
        assert.equal(current.session_state, 'failed')
        assert.equal(current.capability_sha256, null)
        const slots = await h.fixture.db.pool.query(
          'SELECT 1 FROM agent_slot WHERE attempt_id IS NOT NULL',
        )
        assert.equal(slots.rowCount, 0)
      } finally {
        await h.dispose()
      }
    },
  )
}

for (const provider of ['claude', 'codex'] as const) {
  test(
    `${provider}: an unqualified executable never starts a turn`,
    { timeout: 60000 },
    async () => {
      const h = await sessionHarness(provider)
      try {
        assert.equal(
          await runSessionTurn(
            h.deps('unknown-version'),
            h.session.attempt,
            new AbortController().signal,
          ),
          'failed',
        )
        assert.equal(
          (await h.events()).some((event) => event.event === 'opening'),
          false,
        )
        const retained = await h.fixture.db.pool.query(
          'SELECT diagnostic FROM agent_session_failure WHERE attempt_id=$1',
          [h.session.attempt],
        )
        assert.equal(retained.rows[0].diagnostic.category, 'configuration')
        assert.equal(retained.rows[0].diagnostic.code, 'agent_version_unqualified')
        assert.equal(
          retained.rows[0].diagnostic.cli_version,
          provider === 'claude' ? '2.1.320' : '0.166.1',
        )
        assert.equal(retained.rows[0].diagnostic.stage, 'startup')
      } finally {
        await h.dispose()
      }
    },
  )
  test(
    `${provider}: a legacy conversation preserves pending input without starting resume`,
    { timeout: 90000 },
    async () => {
      const h = await sessionHarness(provider)
      try {
        assert.equal(
          await runSessionTurn(h.deps('normal'), h.session.attempt, new AbortController().signal),
          'finished',
        )
        const directory = join(h.stateRoot, 'sessions', h.session.job)
        for (const name of await readdir(directory)) {
          if (name.startsWith('admission-')) await unlink(join(directory, name))
        }
        const receipt = await h.chat('legacy-chat', 'Please keep this pending.')
        await transaction(h.fixture.runner.pool, (client) =>
          queueSessionResume(client, h.session.job),
        )
        assert.equal(
          await runSessionTurn(h.deps('normal'), h.session.attempt, new AbortController().signal),
          'resume_unavailable',
        )
        assert.equal(
          (await h.events()).some((event) => event.event === 'resume'),
          false,
        )
        const cursor = await h.fixture.db.pool.query<{ acked_seq: string }>(
          'SELECT acked_seq FROM agent_session_cursor WHERE session_lineage_id=$1',
          [h.session.job],
        )
        assert.ok(BigInt(cursor.rows[0]?.acked_seq ?? '0') < BigInt(receipt.seq))
      } finally {
        await h.dispose()
      }
    },
  )
}
for (const mode of ['code-mode', 'skills-enabled'] as const) {
  test(`codex: ${mode} drift is refused before inference`, { timeout: 60000 }, async () => {
    const h = await sessionHarness('codex')
    try {
      assert.equal(
        await runSessionTurn(h.deps(mode), h.session.attempt, new AbortController().signal),
        'failed',
      )
      assert.equal(
        (await h.events()).some((event) => event.event === 'opening'),
        false,
      )
    } finally {
      await h.dispose()
    }
  })
}

test('claude: deferred tool calls are refused', { timeout: 60000 }, async () => {
  const h = await sessionHarness('claude')
  try {
    assert.equal(
      await runSessionTurn(
        h.deps('deferred-call'),
        h.session.attempt,
        new AbortController().signal,
      ),
      'failed',
    )
  } finally {
    await h.dispose()
  }
})

test(
  'codex: resumed configuration drift does not consume pending input',
  { timeout: 90000 },
  async () => {
    const h = await sessionHarness('codex')
    try {
      assert.equal(
        await runSessionTurn(h.deps('normal'), h.session.attempt, new AbortController().signal),
        'finished',
      )
      const receipt = await h.chat('drift-chat', 'Do not lose this')
      await transaction(h.fixture.runner.pool, (client) =>
        queueSessionResume(client, h.session.job),
      )
      assert.equal(
        await runSessionTurn(h.deps('code-mode'), h.session.attempt, new AbortController().signal),
        'failed',
      )
      assert.equal((await h.events()).filter((event) => event.event === 'opening').length, 1)
      const cursor = await h.fixture.db.pool.query<{ acked_seq: string }>(
        'SELECT acked_seq FROM agent_session_cursor WHERE session_lineage_id=$1',
        [h.session.job],
      )
      assert.ok(BigInt(cursor.rows[0]?.acked_seq ?? '0') < BigInt(receipt.seq))
    } finally {
      await h.dispose()
    }
  },
)

test('claude: effective skill injection is refused', { timeout: 60000 }, async () => {
  const h = await sessionHarness('claude')
  try {
    assert.equal(
      await runSessionTurn(
        h.deps('skills-enabled'),
        h.session.attempt,
        new AbortController().signal,
      ),
      'failed',
    )
  } finally {
    await h.dispose()
  }
})

test(
  'a paused batch keeps its queued chat across a worker restart and runs it once resumed',
  { timeout: 90000 },
  async () => {
    const { setBatchPause } = await import('#/agents/pause.ts')
    const h = await sessionHarness('claude')
    try {
      assert.equal(
        await runSessionTurn(h.deps('normal'), h.session.attempt, new AbortController().signal),
        'finished',
      )
      const batchId = h.session.manifest.batch_id
      await setBatchPause(h.fixture.api.pool, h.fixture.config, batchId, true)
      await h.chat('chat-1', 'Please check the back label.')
      await transaction(h.fixture.runner.pool, (client) =>
        queueSessionResume(client, h.session.job),
      )
      const seen = (await h.events()).length
      assert.equal(
        await runSessionTurn(h.deps('reply'), h.session.attempt, new AbortController().signal),
        'queued',
      )
      // A worker restart interrupts nothing and starts nothing while the batch is paused.
      assert.deepEqual(await interruptRunningSessions(h.fixture.runner.pool, h.fixture.config), [])
      assert.equal(
        await runSessionTurn(h.deps('reply'), h.session.attempt, new AbortController().signal),
        'queued',
      )
      assert.equal((await h.events()).length, seen)
      assert.equal((await h.state()).session_state, 'queued')
      const inbox = await h.fixture.db.pool.query(
        'SELECT 1 FROM agent_session_inbox WHERE session_lineage_id=$1',
        [h.session.job],
      )
      assert.equal(inbox.rowCount, 1)

      await setBatchPause(h.fixture.api.pool, h.fixture.config, batchId, false)
      assert.equal(
        await runSessionTurn(h.deps('reply'), h.session.attempt, new AbortController().signal),
        'finished',
      )
      const openings = (await h.events()).filter((event) => event.event === 'opening')
      assert.match(String(openings.at(-1)?.text), /1 new inbox item/)
    } finally {
      await h.dispose()
    }
  },
)
