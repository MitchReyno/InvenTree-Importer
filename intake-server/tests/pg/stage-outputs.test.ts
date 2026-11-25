import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  projectRecords,
  type CaptureSnapshotDto,
  type ProcessingInputV7Dto,
  type SealedMatchDto,
  type SessionInboxItemDto,
  type SessionRevisionV2Dto,
} from '@invimport/contracts'
import { formedBatch, photoWithNote, type Fixture } from '../support/lot-pipeline.ts'
import { requeueLot, running, type StageToolResult } from '../support/stage-sessions.ts'
import { syntheticQuestion } from '#/agents/session/synthetic-turn.ts'
import { transaction } from '#/db/database.ts'
import { editMedia } from '#/media/edit.ts'
import { grantMedia } from '#/media/grants.ts'
import { decodeSessionInput } from '#/processing/session-input.ts'
import { evidenceNotes } from '#/capture/context-input.ts'
import { sha256 } from '#/db/authority.ts'
import { triggerExamine } from '#/processing/examine-trigger.ts'
import { recordPhotoRelease } from '#/agents/tools/photo-release.ts'
import { pendingSessionInbox } from '#/agents/tools/inbox.ts'
import { notifyRevision } from '#/processing/currentness.ts'
import { stableIdentityOf } from '#/processing/stable-identity.ts'
import { sessionTools, type SessionToolOutput } from '#/agents/tools/handlers.ts'
import { queueSessionResume, runSessionTurn } from '#/agents/session/session-runner.ts'
import { lockBlob } from '#/media/blob-store.ts'
import type { PoolClient } from 'pg'
import { setTimeout as delay } from 'node:timers/promises'

type Batch = Awaited<ReturnType<typeof formedBatch>>
type Result = Omit<StageToolResult, 'images'>
type LotInput = Extract<ProcessingInputV7Dto, { match: unknown }>

/** The session tools in this process, as a worker hosts them; a new one is a restarted worker. */
function tools(batch: Batch) {
  return sessionTools({
    pool: batch.fixture.runner.pool,
    writerPool: batch.fixture.writer.pool,
    config: batch.fixture.config,
    store: batch.store,
    statusIntervalMs: 0,
    imageBudget: new Map(),
    deliveredMedia: new Map(),
    figurePreviewWaitMs: 0,
  })
}

async function result(output: Promise<SessionToolOutput>) {
  return (await output).result as Result
}

async function inputOf(fixture: Fixture, attemptId: string) {
  const rows = await fixture.db.pool.query<{ manifest_bytes: Buffer; manifest_digest: Buffer }>(
    `SELECT i.manifest_bytes,i.manifest_digest FROM processing_attempt a
     JOIN processing_input i ON i.id=a.input_id WHERE a.id=$1`,
    [attemptId],
  )
  const manifest = decodeSessionInput(rows.rows[0].manifest_bytes, rows.rows[0].manifest_digest)
  assert.equal(manifest.schema_version, 'bench-intake-input/7')
  return {
    manifest: manifest as LotInput,
    digest: rows.rows[0].manifest_digest.toString('hex'),
  }
}

/** The lot's note as a session cites it, and what a Research output relies on. */
function citations(manifest: ProcessingInputV7Dto) {
  const text = evidenceNotes(manifest.notes, manifest.batch_id)[0]
  const note = {
    kind: 'note',
    note_id: text.id,
    text_sha256: sha256(Buffer.from(text.text, 'utf8')).toString('hex'),
  }
  const reliesOn = {
    fields: ['identity'],
    sources: [
      note,
      ...manifest.pinned_proposal_ids.map((id) => ({ kind: 'proposal', proposal_id: id })),
    ],
  }
  return { note, reliesOn }
}

/** The lot's stage job, with its current attempt. */
async function stageJob(batch: Batch, label: string, stage: 'research' | 'images') {
  const lot = await batch.lot(label)
  const row = (await batch.successors(lot.id)).find((item) => item.stage === stage)!
  return { lot, jobId: row.job_id, attemptId: row.attempt_id }
}

async function revisions(fixture: Fixture, lineageId: string) {
  const rows = await fixture.db.pool.query<{ payload: SessionInboxItemDto['payload'] }>(
    "SELECT payload FROM agent_session_inbox WHERE session_lineage_id=$1 AND kind='revision' ORDER BY seq",
    [lineageId],
  )
  return rows.rows.map((row) => row.payload as SessionRevisionV2Dto)
}

