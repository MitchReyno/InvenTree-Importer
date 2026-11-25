import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  validate,
  type AgentSelectionDto,
  type AgentSettingsUpdateDto,
  type SessionHistoryDto,
  type SessionInputDto,
} from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
import { runSessionTurn } from '#/agents/session/session-runner.ts'
import { readAgentSettings, saveAgentSettings } from '#/agents/settings.ts'
import { transaction } from '#/db/database.ts'
import { reserveProcessingMedia } from '#/processing/media.ts'
import { createSessionAttempt } from '#/processing/session-attempts.ts'
import { decodeSessionInput } from '#/processing/session-input.ts'
import { startProcessing } from '#/processing/commands.ts'
import { nativeProfileId } from '#/agents/policy.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

/** Claude on as the default at High, Codex on with an API key at Medium; Research on Codex at Max. */
function withEfforts(
  expected_revision: string,
  save_id: string = randomUUID(),
): AgentSettingsUpdateDto {
  return {
    expected_revision,
    save_id,
    providers: {
      claude: {
        enabled: true,
        authentication: 'subscription',
        default_model: 'claude-opus-5-5',
        default_effort: 'high',
      },
      codex: {
        enabled: true,
        authentication: 'api_key',
        default_model: 'gpt-6.2-sol',
        default_effort: 'medium',
      },
    },
    default_provider: 'claude',
    stage_selections: { research: { provider: 'codex', model: 'gpt-6-luna', effort: 'max' } },
    session_concurrency: 2,
    new_batch_instructions: '',
    part_description_style: '',
    auto_tags_default: false,
    web: { public_pages: true, prefer_datasheets: true },
  }
}

/** The same choices with every effort on Default. */
function withoutEfforts(expected_revision: string): AgentSettingsUpdateDto {
  const settings = withEfforts(expected_revision)
  const { default_effort: _claude, ...claude } = settings.providers.claude
  const { default_effort: _codex, ...codex } = settings.providers.codex
  return {
    ...settings,
    providers: { claude, codex },
    stage_selections: { research: { provider: 'codex', model: 'gpt-6-luna' } },
  }
}

async function queueLotAttempt(
  fixture: Fixture,
  capture: Awaited<ReturnType<Fixture['seedCapture']>>,
  lotId: string,
  stage: 'research' | 'images',
) {
  return transaction(fixture.api.pool, async (client) => {
    const media = await reserveProcessingMedia(client, fixture.config, capture.batch, [lotId])
    const jobId = randomUUID()
    const attempt = await createSessionAttempt(
      client,
      fixture.config,
      'native-agent/2',
      capture.batch,
      { id: jobId, subject_id: lotId, stage },
      '1',
      media.get(lotId)!,
      null,
    )
    await client.query(
      `INSERT INTO processing_job(id,batch_id,subject_id,stage,current_attempt_id,state)
       VALUES($1,$2,$3,$4,$5,'queued')`,
      [jobId, capture.batch.id, lotId, stage, attempt.attemptId],
    )
    return attempt
  })
}

async function sealedInput(fixture: Fixture, inputId: string): Promise<SessionInputDto> {
  const row = await fixture.db.pool.query<{ manifest_bytes: Buffer; manifest_digest: Buffer }>(
    'SELECT manifest_bytes,manifest_digest FROM processing_input WHERE id=$1',
    [inputId],
  )
  return decodeSessionInput(row.rows[0].manifest_bytes, row.rows[0].manifest_digest)
}

test('step and provider efforts save, read back and replay through the save receipts', async () => {
  const fixture = await processingFixture()
  try {
    const first = withEfforts('0')
    const saved = await saveAgentSettings(fixture.api.pool, fixture.config, first)
    const { expected_revision: _revision, save_id: _saveId, ...fields } = first
    assert.deepEqual(saved, { revision: '1', ...fields })
    assert.deepEqual(await readAgentSettings(fixture.api.pool, fixture.config), saved)
    const stored = await fixture.db.pool.query<{ provider: string; default_effort: string }>(
      'SELECT provider,default_effort FROM agent_provider_settings ORDER BY provider',
    )
    assert.deepEqual(stored.rows, [
      { provider: 'claude', default_effort: 'high' },
      { provider: 'codex', default_effort: 'medium' },
    ])
    // A resend is answered from its receipt; the same save ID with another effort is refused.
    assert.deepEqual(await saveAgentSettings(fixture.api.pool, fixture.config, first), {
      save_id: first.save_id,
      revision: '1',
      replayed: true,
    })
    const changed = withEfforts('0', first.save_id)
    changed.providers.claude.default_effort = 'max'
    await assert.rejects(saveAgentSettings(fixture.api.pool, fixture.config, changed), {
      message: 'save_receipt_mismatch',
    })
    // Default clears a saved effort.
    const cleared = await saveAgentSettings(fixture.api.pool, fixture.config, withoutEfforts('1'))
    const { expected_revision: _next, save_id: _nextId, ...clearedFields } = withoutEfforts('1')
    assert.deepEqual(cleared, { revision: '2', ...clearedFields })
    const nulls = await fixture.db.pool.query(
      'SELECT 1 FROM agent_provider_settings WHERE default_effort IS NOT NULL',
    )
    assert.equal(nulls.rowCount, 0)
  } finally {
    await fixture.dispose()
  }
})

