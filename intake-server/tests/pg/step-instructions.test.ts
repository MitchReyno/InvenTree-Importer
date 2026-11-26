import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AgentSettingsUpdateDto,
  BriefEntryDto,
  ProcessingInputV7Dto,
  SessionInputDto,
} from '@invimport/contracts'
import { formedBatch } from '../support/lot-pipeline.ts'
import { processingFixture } from '../support/processing.ts'
import { singleProvider } from '../support/agent-settings.ts'
import { seedPhoto } from '../support/sessions.ts'
import { readAgentSettings, saveAgentSettings } from '#/agents/settings.ts'
import { openingText, runSessionTurn } from '#/agents/session/session-runner.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import { transaction } from '#/db/database.ts'
import { assembleBrief } from '#/processing/brief.ts'
import { reserveProcessingMedia } from '#/processing/media.ts'
import { triggerExamine } from '#/processing/examine-trigger.ts'
import { createSessionAttempt } from '#/processing/session-attempts.ts'
import { briefScope, decodeSessionInput } from '#/processing/session-input.ts'
import { sessionProfiles } from '#/processing/session-policy.ts'
import { stagePacks } from '#/processing/stage-policy.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>

const RESEARCH_A = 'Open the manufacturer’s own datasheet before any distributor page.'
const RESEARCH_B = 'Record the datasheet revision and its date.'
const IMAGES = 'Keep the anti-static bag in the stock photo.'
const EXAMINE = 'Count reels by their labels, not by eye.'
const SELECTION = {
  provider: 'claude',
  authentication: 'api_key',
  model: 'claude-sonnet-5-5',
} as const
// One code point, two UTF-16 units.
const ASTRAL = '\u{1F50C}'

function withInstructions(
  expected_revision: string,
  stage_instructions: AgentSettingsUpdateDto['stage_instructions'],
  session_concurrency = 3,
) {
  return {
    ...singleProvider({ expected_revision, selection: SELECTION, session_concurrency }),
    stage_instructions,
  }
}

async function currentRevision(fixture: Fixture) {
  return (await readAgentSettings(fixture.api.pool, fixture.config)).revision
}

async function saveInstructions(
  fixture: Fixture,
  stageInstructions: AgentSettingsUpdateDto['stage_instructions'],
  sessionConcurrency = 3,
) {
  return saveAgentSettings(
    fixture.api.pool,
    fixture.config,
    withInstructions(await currentRevision(fixture), stageInstructions, sessionConcurrency),
  )
}

/** Queues one session attempt for a lot at a stage, the way Processing does. */
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

async function inputOf(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{
    id: string
    manifest_bytes: Buffer
    manifest_digest: Buffer
  }>(
    `SELECT i.id,i.manifest_bytes,i.manifest_digest FROM processing_attempt a
     JOIN processing_input i ON i.id=a.input_id WHERE a.id=$1`,
    [attemptId],
  )
  const row = rows.rows[0]
  return {
    id: row.id,
    digest: row.manifest_digest.toString('hex'),
    manifest: decodeSessionInput(row.manifest_bytes, row.manifest_digest),
  }
}

async function inboxCount(fixture: Fixture) {
  const rows = await fixture.db.pool.query<{ count: string }>(
    'SELECT count(*) FROM agent_session_inbox',
  )
  return Number(rows.rows[0].count)
}

function guidanceOf(entries: readonly BriefEntryDto[]) {
  return entries.filter((entry) => entry.kind === 'step_guidance')
}

function briefEntries(manifest: SessionInputDto) {
  assert.equal(manifest.schema_version, 'bench-intake-input/7')
  return (manifest as ProcessingInputV7Dto).brief.pages.flatMap((page) => page.entries ?? [])
}

test('each step’s instructions save with the revision check, within 1,000 characters', async () => {
  const fixture = await processingFixture()
  try {
    const first = await saveInstructions(fixture, { research: RESEARCH_A, images: IMAGES })
    assert.ok(!('replayed' in first))
    assert.deepEqual(first.stage_instructions, { research: RESEARCH_A, images: IMAGES })
    assert.deepEqual(
      (await readAgentSettings(fixture.api.pool, fixture.config)).stage_instructions,
      {
        research: RESEARCH_A,
        images: IMAGES,
      },
    )
    // 1,000 characters fit, whatever their UTF-16 length.
    const full = await saveInstructions(fixture, { examine: ASTRAL.repeat(1000) })
    assert.ok(!('replayed' in full))
    assert.equal(full.stage_instructions.examine, ASTRAL.repeat(1000))
    const saved = await currentRevision(fixture)
    for (const [refused, code] of [
      [{ research: 'x'.repeat(1001) }, 'invalid_agent_settings'],
      [{ research: `${ASTRAL.repeat(1000)}x` }, 'invalid_agent_settings'],
      [{ research: 'Datasheet\u0000first' }, 'invalid_agent_settings'],
      [{ inventory: 'Count the reels.' }, 'invalid_contract'],
      [{ research: '' }, 'invalid_contract'],
    ] as const) {
      await assert.rejects(
        saveAgentSettings(
          fixture.api.pool,
          fixture.config,
          withInstructions(saved, refused as AgentSettingsUpdateDto['stage_instructions']),
        ),
        { message: code },
        JSON.stringify(refused).slice(0, 40),
      )
    }
    assert.equal(await currentRevision(fixture), saved)
    // An empty box is saved as no key: the step has no instructions.
    const cleared = await saveInstructions(fixture, {})
    assert.ok(!('replayed' in cleared))
    assert.deepEqual(cleared.stage_instructions, {})
  } finally {
    await fixture.dispose()
  }
})