/** Waits until some other backend is blocked on a lock the holder's connection holds. */
async function waitForBlocked(fixture: Fixture, holder: PoolClient) {
  const pid = (await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid
  for (let tries = 0; tries < 200; tries += 1) {
    const blocked = await fixture.db.pool.query(
      'SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))',
      [pid],
    )
    if (blocked.rowCount) {
      return
    }
    await delay(50)
  }
  assert.fail('the proposal never waited on the held media lock')
}

async function snapshotOf(fixture: Fixture, batchId: string) {
  return (await fixture.http(`/batches/${batchId}`)).value as CaptureSnapshotDto
}

async function edit(fixture: Fixture, batchId: string, change: Record<string, unknown>) {
  const before = await snapshotOf(fixture, batchId)
  const response = await fixture.http(`/batches/${batchId}/edits`, {
    expected_revision: before.revision,
    change,
  })
  assert.equal(response.status, 200, JSON.stringify(response.value))
  return response.value as CaptureSnapshotDto
}

function researchOutput(lotId: string, manifest: ProcessingInputV7Dto, values: object = {}) {
  const { note, reliesOn } = citations(manifest)
  return {
    schema_version: 'research/1',
    subject_id: lotId,
    summary: 'A 16 MHz crystal.',
    sources: [note],
    relies_on: reliesOn,
    ...values,
  }
}

const CATEGORY_AND_DESCRIPTION = (note: object) => ({
  category: {
    choice: 'proposed_new',
    name: 'Crystals',
    reason: 'No observed category matches.',
    sources: [note],
  },
  description: { text: '16 MHz crystal, HC-49 package.', sources: [note] },
})

test('a /7 stage publishes only its own kind, and Research only what its mode allows', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const session = tools(batch)
  const research = await stageJob(batch, '16 mhz crystal', 'research')
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const { manifest } = await inputOf(fixture, research.attemptId)
  // Queued without a Match outcome, the lot's stages run as after a clear search.
  assert.deepEqual(manifest.match, { outcome: null, mode: { stage: 'research', mode: 'full' } })
  const { note, reliesOn } = citations(manifest)
  const full = researchOutput(research.lot.id, manifest, CATEGORY_AND_DESCRIPTION(note))
  const identity = {
    schema_version: 'examine-identity/1',
    subject_id: research.lot.id,
    summary: 'A crystal.',
    sources: [note],
    relies_on: reliesOn,
    markings: [{ observation_id: research.lot.evidence_observation_ids![0], text: ['16 MHz'] }],
    candidates: [],
  }
  const researcher = await running(fixture, research.attemptId)
  const imager = await running(fixture, images.attemptId)
  const lead = await running(fixture, batch.leadAttempt)
  const paths = (value: Result) => (value.issues ?? []).map((issue) => issue.path)

  const examineKind = await result(session.propose(researcher, { proposal: identity }))
  assert.equal(examineKind.ok, false)
  assert.equal(examineKind.error, 'validation_failed')
  assert.deepEqual(paths(examineKind), [
    '/proposal/schema_version',
    '/proposal/markings',
    '/proposal/candidates',
  ])
  // Images can't research: the refusal names the fields it may not propose.
  const imagesResearch = await result(session.propose(imager, { proposal: full }))
  assert.equal(imagesResearch.ok, false)
  assert.deepEqual(paths(imagesResearch), [
    '/proposal/schema_version',
    '/proposal/category',
    '/proposal/description',
  ])
  assert.match(String(imagesResearch.message), /category, description/)
  const leadResearch = await result(session.propose(lead, { proposal: full }))
  assert.deepEqual(paths(leadResearch), [
    '/proposal/schema_version',
    '/proposal/category',
    '/proposal/description',
  ])
  // A `/7` session publishes typed outputs, not the earlier generic proposal.
  const generic = await result(
    session.propose(researcher, {
      proposal: {
        schema_version: 'bench-intake-proposal/5',
        subject_id: research.lot.id,
        summary: 'A crystal.',
        sources: [note],
        relies_on: reliesOn,
      },
    }),
  )
  assert.equal(generic.error, 'validation_failed')
  const accepted = await result(session.propose(researcher, { proposal: full }))
  assert.equal(accepted.ok, true, JSON.stringify(accepted))
  // Examine's markings name observations of the lot it is about.
  const led = await batch.lot('led 0603 red')
  const elsewhere = await result(
    session.propose(lead, {
      proposal: {
        ...identity,
        markings: [{ observation_id: led.evidence_observation_ids![0], text: ['LED'] }],
      },
    }),
  )
  assert.deepEqual(paths(elsewhere), ['/proposal/markings/0/observation_id'])

  // Identify mode: only the identity amendment.
  const identifyMatch: SealedMatchDto = {
    outcome: null,
    mode: { stage: 'research', mode: 'identify' },
  }
  const identifying = await running(
    fixture,
    await requeueLot(fixture, batchId, research.lot.id, 'research', identifyMatch, [
      ...manifest.pinned_proposal_ids,
    ]),
  )
  const early = await result(session.propose(identifying, { proposal: full }))
  assert.deepEqual(paths(early), ['/proposal/schema_version'])
  const amendment = await result(
    session.propose(identifying, {
      proposal: {
        schema_version: 'research-identity/1',
        subject_id: research.lot.id,
        summary: 'No part number found yet.',
        sources: [note],
        relies_on: reliesOn,
        resolution: 'unresolved',
        tried: ['Read the note.'],
      },
    }),
  )
  assert.equal(amendment.ok, true, JSON.stringify(amendment))

  // Gaps mode: only the fields the outcome names.
  const gapsMatch: SealedMatchDto = {
    outcome: { revision: '9007199254740993', basis: { kind: 'decision', decision: 'fill_gaps' } },
    mode: { stage: 'research', mode: 'gaps', fields: ['datasheet'] },
  }
  const gapsAttempt = await requeueLot(fixture, batchId, research.lot.id, 'research', gapsMatch, [
    ...manifest.pinned_proposal_ids,
  ])
  assert.deepEqual((await inputOf(fixture, gapsAttempt)).manifest.match, gapsMatch)
  const filling = await running(fixture, gapsAttempt)
  const outside = await result(session.propose(filling, { proposal: full }))
  assert.deepEqual(paths(outside), ['/proposal/category', '/proposal/description'])
  const datasheet = await result(
    session.propose(filling, {
      proposal: researchOutput(research.lot.id, manifest, {
        datasheet: { url: 'https://example.com/crystal.pdf', pages: [1], sources: [note] },
        notes: [{ record: 'part', text: 'Datasheet only.' }],
      }),
    }),
  )
  assert.equal(datasheet.ok, true, JSON.stringify(datasheet))
})