test('the column refuses an effort of the wrong shape, as the contract does', async () => {
  const fixture = await processingFixture()
  try {
    await saveAgentSettings(fixture.api.pool, fixture.config, withEfforts('0'))
    await assert.rejects(
      fixture.db.pool.query(
        "UPDATE agent_provider_settings SET default_effort='High' WHERE provider='claude'",
      ),
      { code: '23514' },
    )
  } finally {
    await fixture.dispose()
  }
})

test('an attempt seals the effort saved when it was queued, paired with its model', async () => {
  const fixture = await processingFixture()
  try {
    await saveAgentSettings(fixture.api.pool, fixture.config, withoutEfforts('0'))
    const capture = await fixture.seedCapture()
    const before = await queueLotAttempt(fixture, capture, capture.packetA.id, 'research')
    await saveAgentSettings(fixture.api.pool, fixture.config, withEfforts('1'))
    const research = await queueLotAttempt(fixture, capture, capture.packetB.id, 'research')
    const images = await queueLotAttempt(fixture, capture, capture.packetB.id, 'images')
    assert.deepEqual((await sealedInput(fixture, before.inputId)).agent, {
      provider: 'codex',
      authentication: 'api_key',
      model: 'gpt-6-luna',
    })
    assert.deepEqual((await sealedInput(fixture, research.inputId)).agent, {
      provider: 'codex',
      authentication: 'api_key',
      model: 'gpt-6-luna',
      effort: 'max',
    })
    // Images is on Default: the default provider's model with that provider's effort.
    assert.deepEqual((await sealedInput(fixture, images.inputId)).agent, {
      provider: 'claude',
      authentication: 'subscription',
      model: 'claude-opus-5-5',
      effort: 'high',
    })
    // A later save leaves both sealed attempts as they were.
    await saveAgentSettings(fixture.api.pool, fixture.config, withoutEfforts('2'))
    assert.equal((await sealedInput(fixture, research.inputId)).agent?.effort, 'max')
  } finally {
    await fixture.dispose()
  }
})

test('a native-agent/1 attempt seals its model with no effort, and its input refuses one', async () => {
  const fixture = await processingFixture({ profileId: nativeProfileId })
  try {
    await saveAgentSettings(fixture.api.pool, fixture.config, withEfforts('0'))
    const capture = await fixture.seedCapture()
    const queued = (await startProcessing(
      fixture.api.pool,
      fixture.config,
      capture.batch.id,
      randomUUID(),
      {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: capture.batch.revision,
        subject_ids: [capture.packetA.id],
        stages: ['reading', 'research'],
      },
    )) as { attempt_ids: string[] }
    const rows = await fixture.db.pool.query<{ stage: string; manifest_bytes: Buffer }>(
      `SELECT j.stage, i.manifest_bytes FROM processing_attempt a
       JOIN processing_job j ON j.id=a.job_id JOIN processing_input i ON i.id=a.input_id
       WHERE a.id = ANY($1::uuid[])`,
      [queued.attempt_ids],
    )
    const sealed = Object.fromEntries(
      rows.rows.map((row) => [row.stage, JSON.parse(row.manifest_bytes.toString('utf8'))]),
    )
    assert.equal(sealed.reading.schema_version, 'bench-intake-input/4')
    assert.deepEqual(sealed.reading.agent, {
      provider: 'claude',
      authentication: 'subscription',
      model: 'claude-opus-5-5',
    })
    assert.deepEqual(sealed.research.agent, {
      provider: 'codex',
      authentication: 'api_key',
      model: 'gpt-6-luna',
    })
    assert.throws(
      () =>
        validate('ProcessingInput', {
          ...sealed.research,
          agent: { ...sealed.research.agent, effort: 'max' },
        }),
      { message: 'invalid_contract' },
    )
  } finally {
    await fixture.dispose()
  }
})

