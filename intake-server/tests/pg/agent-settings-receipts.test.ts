import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentSettingsUpdateDto } from '@invimport/contracts'
import { agentsClient, IntakeRequestError } from '@invimport/contracts/client'
import { processingFixture } from '../support/processing.ts'
import { requestProcessingFixtureJson } from '../support/processing-http.ts'
import { singleProvider } from '../support/agent-settings.ts'
import { readAgentSettings, saveAgentSettings } from '#/agents/settings.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

const CLAUDE = {
  provider: 'claude',
  authentication: 'api_key',
  model: 'claude-sonnet-5-5',
} as const

function update(expected_revision: string, session_concurrency = 3): AgentSettingsUpdateDto {
  return singleProvider({ expected_revision, selection: CLAUDE, session_concurrency })
}

async function receipts(fixture: Fixture) {
  const result = await fixture.db.pool.query<{
    save_id: string
    base_revision: string
    revision: string
    payload_sha256: Buffer
  }>(
    `SELECT save_id, base_revision::text, revision::text, payload_sha256
     FROM agent_settings_save_receipt
     ORDER BY agent_settings_save_receipt.revision`,
  )
  return result.rows
}

async function prunedThrough(fixture: Fixture) {
  const result = await fixture.db.pool.query<{ through: string }>(
    'SELECT receipts_pruned_through::text AS through FROM agent_settings',
  )
  return result.rows[0]?.through
}

const save = (fixture: Fixture, input: AgentSettingsUpdateDto) =>
  saveAgentSettings(fixture.api.pool, fixture.config, input)

test('a save writes its receipt in the same transaction, and a refused save writes none', async () => {
  const fixture = await processingFixture()
  try {
    const first = update('0', 2)
    const saved = await save(fixture, first)
    assert.equal(saved.revision, '1')
    const [receipt] = await receipts(fixture)
    assert.equal(receipt.save_id, first.save_id)
    assert.equal(receipt.base_revision, '0')
    assert.equal(receipt.revision, '1')
    assert.equal(receipt.payload_sha256.length, 32)

    await assert.rejects(save(fixture, update('0', 4)), { message: 'revision_conflict' })
    await assert.rejects(save(fixture, { ...update('1'), default_provider: null }), {
      message: 'invalid_agent_settings',
    })
    assert.equal((await receipts(fixture)).length, 1)
  } finally {
    await fixture.dispose()
  }
})

test('a resend of an applied save returns its receipt without applying, also after another tab saved', async () => {
  const fixture = await processingFixture()
  try {
    await save(fixture, update('0'))
    const mine = update('1', 5)
    await save(fixture, mine)
    const replay = { save_id: mine.save_id, revision: '2', replayed: true }
    assert.deepEqual(await save(fixture, mine), replay)
    assert.equal((await readAgentSettings(fixture.api.pool, fixture.config)).revision, '2')

    // The acknowledgement was lost, and another tab saved after it.
    await save(fixture, update('2', 7))
    assert.deepEqual(await save(fixture, mine), replay)
    const current = await readAgentSettings(fixture.api.pool, fixture.config)
    assert.equal(current.revision, '3')
    assert.equal(current.session_concurrency, 7)
    assert.equal((await receipts(fixture)).length, 3)
  } finally {
    await fixture.dispose()
  }
})

test('a resend with other fields, or equal fields over another base revision, is refused', async () => {
  const fixture = await processingFixture()
  try {
    await save(fixture, update('0'))
    const mine = update('1', 5)
    await save(fixture, mine)
    for (const changed of [
      { ...mine, session_concurrency: 6 },
      { ...mine, expected_revision: '2' },
    ]) {
      await assert.rejects(save(fixture, changed), { message: 'save_receipt_mismatch' })
    }
    const current = await readAgentSettings(fixture.api.pool, fixture.config)
    assert.equal(current.revision, '2')
    assert.equal(current.session_concurrency, 5)
  } finally {
    await fixture.dispose()
  }
})

test('a duplicate racing the original applies once', async () => {
  const fixture = await processingFixture()
  try {
    await save(fixture, update('0'))
    const mine = update('1', 6)
    const answers = await Promise.all([save(fixture, mine), save(fixture, mine)])
    const replays = answers.filter((answer) => 'replayed' in answer)
    assert.equal(replays.length, 1)
    assert.deepEqual(
      answers.map((answer) => answer.revision),
      ['2', '2'],
    )
    assert.equal((await readAgentSettings(fixture.api.pool, fixture.config)).revision, '2')
    assert.equal((await receipts(fixture)).length, 2)
  } finally {
    await fixture.dispose()
  }
})