test('a /7 lead forms a lot without a count, and its identity’s estimate reaches Review', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId, leadAttempt } = batch
  // The synthetic lead formed the LED lot with no count and gave its estimate in the identity.
  const led = await batch.lot('led 0603 red')
  assert.equal(led.estimated_quantity, '500')
  assert.equal(led.quantity_basis, 'label · one photo')
  const commands = await fixture.db.pool.query<{ agent_session_id: string; command: string }>(
    `SELECT agent_session_id, convert_from(command_bytes,'UTF8') AS command FROM capture_revision
     WHERE batch_id=$1 AND agent_session_id IS NOT NULL ORDER BY revision`,
    [batchId],
  )
  const formed = commands.rows.map((row) => JSON.parse(row.command) as Record<string, unknown>)
  assert.ok(
    formed
      .filter((row) => row.tool === 'propose_lot')
      .every((row) => !('estimated_quantity' in row)),
  )
  const estimate = commands.rows.find((row) => {
    const command = JSON.parse(row.command) as { tool?: string; lot_id?: string }
    return command.tool === 'propose' && command.lot_id === led.id
  })!
  assert.equal(estimate.agent_session_id, leadAttempt)

  const session = tools(batch)
  const lead = await running(fixture, leadAttempt)
  const snapshot = await snapshotOf(fixture, batchId)
  const observation = snapshot.evidence_observations![0]
  const recorded = await result(
    session.record_observation(lead, {
      base_revision: snapshot.revision,
      evidence_version_id: observation.evidence_version_id,
      page: 1,
      region: {
        kind: 'pixels',
        x: 0,
        y: 400,
        width: 200,
        height: 100,
        source_width: 768,
        source_height: 512,
      },
      readings: { markings: ['1N4148'] },
    }),
  )
  assert.equal(recorded.ok, true, JSON.stringify(recorded))
  const counted = await result(
    session.propose_lot(lead, {
      base_revision: recorded.revision,
      label: 'reel 1n4148',
      observation_ids: [recorded.id],
      estimated_quantity: '50',
      quantity_basis: 'Printed on the reel.',
    }),
  )
  assert.equal(counted.ok, false)
  assert.equal(counted.error, 'validation_failed')
  assert.deepEqual(
    (counted.issues ?? []).map((issue) => issue.path),
    ['/estimated_quantity', '/quantity_basis'],
  )
  const formedLot = await result(
    session.propose_lot(lead, {
      base_revision: recorded.revision,
      label: 'reel 1n4148',
      observation_ids: [recorded.id],
    }),
  )
  assert.equal(formedLot.ok, true, JSON.stringify(formedLot))
  const reel = String(formedLot.id)
  const { note } = citations((await inputOf(fixture, leadAttempt)).manifest)
  const reelLot = (await snapshotOf(fixture, batchId)).lots.find((item) => item.id === reel)!
  const reelIdentity = (version: string, quantity: string) => ({
    proposal: {
      schema_version: 'examine-identity/1',
      subject_id: reel,
      summary: 'A reel of 1N4148 diodes.',
      sources: [note],
      relies_on: {
        fields: ['markings', 'identity'],
        sources: [note, { kind: 'observation_set', lot_id: reel, version }],
      },
      markings: [{ observation_id: String(recorded.id), text: ['1N4148'] }],
      candidates: [{ mpn: '1N4148', confidence: 'medium' }],
      quantity: { value: quantity, basis: 'Printed on the reel.' },
    },
  })
  // An identity relying on another observation set than the lot's is refused as stale, and its
  // estimate isn't kept; nor is one relying on an observation at another revision.
  const otherSet = (BigInt(reelLot.observation_set_version!) + 5n).toString()
  const stale = await result(session.propose(lead, reelIdentity(otherSet, '40')))
  assert.equal(stale.error, 'stale', JSON.stringify(stale))
  const future = await result(
    session.propose(lead, {
      proposal: {
        ...reelIdentity(reelLot.observation_set_version!, '40').proposal,
        relies_on: {
          fields: ['markings'],
          sources: [
            note,
            {
              kind: 'evidence_observation',
              evidence_observation_id: String(recorded.id),
              revision: (BigInt(String(recorded.revision)) + 1n).toString(),
            },
          ],
        },
      },
    }),
  )
  assert.equal(future.error, 'stale', JSON.stringify(future))
  assert.equal(
    (await snapshotOf(fixture, batchId)).lots.find((item) => item.id === reel)!.estimated_quantity,
    undefined,
  )

  // A stable identity queues its successors, which takes the photo's media lock, before the
  // estimate publishes to the batch's stream: while another transaction holds that media lock,
  // the waiting proposal holds no stream head, so a decode settling meanwhile can't deadlock it.
  const photo = await fixture.db.pool.query<{ digest: string; stream_id: string }>(
    `SELECT encode(v.blob_digest,'hex') AS digest, b.stream_id FROM media_version v
     JOIN capture_batch b ON b.id=v.batch_id WHERE v.id=$1`,
    [observation.evidence_version_id],
  )
  const holder = await fixture.db.pool.connect()
  let pending: Promise<Result> | undefined
  try {
    await holder.query('BEGIN')
    await lockBlob(holder, photo.rows[0].digest)
    pending = result(session.propose(lead, reelIdentity(reelLot.observation_set_version!, '50')))
    await waitForBlocked(fixture, holder)
    const probe = await fixture.db.pool.connect()
    try {
      await probe.query('BEGIN')
      await probe.query('SELECT 1 FROM ui_stream WHERE id=$1 FOR UPDATE NOWAIT', [
        photo.rows[0].stream_id,
      ])
      await probe.query('ROLLBACK')
    } finally {
      probe.release()
    }
  } finally {
    await holder.query('ROLLBACK')
    holder.release()
  }
  const published = await pending!
  assert.equal(published.ok, true, JSON.stringify(published))
  const after = await snapshotOf(fixture, batchId)
  const lot = after.lots.find((item) => item.id === reel)!
  assert.equal(lot.estimated_quantity, '50')
  assert.equal(lot.quantity_basis, 'Printed on the reel.')
  const latest = await fixture.db.pool.query<{ agent_session_id: string }>(
    'SELECT agent_session_id FROM capture_revision WHERE batch_id=$1 AND revision=$2',
    [batchId, after.revision],
  )
  assert.equal(latest.rows[0].agent_session_id, leadAttempt)
  // Review shows it as Examine's estimate, for the operator to accept or replace.
  const records = projectRecords({ capture: after, processing: undefined, lotGroups: null })
  const stock = records.records.find((record) => record.key === `stock_item:${reel}`)!
  assert.deepEqual(stock.fields[0], {
    name: 'quantity',
    value: '50',
    origin: { kind: 'estimate', step: 'examine' },
  })
})

test('an operator’s reading correction tells the /7 lead and the lot’s sessions, and stales what relied on it', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId, leadJob, leadAttempt } = batch
  const research = await stageJob(batch, '16 mhz crystal', 'research')
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const { manifest } = await inputOf(fixture, research.attemptId)
  const observationId = research.lot.evidence_observation_ids![0]
  const { note } = citations(manifest)
  const session = tools(batch)
  const researcher = await running(fixture, research.attemptId)
  // Research relies on Examine's identity, which relies on the observation; it doesn't cite the
  // observation itself, so its proposal goes stale through the identity.
  const published = await result(
    session.propose(researcher, {
      proposal: researchOutput(research.lot.id, manifest, {
        description: { text: '16 MHz crystal.', sources: [note] },
      }),
    }),
  )
  assert.equal(published.ok, true, JSON.stringify(published))
  const proposalId = String(published.id)
  const observation = (await snapshotOf(fixture, batchId)).evidence_observations!.find(
    (item) => item.id === observationId,
  )!
  const corrected = await edit(fixture, batchId, {
    kind: 'observation',
    observation_id: observationId,
    evidence_version_id: observation.evidence_version_id,
    page: observation.page,
    region: observation.region,
    readings: { markings: ['16.000 MHz ECS'] },
  })

  const reading = {
    kind: 'reading',
    observation_id: observationId,
    reading_from: observation.readings,
    reading_to: { markings: ['16.000 MHz ECS'] },
  }
  const operator = { kind: 'operator', actor_id: fixture.config.actorId }
  const [identityId] = manifest.pinned_proposal_ids
  // Examine's identity relied on the reading too, so it is stale with what was built on it.
  const identityStale = {
    kind: 'proposal',
    proposal_id: identityId,
    proposal_kind: 'examine-identity/1',
    state: 'stale',
    reason: 'operator_correction',
  }
  const [toLead] = await revisions(fixture, leadJob)
  assert.equal(toLead.schema_version, 'bench-intake-revision/2')
  assert.deepEqual(toLead.changes, [reading, identityStale])
  assert.deepEqual(toLead.source, operator)
  assert.equal(toLead.brief_revision, corrected.revision)
  const toResearch = await revisions(fixture, research.jobId)
  assert.equal(toResearch.length, 1)
  const researchStale = {
    kind: 'proposal',
    proposal_id: proposalId,
    proposal_kind: 'research/1',
    state: 'stale',
    reason: 'operator_correction',
  }
  // Changes name each stale proposal once, sorted by id.
  const sorted = (changes: object[]) =>
    [...changes].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  assert.deepEqual(sorted(toResearch[0].changes), sorted([reading, identityStale, researchStale]))
  const toImages = await revisions(fixture, images.jobId)
  assert.equal(toImages.length, 1)
  assert.deepEqual(toImages[0].changes, [reading, identityStale])
  const stale = await fixture.db.pool.query<{ reason: string }>(
    'SELECT reason FROM processing_proposal_stale WHERE proposal_id=$1',
    [proposalId],
  )
  assert.equal(stale.rows[0].reason, 'operator_correction')

  // Published after the correction, a proposal relying on the stale identity, or on the reading
  // at its earlier revision, is refused as stale; one citing the current facts is accepted.
  const onIdentity = await result(
    session.propose(researcher, {
      proposal: researchOutput(research.lot.id, manifest, {
        description: { text: '16 MHz crystal.', sources: [note] },
      }),
    }),
  )
  assert.equal(onIdentity.error, 'stale')
  const onReading = (revision: string) =>
    result(
      session.propose(researcher, {
        proposal: researchOutput(research.lot.id, manifest, {
          relies_on: {
            fields: ['identity'],
            sources: [
              note,
              {
                kind: 'evidence_observation',
                evidence_observation_id: observationId,
                revision,
              },
            ],
          },
          description: { text: '16.000 MHz crystal.', sources: [note] },
        }),
      }),
    )
  assert.equal((await onReading(observation.revision)).error, 'stale')
  assert.equal((await onReading(corrected.revision)).ok, true)

  // The finished lead has an unread item, which the wake sweep resumes it for; resumed, its
  // turn reads and acknowledges it.
  const pending = () =>
    transaction(fixture.runner.pool, (client) => pendingSessionInbox(client, leadJob))
  assert.equal(await pending(), 1)
  await transaction(fixture.runner.pool, (client) => queueSessionResume(client, leadJob))
  assert.equal(
    await runSessionTurn(batch.deps, leadAttempt, new AbortController().signal),
    'finished',
  )
  assert.equal(await pending(), 0)
})

