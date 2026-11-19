import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentSettingsDto,
  AgentSettingsUpdateDto,
  ProcessingInputV6Dto,
} from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { seedPhoto } from '../support/sessions.ts'
import { singleProvider } from '../support/agent-settings.ts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import { readAgentSettings, saveAgentSettings, unsavedAgentSettings } from '#/agents/settings.ts'
import { transaction } from '#/db/database.ts'
import { migrate } from '#/operations/migrate.ts'
import { reserveProcessingMedia } from '#/processing/media.ts'
import { createSessionAttempt } from '#/processing/session-attempts.ts'
import { decodeSessionInput } from '#/processing/session-input.ts'
import { triggerExamine } from '#/processing/examine-trigger.ts'
import { startProcessing } from '#/processing/commands.ts'
import { nativeProfileId } from '#/agents/policy.ts'
import { sessionProfiles } from '#/processing/session-policy.ts'
import { openingText, runSessionTurn } from '#/agents/session/session-runner.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

/** Claude on with subscription sign-in as the default, Codex on with an API key. */
function bothProviders(expected_revision: string): AgentSettingsUpdateDto {
  return {
    expected_revision,
    providers: {
      claude: { enabled: true, authentication: 'subscription', default_model: 'sonnet' },
      codex: { enabled: true, authentication: 'api_key', default_model: 'gpt-6.1-sol' },
    },
    default_provider: 'claude',
    stage_selections: { research: { provider: 'codex', model: 'gpt-6-luna' } },
    session_concurrency: 2,
    new_batch_instructions: 'Count reels by their labels.',
    part_description_style: 'Type, key values, package, then variant',
    auto_tags_default: true,
  }
}

const legacyColumns = async (fixture: Fixture) =>
  (
    await fixture.db.pool.query<{ provider: string; authentication: string; model: string }>(
      'SELECT provider,authentication,model FROM agent_settings',
    )
  ).rows[0]

/** Queues one session attempt for a lot at a stage, the way Processing does. */
async function queueLotAttempt(
  fixture: Fixture,
  capture: Awaited<ReturnType<Fixture['seedCapture']>>,
  lotId: string,
  stage: 'research' | 'images',
  settings?: AgentSettingsDto,
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
      { settings },
    )
    await client.query(
      `INSERT INTO processing_job(id,batch_id,subject_id,stage,current_attempt_id,state)
       VALUES($1,$2,$3,$4,$5,'queued')`,
      [jobId, capture.batch.id, lotId, stage, attempt.attemptId],
    )
    return attempt
  })
}

async function sealedInput(fixture: Fixture, inputId: string): Promise<ProcessingInputV6Dto> {
  const row = await fixture.db.pool.query<{ manifest_bytes: Buffer; manifest_digest: Buffer }>(
    'SELECT manifest_bytes,manifest_digest FROM processing_input WHERE id=$1',
    [inputId],
  )
  return decodeSessionInput(row.rows[0].manifest_bytes, row.rows[0].manifest_digest)
}

test('both providers, step choices and the new fields round-trip under one revision', async () => {
  const fixture = await processingFixture()
  try {
    const saved = await saveAgentSettings(fixture.api.pool, fixture.config, bothProviders('0'))
    const { expected_revision: _, ...fields } = bothProviders('0')
    assert.deepEqual(saved, { revision: '1', ...fields })
    assert.deepEqual(await readAgentSettings(fixture.api.pool, fixture.config), saved)
    // The rollback columns follow the default provider.
    assert.deepEqual(await legacyColumns(fixture), {
      provider: 'claude',
      authentication: 'subscription',
      model: 'sonnet',
    })
    await assert.rejects(saveAgentSettings(fixture.api.pool, fixture.config, bothProviders('0')), {
      message: 'revision_conflict',
    })
    const next = await saveAgentSettings(fixture.api.pool, fixture.config, {
      ...bothProviders('1'),
      default_provider: 'codex',
    })
    assert.equal(next.revision, '2')
    assert.deepEqual(await legacyColumns(fixture), {
      provider: 'codex',
      authentication: 'api_key',
      model: 'gpt-6.1-sol',
    })
  } finally {
    await fixture.dispose()
  }
})