test('two concurrent first saves with one ID apply once, with no conflict', async () => {
  const fixture = await processingFixture()
  try {
    const first = update('0', 4)
    const answers = await Promise.all([save(fixture, first), save(fixture, first)])
    assert.equal(answers.filter((answer) => 'replayed' in answer).length, 1)
    assert.deepEqual(
      answers.map((answer) => answer.revision),
      ['1', '1'],
    )
    assert.equal((await receipts(fixture)).length, 1)
  } finally {
    await fixture.dispose()
  }
})

test('pruning by count keeps the newest 200, and a resend below the watermark is unknown', async () => {
  const fixture = await processingFixture()
  try {
    const sent: AgentSettingsUpdateDto[] = []
    for (let revision = 0; revision < 201; revision++) {
      const next = update(String(revision), (revision % 8) + 1)
      sent.push(next)
      await save(fixture, next)
    }
    const kept = await receipts(fixture)
    assert.equal(kept.length, 200)
    assert.equal(kept[0].revision, '2')
    assert.equal(await prunedThrough(fixture), '1')

    await assert.rejects(save(fixture, sent[0]), { message: 'save_outcome_unknown' })
    // A kept receipt still answers, and a save that never applied at or above the watermark is a
    // definite conflict.
    assert.equal((await save(fixture, sent[1])).revision, '2')
    await assert.rejects(save(fixture, update('1', 8)), { message: 'revision_conflict' })
    assert.equal((await readAgentSettings(fixture.api.pool, fixture.config)).revision, '201')
  } finally {
    await fixture.dispose()
  }
})

test('pruning by age drops receipts older than seven days and advances the watermark', async () => {
  const fixture = await processingFixture()
  try {
    const old = update('0', 2)
    await save(fixture, old)
    await fixture.db.pool.query(
      `UPDATE agent_settings_save_receipt SET saved_at = now() - interval '8 days'`,
    )
    await save(fixture, update('1', 3))
    assert.deepEqual(
      (await receipts(fixture)).map((receipt) => receipt.revision),
      ['2'],
    )
    assert.equal(await prunedThrough(fixture), '1')
    await assert.rejects(save(fixture, old), { message: 'save_outcome_unknown' })
    assert.equal((await readAgentSettings(fixture.api.pool, fixture.config)).revision, '2')
  } finally {
    await fixture.dispose()
  }
})

test('the replay and save_outcome_unknown reach the generated client through the route', async () => {
  const fixture = await processingFixture()
  try {
    const bootstrap = await requestProcessingFixtureJson(fixture.config.origin, '/bootstrap')
    // The browser sends its own Origin; Node's fetch does not.
    const transport: typeof fetch = (input, init) =>
      fetch(input, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          origin: fixture.config.origin,
        },
      })
    const client = agentsClient(fixture.config.origin, bootstrap.value.csrf_token, transport)

    const first = update('0', 2)
    const saved = await client.saveSettings(first)
    assert.ok(!('replayed' in saved))
    assert.equal(saved.session_concurrency, 2)
    assert.deepEqual(await client.saveSettings(first), {
      save_id: first.save_id,
      revision: '1',
      replayed: true,
    })

    await fixture.db.pool.query(
      `UPDATE agent_settings_save_receipt SET saved_at = now() - interval '8 days'`,
    )
    await client.saveSettings(update('1', 3))
    await assert.rejects(client.saveSettings(first), (error: unknown) => {
      assert.ok(error instanceof IntakeRequestError)
      assert.equal(error.code, 'save_outcome_unknown')
      assert.equal(error.status, 409)
      return true
    })
    await assert.rejects(client.saveSettings(update('1', 4)), (error: unknown) => {
      assert.ok(error instanceof IntakeRequestError)
      assert.equal(error.code, 'revision_conflict')
      assert.equal(error.status, 412)
      return true
    })
  } finally {
    await fixture.dispose()
  }
})

test('only the API role can read and write receipts', async () => {
  const fixture = await processingFixture()
  try {
    const privileges = async (role: string) => {
      const result = await fixture.db.pool.query<{ privilege: string; granted: boolean }>(
        `SELECT privilege, has_table_privilege($1, 'agent_settings_save_receipt', privilege) AS granted
         FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS privilege`,
        [role],
      )
      return Object.fromEntries(result.rows.map((row) => [row.privilege, row.granted]))
    }
    assert.deepEqual(await privileges(fixture.api.name), {
      SELECT: true,
      INSERT: true,
      UPDATE: false,
      DELETE: true,
    })
    for (const role of [fixture.runner.name, fixture.writer.name]) {
      assert.deepEqual(await privileges(role), {
        SELECT: false,
        INSERT: false,
        UPDATE: false,
        DELETE: false,
      })
    }
    const watermark = await fixture.db.pool.query<{ granted: boolean }>(
      `SELECT has_column_privilege($1, 'agent_settings', 'receipts_pruned_through', 'UPDATE') AS granted`,
      [fixture.api.name],
    )
    assert.equal(watermark.rows[0].granted, true)
  } finally {
    await fixture.dispose()
  }
})