test('a correction on an earlier input tells no session and stales nothing, as before', async (t) => {
  const batch = await formedBatch(t)
  const { fixture, batchId, leadJob } = batch
  const crystal = await batch.lot('16 mhz crystal')
  const observation = (await snapshotOf(fixture, batchId)).evidence_observations!.find(
    (item) => item.id === crystal.evidence_observation_ids![0],
  )!
  await edit(fixture, batchId, {
    kind: 'observation',
    observation_id: observation.id,
    evidence_version_id: observation.evidence_version_id,
    page: observation.page,
    region: observation.region,
    readings: { markings: ['16.000 MHz ECS'] },
  })
  assert.deepEqual(await revisions(fixture, leadJob), [])
  const stale = await fixture.db.pool.query('SELECT 1 FROM processing_proposal_stale')
  assert.equal(stale.rowCount, 0)
})

test('each revision sender names its changes, who made them and the brief revision', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId, leadJob, leadAttempt } = batch
  const session = tools(batch)
  const research = await stageJob(batch, '16 mhz crystal', 'research')
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const led = await stageJob(batch, 'led 0603 red', 'research')
  const [identityId] = (await inputOf(fixture, research.attemptId)).manifest.pinned_proposal_ids
  const operator = { kind: 'operator', actor_id: fixture.config.actorId }

  // An answer: the asker gets the answer; the identity's owner and Images, pinned to it, are told
  // what was answered.
  const researcher = await running(fixture, research.attemptId)
  const asked = await result(
    session.ask(researcher, {
      schema_version: 'bench-intake-question/2',
      subject_id: research.lot.id,
      reason: 'The marking is partly worn.',
      fields: ['identity'],
      steps: [
        {
          id: 'freq',
          prompt: 'What frequency is printed?',
          assumption: 'Treating it as 16 MHz.',
          answer: { kind: 'text' },
        },
      ],
    }),
  )
  assert.equal(asked.ok, true, JSON.stringify(asked))
  const { digest } = await inputOf(fixture, research.attemptId)
  // Longer than a short field: an answer that fits the inbox arrives whole.
  const printed = `16.000 MHz ${'ECS-160-20-4X '.repeat(42)}`.trim()
  assert.ok([...printed].length > 512)
  const answered = await fixture.http(`/batches/${batchId}/questions/${asked.id}/answers`, {
    schema_version: 'bench-intake-answer/2',
    expected_question_revision: '1',
    expected_capture_revision: (await snapshotOf(fixture, batchId)).revision,
    attempt_id: research.attemptId,
    input_sha256: digest,
    steps: [{ step_id: 'freq', value: { kind: 'text', text: printed } }],
  })
  assert.equal(answered.status, 200, JSON.stringify(answered.value))
  const answerRevision = (answered.value as { capture_revision: string }).capture_revision
  const fromAnswer = (await revisions(fixture, images.jobId)).at(-1)!
  assert.deepEqual(fromAnswer.changes, [
    {
      kind: 'field',
      subject_id: research.lot.id,
      field: 'identity',
      // The answer adds what the operator said; the asker's assumption was never the field's value.
      from: null,
      to: printed,
    },
    {
      kind: 'proposal',
      proposal_id: identityId,
      proposal_kind: 'examine-identity/1',
      state: 'stale',
      reason: 'answer_received',
    },
  ])
  assert.deepEqual(fromAnswer.source, operator)
  assert.equal(fromAnswer.brief_revision, answerRevision)
  assert.equal((await revisions(fixture, leadJob)).at(-1)!.source.kind, 'operator')

  // A republished identity releases a successor that has run: what it published is stale, it is
  // told why, and it is queued again from the new identity.
  const ledInput = (await inputOf(fixture, led.attemptId)).manifest
  const ledResearch = await result(
    session.propose(await running(fixture, led.attemptId), {
      proposal: researchOutput(led.lot.id, ledInput, {
        description: { text: 'Red LEDs.', sources: [citations(ledInput).note] },
      }),
    }),
  )
  assert.equal(ledResearch.ok, true, JSON.stringify(ledResearch))
  await fixture.db.pool.query('UPDATE agent_session SET turn_count=1 WHERE attempt_id=$1', [
    led.attemptId,
  ])
  const lead = await running(fixture, leadAttempt)
  const ledLot = (await snapshotOf(fixture, batchId)).lots.find((lot) => lot.id === led.lot.id)!
  const { note } = citations((await inputOf(fixture, leadAttempt)).manifest)
  const identity = await result(
    session.propose(lead, {
      proposal: {
        schema_version: 'examine-identity/1',
        subject_id: led.lot.id,
        summary: 'Red 0603 LEDs.',
        sources: [note],
        relies_on: {
          fields: ['markings', 'identity'],
          sources: [
            note,
            {
              kind: 'observation_set',
              lot_id: led.lot.id,
              version: ledLot.observation_set_version,
            },
          ],
        },
        markings: [
          { observation_id: led.lot.evidence_observation_ids![0], text: ['LED 0603 red'] },
        ],
        candidates: [{ description: 'Red 0603 LED', confidence: 'medium' }],
      },
    }),
  )
  assert.equal(identity.ok, true, JSON.stringify(identity))
  const republished = (await revisions(fixture, led.jobId)).at(-1)!
  const [earlierIdentity] = ledInput.pinned_proposal_ids
  assert.deepEqual(republished.changes, [
    {
      kind: 'proposal',
      proposal_id: identity.id,
      proposal_kind: 'examine-identity/1',
      state: 'published',
    },
    {
      kind: 'proposal',
      proposal_id: earlierIdentity,
      proposal_kind: 'examine-identity/1',
      state: 'stale',
      reason: 'source_superseded',
    },
    {
      kind: 'proposal',
      proposal_id: ledResearch.id,
      proposal_kind: 'research/1',
      state: 'stale',
      reason: 'source_superseded',
    },
  ])
  const requeued = await stageJob(batch, 'led 0603 red', 'research')
  assert.equal(requeued.jobId, led.jobId)
  assert.notEqual(requeued.attemptId, led.attemptId)
  const old = await fixture.db.pool.query<{ state: string }>(
    'SELECT state FROM processing_attempt WHERE id=$1',
    [led.attemptId],
  )
  assert.equal(old.rows[0].state, 'superseded')
  const requeuedInput = (await inputOf(fixture, requeued.attemptId)).manifest
  assert.deepEqual(requeuedInput.pinned_proposal_ids, [identity.id])
  // The new attempt reads the revision from the lineage's inbox and publishes on the new identity.
  const fresh = await running(fixture, requeued.attemptId)
  const inbox = await result(session.read_inbox(fresh, { after_seq: '0' }))
  assert.ok(
    (inbox.items ?? []).some(
      (item) => item.kind === 'revision' && 'schema_version' in item.payload,
    ),
  )
  const onNew = await result(
    session.propose(fresh, {
      proposal: researchOutput(led.lot.id, requeuedInput, {
        description: { text: 'Red 0603 LEDs.', sources: [citations(requeuedInput).note] },
      }),
    }),
  )
  assert.equal(onNew.ok, true, JSON.stringify(onNew))
  // The identity it replaced is retired, so it is never the lot's stable identity again, even
  // once the new one goes stale too.
  const stableNow = () =>
    transaction(fixture.runner.pool, (client) => stableIdentityOf(client, batchId, led.lot.id))
  assert.deepEqual(await stableNow(), [identity.id])
  await fixture.db.pool.query(
    "INSERT INTO processing_proposal_stale(proposal_id,reason) VALUES($1,'answer_received')",
    [identity.id],
  )
  assert.deepEqual(await stableNow(), [])
  assert.deepEqual(republished.source, {
    kind: 'session',
    stage: 'examine',
    attempt_id: leadAttempt,
  })
  assert.equal(republished.brief_revision, (await snapshotOf(fixture, batchId)).revision)

  // An observation the operator moves out of a lot reaches the lot's running session.
  const moved = await edit(fixture, batchId, {
    kind: 'observation_move',
    observation_id: research.lot.evidence_observation_ids![0],
    lot_id: led.lot.id,
  })
  const fromMove = (await revisions(fixture, research.jobId)).at(-1)!
  assert.deepEqual(fromMove.changes, [
    {
      kind: 'observation',
      observation_id: research.lot.evidence_observation_ids![0],
      lot_from: research.lot.id,
      lot_to: led.lot.id,
    },
  ])
  assert.deepEqual(fromMove.source, operator)
  assert.equal(fromMove.brief_revision, moved.revision)

  // Deleted evidence reaches the lead with the evidence removed, at the capture revision.
  await grantMedia(fixture.db.pool, fixture.api.name, 'api')
  const media = await fixture.db.pool.query<{ revision: string }>(
    'SELECT revision::text FROM media_batch WHERE batch_id=$1',
    [batchId],
  )
  const evidenceId = (await snapshotOf(fixture, batchId)).evidence_observations![0]
  const version = await fixture.db.pool.query<{ evidence_id: string }>(
    'SELECT evidence_id FROM media_version WHERE id=$1',
    [evidenceId.evidence_version_id],
  )
  await editMedia(fixture.api.pool, fixture.config, batchId, randomUUID(), {
    expected_revision: media.rows[0].revision,
    change: { kind: 'remove', evidence_ids: [version.rows[0].evidence_id] },
  })
  const fromRemoval = (await revisions(fixture, leadJob)).at(-1)!
  assert.deepEqual(fromRemoval.changes[0], {
    kind: 'evidence',
    evidence_id: version.rows[0].evidence_id,
    removed: true,
  })
  assert.deepEqual(fromRemoval.source, operator)
  assert.equal(fromRemoval.brief_revision, (await snapshotOf(fixture, batchId)).revision)
})