test('settings that could seal an unusable selection are refused and change nothing', async () => {
  const fixture = await processingFixture()
  try {
    await saveAgentSettings(fixture.api.pool, fixture.config, bothProviders('0'))
    const base = bothProviders('1')
    const off = { ...base.providers.codex, enabled: false }
    const cases: [string, AgentSettingsUpdateDto][] = [
      ['a provider on with no default', { ...base, default_provider: null }],
      [
        'the default provider off',
        {
          ...base,
          providers: { ...base.providers, codex: off },
          default_provider: 'codex',
          stage_selections: {},
        },
      ],
      [
        'no provider on but a default set',
        {
          ...base,
          providers: { claude: { ...base.providers.claude, enabled: false }, codex: off },
          stage_selections: {},
        },
      ],
      [
        'a step on a provider that is off',
        { ...base, providers: { ...base.providers, codex: off } },
      ],
      [
        'a provider on with an invalid model',
        {
          ...base,
          providers: {
            ...base.providers,
            claude: { ...base.providers.claude, default_model: 'not a model' },
          },
        },
      ],
      [
        'a step with an invalid model',
        { ...base, stage_selections: { images: { provider: 'claude', model: '' } } },
      ],
    ]
    for (const [name, input] of cases) {
      await assert.rejects(
        saveAgentSettings(fixture.api.pool, fixture.config, input),
        { message: 'invalid_agent_settings' },
        name,
      )
    }
    assert.equal((await readAgentSettings(fixture.api.pool, fixture.config)).revision, '1')
  } finally {
    await fixture.dispose()
  }
})

test('a first save with no provider on keeps other settings and valid rollback columns', async () => {
  const fixture = await processingFixture()
  try {
    const { revision, ...fields } = unsavedAgentSettings()
    const saved = await saveAgentSettings(fixture.api.pool, fixture.config, {
      ...fields,
      expected_revision: revision,
      new_batch_instructions: 'Count reels by their labels.',
    })
    assert.equal(saved.revision, '1')
    assert.equal(saved.default_provider, null)
    assert.equal(saved.new_batch_instructions, 'Count reels by their labels.')
    assert.deepEqual(await legacyColumns(fixture), {
      provider: 'claude',
      authentication: 'subscription',
      model: 'sonnet',
    })
  } finally {
    await fixture.dispose()
  }
})

test('a style over 500 characters is refused and nothing is saved', async () => {
  const fixture = await processingFixture()
  try {
    await assert.rejects(
      saveAgentSettings(fixture.api.pool, fixture.config, {
        ...bothProviders('0'),
        part_description_style: 'x'.repeat(501),
      }),
      { message: 'invalid_contract' },
    )
    assert.equal((await readAgentSettings(fixture.api.pool, fixture.config)).revision, '0')
  } finally {
    await fixture.dispose()
  }
})

test('each step seals its own provider, sign-in and model, and the style, at queue time', async () => {
  const fixture = await processingFixture()
  try {
    await saveAgentSettings(fixture.api.pool, fixture.config, bothProviders('0'))
    const capture = await fixture.seedCapture()
    const research = await queueLotAttempt(fixture, capture, capture.packetA.id, 'research')
    const images = await queueLotAttempt(fixture, capture, capture.packetB.id, 'images')
    // A save while both wait for a slot changes neither.
    await saveAgentSettings(fixture.api.pool, fixture.config, {
      ...bothProviders('1'),
      part_description_style: 'Something else entirely',
    })
    const researchInput = await sealedInput(fixture, research.inputId)
    const imagesInput = await sealedInput(fixture, images.inputId)
    assert.deepEqual(researchInput.agent, {
      provider: 'codex',
      authentication: 'api_key',
      model: 'gpt-6-luna',
    })
    assert.deepEqual(imagesInput.agent, {
      provider: 'claude',
      authentication: 'subscription',
      model: 'sonnet',
    })
    assert.equal(researchInput.settings_revision, '1')
    assert.equal(imagesInput.settings_revision, '1')
    assert.equal(researchInput.part_description_style, 'Type, key values, package, then variant')
    assert.equal(imagesInput.part_description_style, 'Type, key values, package, then variant')
  } finally {
    await fixture.dispose()
  }
})

test('with no style saved, the sealed input carries none', async () => {
  const fixture = await processingFixture()
  try {
    await saveAgentSettings(
      fixture.api.pool,
      fixture.config,
      singleProvider({
        expected_revision: '0',
        selection: { provider: 'claude', authentication: 'api_key', model: 'sonnet' },
      }),
    )
    const capture = await fixture.seedCapture()
    const attempt = await queueLotAttempt(fixture, capture, capture.packetA.id, 'research')
    assert.equal('part_description_style' in (await sealedInput(fixture, attempt.inputId)), false)
  } finally {
    await fixture.dispose()
  }
})