/**
 * Runs one turn of a queued `native-agent/2` session (or a synthetic one) through the real
 * driver and the fake CLI in `mode`, and returns the session row's recorded effort.
 */
async function runSealedTurn(agent: AgentSelectionDto | null, mode = 'normal') {
  const profileId = agent ? 'native-agent/2' : 'synthetic-session/1'
  const fixture = await processingFixture({ profileId })
  const stateRoot = await mkdtemp(join(tmpdir(), 'agent-effort-'))
  const server = await startSessionToolServer({
    pool: fixture.runner.pool,
    config: fixture.config,
    statusIntervalMs: 0,
  })
  try {
    const executable = join(stateRoot, 'provider.cjs')
    const source = await readFile(new URL('../fixtures/session-agent.cjs', import.meta.url), 'utf8')
    await writeFile(executable, '#!/usr/bin/env node\n' + source)
    await chmod(executable, 0o755)
    const capture = await fixture.seedCapture()
    const session = await lotSession(fixture, capture, capture.packetA, {
      state: 'queued',
      profile: agent
        ? { id: 'native-agent/2', agent, settingsRevision: '1' }
        : { id: 'synthetic-session/1' },
    })
    const cwd = join(stateRoot, 'sessions', session.job)
    await mkdir(cwd, { recursive: true, mode: 0o700 })
    const log = join(stateRoot, 'events')
    await writeFile(join(cwd, 'fake-session.json'), JSON.stringify({ mode, log }))
    const outcome = await runSessionTurn(
      {
        pool: fixture.runner.pool,
        config: fixture.config,
        host: {
          codexExecutable: executable,
          claudeExecutable: executable,
          stateRoot,
          env: { PATH: process.env.PATH, OPENAI_API_KEY: 'test-key' },
        },
        toolUrl: server.url,
      },
      session.attempt,
      AbortSignal.timeout(30_000),
    )
    const row = await fixture.db.pool.query<{ sent_effort: string | null }>(
      'SELECT sent_effort FROM agent_session WHERE attempt_id=$1',
      [session.attempt],
    )
    const history = (
      await fixture.http(`/batches/${capture.batch.id}/processing/${session.job}/history`)
    ).value as SessionHistoryDto
    const events = (await readFile(log, 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    return {
      outcome,
      sentEffort: row.rows[0].sent_effort,
      read: history.session.attempts.find((attempt) => attempt.id === session.attempt),
      events,
    }
  } finally {
    await server.close()
    await fixture.dispose()
    await rm(stateRoot, { recursive: true, force: true })
  }
}

test('a session records the effort its turn passed to the CLI, and its read shows it', async () => {
  const run = await runSealedTurn({
    provider: 'claude',
    authentication: 'subscription',
    model: 'claude-opus-5-5',
    effort: 'high',
  })
  assert.equal(run.outcome, 'finished', JSON.stringify(run.events))
  assert.equal(run.events.find((event) => event.event === 'claude-args')?.effort, 'high')
  assert.equal(run.sentEffort, 'high')
  assert.equal(run.read?.sent_effort, 'high')
  assert.equal(run.read?.selection?.effort, 'high')
})

test('a session on Default records no effort', async () => {
  const run = await runSealedTurn({
    provider: 'codex',
    authentication: 'api_key',
    model: 'gpt-6.2-sol',
  })
  assert.equal(run.outcome, 'finished', JSON.stringify(run.events))
  assert.equal(run.sentEffort, null)
  assert.equal(run.read && 'sent_effort' in run.read, false)
})

test('a synthetic session records no effort', async () => {
  const run = await runSealedTurn(null)
  assert.equal(run.sentEffort, null)
  assert.equal(run.read && 'sent_effort' in run.read, false)
})

test('a Codex turn that fails between its start and turn/start records no effort', async () => {
  // The CLI names a model the session record refuses, so recording the start fails.
  const run = await runSealedTurn(
    { provider: 'codex', authentication: 'api_key', model: 'gpt-6.2-sol', effort: 'high' },
    'invalid-model',
  )
  assert.equal(run.outcome, 'failed')
  assert.ok(!run.events.some((event) => event.event === 'turn-start'))
  assert.equal(run.sentEffort, null)
})