test('a session on an earlier input keeps getting the earlier revision shape', async (t) => {
  const batch = await formedBatch(t)
  const { fixture, batchId } = batch
  const crystal = await batch.lot('16 mhz crystal')
  const images = (await batch.successors(crystal.id)).find((row) => row.stage === 'images')!
  await edit(fixture, batchId, {
    kind: 'lot',
    id: crystal.id,
    quantity: { mode: 'set', value: '3' },
  })
  // Images is pinned to the crystal's identity, which relies on no quantity: nothing to tell.
  assert.deepEqual(await revisions(fixture, images.job_id), [])
  await edit(fixture, batchId, { kind: 'lot', id: crystal.id, part_subject_id: null })
  const told = await revisions(fixture, images.job_id)
  assert.equal(told.length, 1)
  assert.deepEqual(Object.keys(told[0]).sort(), ['fields', 'reason'])
})

test('a publishing /7 ask returns a question already asked unless it brings something new', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const { fixture, batchId } = batch
  const session = tools(batch)
  const research = await stageJob(batch, '16 mhz crystal', 'research')
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const researcher = await running(fixture, research.attemptId)
  const imager = await running(fixture, images.attemptId)
  const questionCount = async () =>
    Number(
      (
        await fixture.db.pool.query<{ count: string }>(
          'SELECT count(*)::text FROM processing_question WHERE batch_id=$1',
          [batchId],
        )
      ).rows[0].count,
    )

  // The lead relies on the crystal's quantity, so a quantity answer tells it the captured value
  // before and after.
  const leadNote = citations((await inputOf(fixture, batch.leadAttempt)).manifest).note
  const leadCount = await result(
    session.propose(await running(fixture, batch.leadAttempt), {
      proposal: {
        schema_version: 'examine-identity/1',
        subject_id: research.lot.id,
        summary: 'A crystal, counted from the label.',
        sources: [leadNote],
        relies_on: { fields: ['quantity'], sources: [leadNote] },
        markings: [{ observation_id: research.lot.evidence_observation_ids![0], text: ['16 MHz'] }],
        candidates: [],
      },
    }),
  )
  assert.equal(leadCount.ok, true, JSON.stringify(leadCount))
  const quantityBefore = (await snapshotOf(fixture, batchId)).lots.find(
    (lot) => lot.id === research.lot.id,
  )!.quantity

  // Research asks about the crystal's quantity, and the operator answers.
  const question = syntheticQuestion(research.lot.id)
  const first = await result(session.ask(researcher, question))
  assert.equal(first.ok, true, JSON.stringify(first))
  const { digest } = await inputOf(fixture, research.attemptId)
  const answered = await fixture.http(`/batches/${batchId}/questions/${first.id}/answers`, {
    schema_version: 'bench-intake-answer/2',
    expected_question_revision: '1',
    expected_capture_revision: (await snapshotOf(fixture, batchId)).revision,
    attempt_id: research.attemptId,
    input_sha256: digest,
    steps: [
      { step_id: 'left', value: { kind: 'number', value: '12', basis: 'counted' } },
      { step_id: 'packing', value: { kind: 'choice', option_id: 'bag' } },
    ],
  })
  assert.equal(answered.status, 200, JSON.stringify(answered.value))
  const toLead = (await revisions(fixture, batch.leadJob)).at(-1)!
  assert.deepEqual(toLead.changes[0], {
    kind: 'field',
    subject_id: research.lot.id,
    field: 'quantity',
    from: quantityBefore.mode === 'set' ? quantityBefore.value : quantityBefore.mode,
    to: '12',
  })
  const asked = await questionCount()

  // Images asks the same: it gets the answered question and its answer, and nothing is stored.
  const repeat = await result(session.ask(imager, question))
  assert.equal(repeat.ok, true, JSON.stringify(repeat))
  assert.equal(repeat.id, first.id)
  const existing = repeat.existing_question as {
    question: { question_id: string; state: string }
    answer: { steps: { step_id: string; value: string }[] }
  }
  assert.equal(existing.question.state, 'answered')
  assert.deepEqual(
    existing.answer.steps.map((step) => [step.step_id, step.value]),
    [
      ['left', '12 · counted'],
      ['packing', 'Loose in a bag'],
    ],
  )
  assert.equal(await questionCount(), asked)

  // Naming evidence the earlier question didn't cite, or a conflict it didn't name, asks again.
  const photo = (await inputOf(fixture, images.attemptId)).manifest
  const version = (await snapshotOf(fixture, batchId)).evidence_observations![0]
  const evidence = await fixture.db.pool.query<{ evidence_id: string }>(
    'SELECT evidence_id FROM media_version WHERE id=$1',
    [version.evidence_version_id],
  )
  assert.ok(photo.media.manifest.includes(version.evidence_version_id))
  const newEvidence = [
    { evidence_id: evidence.rows[0].evidence_id, version_id: version.evidence_version_id },
  ]
  const withEvidence = await result(session.ask(imager, { ...question, new_evidence: newEvidence }))
  assert.equal(withEvidence.ok, true)
  assert.notEqual(withEvidence.id, first.id)
  assert.equal(withEvidence.existing_question, undefined)
  const again = await result(session.ask(imager, { ...question, new_evidence: newEvidence }))
  assert.equal(again.id, withEvidence.id)
  const withConflict = await result(
    session.ask(imager, { ...question, conflict: 'Label count against the reel weight' }),
  )
  assert.equal(withConflict.existing_question, undefined)
  assert.equal(await questionCount(), asked + 2)
  // Evidence the session may not fetch is refused.
  const unknown = await result(
    session.ask(imager, {
      ...question,
      new_evidence: [{ evidence_id: randomUUID(), version_id: randomUUID() }],
    }),
  )
  assert.equal(unknown.error, 'validation_failed')

  // A replacing ask with no new evidence is stored, and the open question it replaces closes.
  const ledResearch = await stageJob(batch, 'led 0603 red', 'research')
  const ledSession = await running(fixture, ledResearch.attemptId)
  const ledQuestion = syntheticQuestion(ledResearch.lot.id)
  const open = await result(session.ask(ledSession, ledQuestion))
  assert.equal((await result(session.ask(ledSession, ledQuestion))).id, open.id)
  // Another overlapping question, which would cover the replacing ask, doesn't swallow it.
  const ledImages = await stageJob(batch, 'led 0603 red', 'images')
  const ledImager = await running(fixture, ledImages.attemptId)
  const overlapping = await result(
    session.ask(ledImager, { ...ledQuestion, new_evidence: newEvidence }),
  )
  assert.notEqual(overlapping.id, open.id)
  const replacing = await result(session.ask(ledSession, { ...ledQuestion, replaces: open.id }))
  assert.equal(replacing.ok, true, JSON.stringify(replacing))
  assert.notEqual(replacing.id, open.id)
  const closed = await fixture.db.pool.query<{ state: string }>(
    'SELECT state FROM processing_question WHERE id=$1',
    [open.id],
  )
  assert.equal(closed.rows[0].state, 'superseded')

  // A preview beside the open question follows the preview rules: it queues its renders and
  // stores nothing, rather than returning the open question.
  const fetched = await result(
    session.fetch_evidence(ledImager, {
      evidence_id: evidence.rows[0].evidence_id,
      version_id: version.evidence_version_id,
    }),
  )
  await recordPhotoRelease(fixture.runner.pool, ledImages.attemptId, String(fetched.view_seq))
  const before = await questionCount()
  const preview = await result(
    session.ask(ledImager, {
      ...ledQuestion,
      preview: true,
      figures: [
        {
          source: {
            kind: 'evidence_page',
            evidence_id: evidence.rows[0].evidence_id,
            version_id: version.evidence_version_id,
            page: 1,
          },
          view: {
            region: { x: 0, y: 0, width: 384, height: 256 },
            quarter_turns: 0,
            straighten_millidegrees: 0,
          },
          caption: 'The reel',
          why: 'Count from it.',
        },
      ],
    }),
  )
  assert.equal(preview.existing_question, undefined)
  // With no renderer in this test and no wait, the preview rules answer that it isn't ready.
  assert.equal(preview.error, 'preview_not_ready')
  const renders = await fixture.db.pool.query(
    "SELECT 1 FROM processing_figure_render WHERE batch_id=$1 AND purpose='preview'",
    [batchId],
  )
  assert.ok(renders.rowCount)
  assert.equal(await questionCount(), before)
  const published = await result(session.ask(ledImager, ledQuestion))
  assert.equal(published.id, replacing.id)
})