test('the Examine lead session uses the examine step choice', async () => {
  const fixture = await processingFixture({ profileId: 'native-agent/2' })
  try {
    await saveAgentSettings(fixture.api.pool, fixture.config, {
      ...bothProviders('0'),
      stage_selections: { examine: { provider: 'codex', model: 'gpt-6-astra' } },
    })
    const capture = await fixture.seedCapture()
    await seedPhoto(fixture, capture.batch.id, { width: 768, height: 512 })
    await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
    const lead = await fixture.db.pool.query<{ input_id: string }>(
      `SELECT a.input_id FROM processing_attempt a JOIN processing_job j ON j.id=a.job_id
       WHERE j.batch_id=$1 AND j.stage='examine'`,
      [capture.batch.id],
    )
    assert.equal(lead.rows.length, 1)
    assert.deepEqual((await sealedInput(fixture, lead.rows[0].input_id)).agent, {
      provider: 'codex',
      authentication: 'api_key',
      model: 'gpt-6-astra',
    })
  } finally {
    await fixture.dispose()
  }
})

const SETTINGS_MIGRATION = '0032_settings_debug_mode.sql'

async function migrateBeforeSettings(pool: import('pg').Pool) {
  const directory = new URL('../../migrations/', import.meta.url)
  await pool.query(
    'CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, sha256 text NOT NULL)',
  )
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}_[a-z_]+\.sql$/.test(name) && name < SETTINGS_MIGRATION)
    .sort()
  for (const name of names) {
    const sql = await readFile(new URL(name, directory), 'utf8')
    await pool.query(sql)
    await pool.query('INSERT INTO schema_migration VALUES ($1,$2)', [
      name,
      createHash('sha256').update(sql).digest('hex'),
    ])
  }
}

test('migration 0032 carries an existing selection over to its provider, on', async () => {
  const db = await isolatedDatabase({ migrate: false })
  try {
    await migrateBeforeSettings(db.pool)
    const identity = await seedAuthority(db.pool)
    const binding = {
      actorId: identity.actor,
      targetId: identity.target,
      targetContextId: identity.context,
    }
    // A model outside the suggestion lists carries over unchanged.
    await db.pool.query(
      `INSERT INTO agent_settings(actor_id,target_id,target_context_id,revision,provider,authentication,model,session_concurrency)
       VALUES($1,$2,$3,7,'codex','api_key','gpt-test-one',2)`,
      [identity.actor, identity.target, identity.context],
    )
    await migrate(db.pool)
    assert.deepEqual(await readAgentSettings(db.pool, binding), {
      revision: '7',
      providers: {
        claude: { enabled: false, authentication: 'subscription', default_model: 'sonnet' },
        codex: { enabled: true, authentication: 'api_key', default_model: 'gpt-test-one' },
      },
      default_provider: 'codex',
      stage_selections: {},
      session_concurrency: 2,
      new_batch_instructions: '',
      part_description_style: '',
      auto_tags_default: false,
    })
  } finally {
    await db.dispose()
  }
})