test('a step’s attempt seals its own text at queue time, and an edit reaches only later work', async () => {
  const fixture = await processingFixture()
  try {
    await saveInstructions(fixture, { research: RESEARCH_A })
    const capture = await fixture.seedCapture()
    const research = await queueLotAttempt(fixture, capture, capture.packetA.id, 'research')
    const images = await queueLotAttempt(fixture, capture, capture.packetB.id, 'images')
    const before = await inputOf(fixture, research.attemptId)
    assert.equal(before.manifest.stage_instructions, RESEARCH_A)
    assert.equal('stage_instructions' in (await inputOf(fixture, images.attemptId)).manifest, false)
    // The profile's instructions and their digest don't change with the operator's text.
    assert.equal(
      before.manifest.instruction_sha256,
      sessionProfiles['native-agent/2'].instructionDigest,
    )
    const inbox = await inboxCount(fixture)

    await saveInstructions(fixture, { research: RESEARCH_B, images: IMAGES })

    const after = await inputOf(fixture, research.attemptId)
    assert.deepEqual([after.id, after.digest], [before.id, before.digest])
    assert.equal(await inboxCount(fixture), inbox)
    // A resumed turn carries only its inbox count, never the text again.
    assert.equal(openingText(after.manifest, 1, true).includes(RESEARCH_A), false)
    // Work queued after the save, in another batch, gets the new text.
    const later = await fixture.seedCapture()
    const next = await queueLotAttempt(fixture, later, later.packetA.id, 'research')
    assert.equal((await inputOf(fixture, next.attemptId)).manifest.stage_instructions, RESEARCH_B)
    const laterImages = await queueLotAttempt(fixture, later, later.packetB.id, 'images')
    assert.equal(
      (await inputOf(fixture, laterImages.attemptId)).manifest.stage_instructions,
      IMAGES,
    )
  } finally {
    await fixture.dispose()
  }
})

test('the Examine lead seals Examine’s text; a synthetic lead seals none', async () => {
  for (const profileId of ['native-agent/2', 'synthetic-session/1'] as const) {
    const fixture = await processingFixture({ profileId })
    try {
      await saveInstructions(fixture, { examine: EXAMINE, research: RESEARCH_A })
      const capture = await fixture.seedCapture()
      await seedPhoto(fixture, capture.batch.id, { width: 768, height: 512 })
      await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
      const lead = await fixture.db.pool.query<{ current_attempt_id: string }>(
        "SELECT current_attempt_id FROM processing_job WHERE batch_id=$1 AND stage='examine'",
        [capture.batch.id],
      )
      const { manifest } = await inputOf(fixture, lead.rows[0].current_attempt_id)
      assert.equal(
        manifest.stage_instructions,
        profileId === 'native-agent/2' ? EXAMINE : undefined,
        profileId,
      )
    } finally {
      await fixture.dispose()
    }
  }
})