test('an earlier session’s ask is never checked for repeats', async (t) => {
  const batch = await formedBatch(t)
  const session = tools(batch)
  const research = await stageJob(batch, '16 mhz crystal', 'research')
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const question = syntheticQuestion(research.lot.id)
  const first = await result(
    session.ask(await running(batch.fixture, research.attemptId), question),
  )
  const second = await result(session.ask(await running(batch.fixture, images.attemptId), question))
  assert.equal(second.ok, true, JSON.stringify(second))
  assert.notEqual(second.id, first.id)
})

test('a /7 citation needs a released view on the current attempt, which a restart keeps', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const { fixture, batchId, leadAttempt } = batch
  // Two more photos reach the lead as new evidence. It fetches both, and only the bag's image is
  // released; the lead's own turn already fetched and released the tray.
  await photoWithNote(fixture, batchId, 'Bag', '10k resistor', batch.store)
  await photoWithNote(fixture, batchId, 'Box', '1N4148 diode', batch.store)
  await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
  const versions = await fixture.db.pool.query<{
    label: string
    evidence_id: string
    id: string
    sha256: string
  }>(
    `SELECT e.label, v.evidence_id, v.id, encode(v.blob_digest,'hex') AS sha256 FROM media_version v
     JOIN media_evidence e ON e.id=v.evidence_id WHERE v.batch_id=$1`,
    [batchId],
  )
  const byLabel = (label: string) => versions.rows.find((row) => row.label === label)!
  const [tray, bag, box] = [byLabel('Tray'), byLabel('Bag'), byLabel('Box')]
  const source = (row: typeof tray) => ({
    kind: 'media_version',
    evidence_id: row.evidence_id,
    version_id: row.id,
    sha256: row.sha256,
  })
  const crystal = await batch.lot('16 mhz crystal')
  const identity = (cited: ReturnType<typeof source>) => ({
    proposal: {
      schema_version: 'examine-identity/1',
      subject_id: crystal.id,
      summary: 'A crystal.',
      sources: [cited],
      relies_on: { fields: ['markings'], sources: [cited] },
      markings: [{ observation_id: crystal.evidence_observation_ids![0], text: ['16 MHz'] }],
      candidates: [],
    },
  })
  const cites = async (session: ReturnType<typeof tools>, row: typeof tray) =>
    (await result(session.propose(lead, identity(source(row))))).error ?? 'accepted'
  const lead = await running(fixture, leadAttempt)
  const worker = tools(batch)
  const shown = await result(
    worker.fetch_evidence(lead, { evidence_id: bag.evidence_id, version_id: bag.id }),
  )
  const withheld = await result(
    worker.fetch_evidence(lead, { evidence_id: box.evidence_id, version_id: box.id }),
  )
  assert.ok(shown.view_seq && withheld.view_seq, JSON.stringify([shown, withheld]))
  // A view recorded for a reply that wasn't handed over can't be cited.
  assert.equal(await cites(worker, bag), 'source_not_delivered')
  // Two releases of one view at once both succeed and keep one record.
  await Promise.all([
    recordPhotoRelease(fixture.runner.pool, leadAttempt, String(shown.view_seq)),
    recordPhotoRelease(fixture.runner.pool, leadAttempt, String(shown.view_seq)),
  ])
  const releases = await fixture.db.pool.query(
    "SELECT 1 FROM agent_session_outbox WHERE session_id=$1 AND kind='photo_release' AND payload->>'view_seq'=$2",
    [leadAttempt, String(shown.view_seq)],
  )
  assert.equal(releases.rowCount, 1)
  assert.equal(await cites(worker, bag), 'accepted')
  assert.equal(await cites(worker, box), 'source_not_delivered')

  // After a restart the released views still count; the other must be fetched again.
  const restarted = tools(batch)
  assert.equal(await cites(restarted, tray), 'accepted')
  assert.equal(await cites(restarted, bag), 'accepted')
  assert.equal(await cites(restarted, box), 'source_not_delivered')

  // A view released to an earlier attempt doesn't count for the next one.
  const research = await stageJob(batch, '16 mhz crystal', 'research')
  const researcher = await running(fixture, research.attemptId)
  const fetched = await result(
    restarted.fetch_evidence(researcher, { evidence_id: tray.evidence_id, version_id: tray.id }),
  )
  await recordPhotoRelease(fixture.runner.pool, research.attemptId, String(fetched.view_seq))
  const { manifest } = await inputOf(fixture, research.attemptId)
  const cite = () =>
    researchOutput(crystal.id, manifest, {
      sources: [source(tray)],
      description: { text: 'A crystal.', sources: [source(tray)] },
    })
  assert.equal((await result(restarted.propose(researcher, { proposal: cite() }))).ok, true)
  const next = await requeueLot(
    fixture,
    batchId,
    crystal.id,
    'research',
    { outcome: null, mode: { stage: 'research', mode: 'full' } },
    [...manifest.pinned_proposal_ids],
  )
  const nextSession = await running(fixture, next)
  assert.equal(
    (await result(restarted.propose(nextSession, { proposal: cite() }))).error,
    'source_not_delivered',
  )
})