test('the style sealed at queue time reaches the opening turn only, outside the instructions', async () => {
  const fixture = await processingFixture()
  const root = await mkdtemp(join(tmpdir(), 'description-style-'))
  try {
    await saveAgentSettings(fixture.api.pool, fixture.config, bothProviders('0'))
    const capture = await fixture.seedCapture()
    // Images runs on the default provider, Claude.
    const attempt = await queueLotAttempt(fixture, capture, capture.packetA.id, 'images')
    // Saved while the attempt waits for a slot: it keeps the style it was queued with.
    await saveAgentSettings(fixture.api.pool, fixture.config, {
      ...bothProviders('1'),
      part_description_style: 'Something else entirely',
    })
    const turns: { text: string; instructions: string }[] = []
    const deps = {
      pool: fixture.runner.pool,
      config: fixture.config,
      host: { codexExecutable: 'unused', claudeExecutable: 'unused', stateRoot: root, env: {} },
      toolUrl: 'http://127.0.0.1:1/unused',
      drivers: {
        'native-agent/2': async (turn: { text: string; instructions: string }) => {
          turns.push({ text: turn.text, instructions: turn.instructions })
          throw new Error('stop after the opening turn')
        },
      },
    }
    await runSessionTurn(deps, attempt.attemptId, new AbortController().signal)
    assert.equal(turns.length, 1)
    const opening = JSON.parse(turns[0].text) as {
      part_description_style?: string
      instructions: string
    }
    const style = 'Type, key values, package, then variant'
    assert.equal(opening.part_description_style, style)
    assert.match(opening.instructions, /in the pattern part_description_style gives/)
    assert.equal(turns[0].instructions.includes(style), false)
    assert.equal(
      createHash('sha256').update(turns[0].instructions, 'utf8').digest('hex'),
      sessionProfiles['native-agent/2'].instructionDigest,
    )
    // A resumed turn carries only its inbox count.
    const resumed = openingText(await sealedInput(fixture, attempt.inputId), 1, true)
    assert.equal(resumed.includes(style), false)
  } finally {
    await fixture.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('each actor reads only its own provider rows', async () => {
  const fixture = await processingFixture()
  try {
    const other = randomUUID()
    await fixture.db.pool.query('INSERT INTO operator VALUES ($1,$2,$3)', [
      other,
      'development',
      `fixture-${other}`,
    ])
    const otherScope = { ...fixture.config, actorId: other }
    await saveAgentSettings(fixture.api.pool, fixture.config, bothProviders('0'))
    await saveAgentSettings(fixture.api.pool, otherScope, {
      ...bothProviders('0'),
      providers: {
        claude: { enabled: true, authentication: 'api_key', default_model: 'opus' },
        codex: { enabled: false, authentication: 'subscription', default_model: 'gpt-6-astra' },
      },
      stage_selections: {},
    })
    for (const lock of [false, true]) {
      const mine = await readAgentSettings(fixture.api.pool, fixture.config, lock)
      assert.deepEqual(mine.providers, bothProviders('0').providers, `lock ${lock}`)
      const theirs = await readAgentSettings(fixture.api.pool, otherScope, lock)
      assert.equal(theirs.providers.claude.default_model, 'opus')
      assert.equal(theirs.providers.codex.enabled, false)
    }
  } finally {
    await fixture.dispose()
  }
})

test('an attempt given a settings read seals that read, not a later save', async () => {
  const fixture = await processingFixture()
  try {
    await saveAgentSettings(fixture.api.pool, fixture.config, bothProviders('0'))
    const read = await readAgentSettings(fixture.api.pool, fixture.config)
    // Saved after the read: both providers off, no style.
    const { revision, ...off } = unsavedAgentSettings()
    await saveAgentSettings(fixture.api.pool, fixture.config, { ...off, expected_revision: '1' })
    const capture = await fixture.seedCapture()
    const attempt = await queueLotAttempt(fixture, capture, capture.packetA.id, 'research', read)
    const input = await sealedInput(fixture, attempt.inputId)
    assert.equal(revision, '0')
    assert.equal(input.settings_revision, '1')
    assert.deepEqual(input.agent, {
      provider: 'codex',
      authentication: 'api_key',
      model: 'gpt-6-luna',
    })
    assert.equal(input.part_description_style, 'Type, key values, package, then variant')
  } finally {
    await fixture.dispose()
  }
})

test("native-agent/1 seals each stage's own provider too", async () => {
  const fixture = await processingFixture({ profileId: nativeProfileId })
  try {
    await saveAgentSettings(fixture.api.pool, fixture.config, bothProviders('0'))
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
    assert.deepEqual(sealed.reading.agent, {
      provider: 'claude',
      authentication: 'subscription',
      model: 'sonnet',
    })
    assert.deepEqual(sealed.research.agent, {
      provider: 'codex',
      authentication: 'api_key',
      model: 'gpt-6-luna',
    })
    assert.equal(sealed.reading.settings_revision, '1')
    assert.equal(sealed.research.settings_revision, '1')
  } finally {
    await fixture.dispose()
  }
})

test('an over-long model or text with a NUL is an invalid settings error', async () => {
  const fixture = await processingFixture()
  try {
    const long = 'm'.repeat(129)
    const base = bothProviders('0')
    for (const input of [
      {
        ...base,
        stage_selections: { images: { provider: 'claude' as const, model: 'm'.repeat(2000) } },
      },
      { ...base, part_description_style: 'Type\u0000value' },
      { ...base, new_batch_instructions: 'Count\u0000reels' },
      { ...base, new_batch_instructions: 'Count \ud800 reels' },
      {
        ...base,
        providers: { ...base.providers, claude: { ...base.providers.claude, default_model: long } },
      },
      { ...base, stage_selections: { images: { provider: 'claude' as const, model: long } } },
    ]) {
      await assert.rejects(saveAgentSettings(fixture.api.pool, fixture.config, input), {
        message: 'invalid_agent_settings',
      })
    }
    assert.equal((await readAgentSettings(fixture.api.pool, fixture.config)).revision, '0')
  } finally {
    await fixture.dispose()
  }
})