test('the opening gives the sealed text after the app’s rules, outside the profile instructions', async () => {
  const fixture = await processingFixture()
  const root = await mkdtemp(join(tmpdir(), 'step-instructions-'))
  try {
    await saveInstructions(fixture, { research: RESEARCH_A })
    const capture = await fixture.seedCapture()
    const attempt = await queueLotAttempt(fixture, capture, capture.packetA.id, 'research')
    const retained = await queueLotAttempt(fixture, capture, capture.packetB.id, 'images')
    await saveInstructions(fixture, { research: RESEARCH_B })
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
    const opening = JSON.parse(turns[0].text) as Record<string, unknown> & { instructions: string }
    assert.equal(opening.stage_instructions, RESEARCH_A)
    // After the app's rules: the last key, and the instructions' last sentence names it.
    assert.equal(Object.keys(opening).at(-1), 'stage_instructions')
    assert.match(
      opening.instructions,
      /Operator guidance for this step: stage_instructions holds the operator’s saved instructions for this step\. Follow them after the rules above; where they conflict, the rules above win\.$/,
    )
    assert.ok(
      opening.instructions.indexOf('Put catalogue values') <
        opening.instructions.indexOf('Operator guidance for this step'),
    )
    assert.equal(turns[0].instructions.includes(RESEARCH_A), false)
    assert.equal(
      createHash('sha256').update(turns[0].instructions, 'utf8').digest('hex'),
      sessionProfiles['native-agent/2'].instructionDigest,
    )
    // An input with no step instructions renders as it did before.
    const plain = JSON.parse(
      openingText((await inputOf(fixture, retained.attemptId)).manifest, 0, false),
    )
    assert.equal('stage_instructions' in plain, false)
    assert.equal(plain.instructions.includes('Operator guidance for this step'), false)
  } finally {
    await fixture.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

test('a /7 lead and its lots seal their step’s text in the input and the brief’s human facts', async (t) => {
  const batch = await formedBatch(t, {
    stageInputs: true,
    profileId: 'shared-vm-agent/4',
    beforeExamine: async (fixture) => {
      await saveInstructions(fixture, { examine: EXAMINE, research: RESEARCH_A, images: IMAGES }, 8)
    },
  })
  const { fixture, leadAttempt } = batch
  const lead = (await inputOf(fixture, leadAttempt)).manifest
  assert.equal(lead.stage_instructions, EXAMINE)
  assert.deepEqual(guidanceOf(briefEntries(lead)), [
    { kind: 'step_guidance', source: 'human', stage: 'examine', text: EXAMINE },
  ])
  const lot = await batch.lot('led 0603 red')
  const successors = await batch.successors(lot.id)
  const expected = { research: RESEARCH_A, images: IMAGES }
  for (const stage of ['research', 'images'] as const) {
    const row = successors.find((item) => item.stage === stage)!
    const manifest = decodeSessionInput(row.input_bytes, row.input_digest)
    assert.equal(manifest.stage_instructions, expected[stage], stage)
    const entries = briefEntries(manifest)
    // First among the operator's facts, and only this step's.
    const human = (manifest as ProcessingInputV7Dto).brief.sections.findIndex(
      (section) => section.name === 'human',
    )
    const before = (manifest as ProcessingInputV7Dto).brief.sections
      .slice(0, human)
      .reduce((sum, section) => sum + section.count, 0)
    assert.deepEqual(entries[before], {
      kind: 'step_guidance',
      source: 'human',
      stage,
      text: expected[stage],
    })
    assert.equal(guidanceOf(entries).length, 1, stage)
    // The stage pack and the profile keep their digests.
    assert.equal(
      (manifest as ProcessingInputV7Dto).stage_instructions_sha256,
      stagePacks['shared-vm-agent/4']![stage],
    )
    assert.equal(
      manifest.instruction_sha256,
      sessionProfiles['shared-vm-agent/4'].instructionDigest,
    )
    const opening = JSON.parse(openingText(manifest, 0, false, row.attempt_id)) as {
      instructions: string
    }
    assert.match(
      opening.instructions,
      /Operator guidance for this step: the step_guidance entry in your brief’s human section holds the operator’s saved instructions for this step\. Follow them after the rules above and your stage instructions; where they conflict, those win\.$/,
    )
  }

  // Saved while the Research attempt waits: it keeps A, and its brief's current view says A.
  const research = successors.find((item) => item.stage === 'research')!
  await saveInstructions(fixture, { research: RESEARCH_B }, 8)
  const kept = await inputOf(fixture, research.attempt_id)
  assert.equal(kept.digest, research.input_digest.toString('hex'))
  assert.equal(kept.manifest.stage_instructions, RESEARCH_A)
  const current = await transaction(fixture.db.pool, async (client) => {
    const snapshot = (await captureInTransaction(client, fixture.config, batch.batchId)).snapshot
    return assembleBrief(client, fixture.config, snapshot, briefScope(kept.manifest))
  })
  assert.deepEqual(guidanceOf(current.entries), [
    { kind: 'step_guidance', source: 'human', stage: 'research', text: RESEARCH_A },
  ])
})

test('a /7 attempt with no step instructions has no guidance entry or line', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, profileId: 'shared-vm-agent/4' })
  const lead = (await inputOf(batch.fixture, batch.leadAttempt)).manifest
  assert.equal('stage_instructions' in lead, false)
  assert.deepEqual(guidanceOf(briefEntries(lead)), [])
  const opening = openingText(lead, 0, false, batch.leadAttempt)
  assert.equal(opening.includes('Operator guidance for this step'), false)
})