test('the synthetic /7 drivers hand over, release and cite the photo, and publish typed outputs', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, images: true })
  const { fixture, deps, batchId } = batch
  const kinds = async (attemptId: string) =>
    (
      await fixture.db.pool.query<{ kind: string; sources: { kind: string }[] }>(
        `SELECT convert_from(value_bytes,'UTF8')::jsonb->>'schema_version' AS kind,
           convert_from(value_bytes,'UTF8')::jsonb->'sources' AS sources
         FROM processing_proposal WHERE attempt_id=$1`,
        [attemptId],
      )
    ).rows
  const lead = await kinds(batch.leadAttempt)
  assert.deepEqual(
    lead.map((row) => row.kind),
    ['examine-identity/1', 'examine-identity/1'],
  )
  const research = await stageJob(batch, '16 mhz crystal', 'research')
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  assert.equal(
    await runSessionTurn(deps, research.attemptId, new AbortController().signal),
    'waiting_input',
  )
  const [published] = await kinds(research.attemptId)
  assert.equal(published.kind, 'research/1')
  assert.deepEqual(
    published.sources.map((item) => item.kind),
    ['note', 'media_version'],
  )
  const released = await fixture.db.pool.query(
    "SELECT 1 FROM agent_session_outbox WHERE session_id=$1 AND kind='photo_release'",
    [research.attemptId],
  )
  assert.ok(released.rowCount)
  // The history shows the proposal and the photo view, not the release.
  const history = (await fixture.http(`/batches/${batchId}/processing/${research.jobId}/history`))
    .value as { entries: { details: { kind: string } }[] }
  const shown = history.entries.map((entry) => entry.details.kind)
  assert.ok(shown.includes('proposal') && shown.includes('photo_view'))
  assert.ok(!shown.includes('photo_release'))

  // Images publishes no recipes yet, and its repeated quantity question returns Research's.
  assert.equal(
    await runSessionTurn(deps, images.attemptId, new AbortController().signal),
    'finished',
  )
  assert.deepEqual(await kinds(images.attemptId), [])
  const questions = await fixture.db.pool.query<{ job_id: string }>(
    'SELECT job_id FROM processing_question WHERE batch_id=$1',
    [batchId],
  )
  assert.deepEqual(
    questions.rows.map((row) => row.job_id),
    [research.jobId],
  )
})

test('a revision too long for the inbox names what changed and points to the brief', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId, leadJob } = batch
  const research = await stageJob(batch, '16 mhz crystal', 'research')
  const observation = (await snapshotOf(fixture, batchId)).evidence_observations!.find(
    (item) => item.id === research.lot.evidence_observation_ids![0],
  )!
  // The longest readings a correction may hold: 32 markings of 256 four-byte characters.
  const long = {
    markings: Array.from({ length: 32 }, (_, index) => `${index % 10}${'𝄞'.repeat(255)}`),
  }
  const corrected = await edit(fixture, batchId, {
    kind: 'observation',
    observation_id: observation.id,
    evidence_version_id: observation.evidence_version_id,
    page: observation.page,
    region: observation.region,
    readings: long,
  })
  const [toLead] = await revisions(fixture, leadJob)
  assert.equal(toLead.values_in_brief, true)
  assert.deepEqual(toLead.changes[0], {
    kind: 'reading_in_brief',
    observation_id: observation.id,
    revision: corrected.revision,
  })
  assert.deepEqual(toLead.source, { kind: 'operator', actor_id: fixture.config.actorId })
  assert.equal(toLead.brief_revision, corrected.revision)
})

test('an answer too long to carry names the answer, which a later brief still holds', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const research = await stageJob(batch, '16 mhz crystal', 'research')
  const images = await stageJob(batch, '16 mhz crystal', 'images')
  const researcher = await running(fixture, research.attemptId)
  const session = tools(batch)
  const asked = await result(
    session.ask(researcher, {
      schema_version: 'bench-intake-question/2',
      subject_id: research.lot.id,
      reason: 'The label is hard to read.',
      fields: ['markings', 'identity', 'research', 'images'],
      steps: [
        {
          id: 'label',
          prompt: 'What does the label say?',
          assumption: 'Using the reading.',
          answer: { kind: 'text' },
        },
      ],
    }),
  )
  assert.equal(asked.ok, true, JSON.stringify(asked))
  const words = '𝄞'.repeat(2048)
  const { digest } = await inputOf(fixture, research.attemptId)
  const answered = await fixture.http(`/batches/${batchId}/questions/${asked.id}/answers`, {
    schema_version: 'bench-intake-answer/2',
    expected_question_revision: '1',
    expected_capture_revision: (await snapshotOf(fixture, batchId)).revision,
    attempt_id: research.attemptId,
    input_sha256: digest,
    steps: [{ step_id: 'label', value: { kind: 'text', text: words } }],
  })
  assert.equal(answered.status, 200, JSON.stringify(answered.value))
  const receipt = answered.value as { answer_id: string; capture_revision: string }
  const toImages = (await revisions(fixture, images.jobId)).at(-1)!
  assert.equal(toImages.values_in_brief, true)
  assert.deepEqual(toImages.changes[0], {
    kind: 'answer_in_brief',
    question_id: asked.id,
    answer_id: receipt.answer_id,
  })
  assert.deepEqual(
    toImages.changes
      .filter((change) => change.kind === 'field')
      .map((change) => [change.field, change.from, change.to]),
    [
      ['markings', null, null],
      ['identity', null, null],
      ['research', null, null],
      ['images', null, null],
    ],
  )
  assert.equal(toImages.brief_revision, receipt.capture_revision)
  // After another edit the session's current brief still holds the whole answer.
  await edit(fixture, batchId, { kind: 'lot', id: research.lot.id, label: 'Crystal, relabelled' })
  const brief = await result(
    session.read_lot(await running(fixture, images.attemptId), { lot_id: research.lot.id }),
  )
  const entries = [...(brief.brief?.entries ?? [])]
  let token = brief.brief?.next_page_token
  while (token) {
    const page = await result(
      session.read_lot(await running(fixture, images.attemptId), {
        lot_id: research.lot.id,
        page_token: token,
      }),
    )
    entries.push(...(page.brief?.entries ?? []))
    token = page.brief?.next_page_token
  }
  const answer = entries.find(
    (entry) => entry.kind === 'answer' && entry.answer_id === receipt.answer_id,
  )
  assert.ok(answer && answer.kind === 'answer')
  assert.equal(answer.steps[0].value, words)
})

test('a revision with more changes than one item holds arrives whole, in ordered parts', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture } = batch
  const research = await stageJob(batch, '16 mhz crystal', 'research')
  const ids = Array.from({ length: 150 }, () => randomUUID())
  await transaction(fixture.runner.pool, (client) =>
    notifyRevision(
      client,
      research.jobId,
      'bulk',
      {
        fields: ['identity'],
        reason: 'The operator deleted evidence this lot used.',
        changes: ids.map((id) => ({
          kind: 'evidence' as const,
          evidence_id: id,
          removed: true as const,
        })),
      },
      { origin: { by: 'operator' }, briefRevision: '9' },
    ),
  )
  const parts = await revisions(fixture, research.jobId)
  assert.deepEqual(
    parts.map((part) => part.part),
    [
      { index: 1, count: 2 },
      { index: 2, count: 2 },
    ],
  )
  assert.deepEqual(
    parts.flatMap((part) =>
      part.changes.map((change) => change.kind === 'evidence' && change.evidence_id),
    ),
    ids,
  )
})

test('a /7 ask may replace only its own open question, and its conflict must be storable', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const session = tools(batch)
  const research = await stageJob(batch, '16 mhz crystal', 'research')
  const question = syntheticQuestion(research.lot.id)
  const first = await result(session.ask(await running(fixture, research.attemptId), question))
  assert.equal(first.ok, true, JSON.stringify(first))
  // A Start fresh or restart's new attempt supersedes the open question; it can't be replaced.
  const { manifest } = await inputOf(fixture, research.attemptId)
  const next = await requeueLot(
    fixture,
    batchId,
    research.lot.id,
    'research',
    { outcome: null, mode: { stage: 'research', mode: 'full' } },
    [...manifest.pinned_proposal_ids],
  )
  const fresh = await running(fixture, next)
  const replacing = await result(session.ask(fresh, { ...question, replaces: first.id }))
  assert.equal(replacing.error, 'validation_failed')
  assert.deepEqual(
    (replacing.issues ?? []).map((issue) => issue.path),
    ['/replaces'],
  )
  const unstorable = await result(
    session.ask(fresh, { ...question, conflict: 'label\u0000weight' }),
  )
  assert.equal(unstorable.error, 'validation_failed')
  assert.deepEqual(
    (unstorable.issues ?? []).map((issue) => issue.path),
    ['/conflict'],
  )
})
