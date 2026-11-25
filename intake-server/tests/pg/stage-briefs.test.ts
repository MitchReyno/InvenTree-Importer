import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import type {
  BriefEntryDto,
  CaptureSnapshotDto,
  ProcessingInputV7Dto,
  SessionBriefDto,
  SessionBriefPageDto,
  SessionInputDto,
} from '@invimport/contracts'
import { formedBatch, photoWithNote, type Fixture } from '../support/lot-pipeline.ts'
import { transaction } from '#/db/database.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import { triggerExamine } from '#/processing/examine-trigger.ts'
import { decodeSessionInput, briefScope } from '#/processing/session-input.ts'
import { assembleBrief } from '#/processing/brief.ts'
import {
  BRIEF_OPENING_MAX_BYTES,
  BRIEF_VIEWS_PER_ATTEMPT,
  briefDigest,
  keepCurrentView,
  keptCurrentView,
} from '#/processing/brief-pages.ts'
import { MAX_PROCESSING_SNAPSHOT_BYTES } from '#/processing/limits.ts'
import { replaceSession } from '#/processing/session-replacement.ts'
import {
  openingText,
  queueSessionResume,
  runSessionTurn,
  syntheticSessionDriver,
  type SessionDriver,
} from '#/agents/session/session-runner.ts'
import { canonicalRecord } from '@invimport/contracts/json'

type Batch = Awaited<ReturnType<typeof formedBatch>>

interface ToolResult {
  ok: boolean
  error?: string
  revision?: string
  brief?: SessionBriefPageDto
  batch?: { revision: string }
}

async function sealedInput(fixture: Fixture, attemptId: string) {
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
    inputId: row.id,
    bytes: row.manifest_bytes,
    manifest: decodeSessionInput(row.manifest_bytes, row.manifest_digest),
  }
}

function stageInput(manifest: SessionInputDto): ProcessingInputV7Dto {
  assert.equal(manifest.schema_version, 'bench-intake-input/7')
  return manifest as ProcessingInputV7Dto
}

/** Every entry of a sealed brief whose pages are all in its manifest. */
function inlineEntries(manifest: ProcessingInputV7Dto) {
  return manifest.brief.pages.flatMap((page) => {
    assert.ok(page.entries, `page ${page.index} is in the manifest`)
    return page.entries
  })
}

function ofKind<K extends BriefEntryDto['kind']>(entries: readonly BriefEntryDto[], kind: K) {
  return entries.filter(
    (entry): entry is Extract<BriefEntryDto, { kind: K }> => entry.kind === kind,
  )
}

async function packDigest(fixture: Fixture, stage: string) {
  const rows = await fixture.db.pool.query<{ digest: string }>(
    `SELECT encode(instruction_digest,'hex') AS digest FROM processing_stage_instructions
     WHERE profile_id='synthetic-session/1' AND stage=$1`,
    [stage],
  )
  return rows.rows[0].digest
}

/** The session's brief as it would be read now, assembled on the runner's connection. */
async function currentBrief(fixture: Fixture, batchId: string, manifest: SessionInputDto) {
  return transaction(fixture.runner.pool, async (client) => {
    const capture = await captureInTransaction(client, fixture.config, batchId)
    return assembleBrief(client, capture.snapshot, briefScope(manifest))
  })
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

/** Puts a queued or settled session in a running turn and returns its capability. */
async function running(fixture: Fixture, attemptId: string) {
  await fixture.db.pool.query("UPDATE processing_attempt SET state='running' WHERE id=$1", [
    attemptId,
  ])
  await fixture.db.pool.query(
    "UPDATE agent_session SET session_state='running' WHERE attempt_id=$1",
    [attemptId],
  )
  return transaction(fixture.runner.pool, (client) => issueSessionCapability(client, attemptId))
}

async function connect(url: string, token: string) {
  const client = new Client({ name: 'stage-briefs-test', version: '1' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  )
  return client
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args })
  return result.structuredContent as unknown as ToolResult
}

async function toolNames(client: Client) {
  return (await client.listTools()).tools.map((tool) => tool.name).sort()
}

/**
 * Opens MCP clients for the test body and closes them before the fixtures go, so the tool
 * server's close never waits on an open connection.
 */
async function withClients(
  work: (open: (url: string, token: string) => Promise<Client>) => Promise<void>,
) {
  const clients: Client[] = []
  try {
    await work(async (url, token) => {
      const client = await connect(url, token)
      clients.push(client)
      return client
    })
  } finally {
    await Promise.all(clients.map((client) => client.close()))
  }
}

/** Whether the session's read_batch accepts an argument, from the schema it is offered. */
async function readBatchTakes(client: Client, argument: string) {
  const tool = (await client.listTools()).tools.find((item) => item.name === 'read_batch')!
  const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties
  return Object.hasOwn(properties ?? {}, argument)
}

async function successorOf(batch: Batch, label: string, stage: 'research' | 'images') {
  const lot = await batch.lot(label)
  const row = (await batch.successors(lot.id)).find((item) => item.stage === stage)!
  return { lot, row }
}

const SHARED = ['batch', 'human', 'asked', 'evidence', 'match']

test('under the switch the lead and its successors seal briefs with their stages’ sections', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, leadAttempt } = batch
  const lead = stageInput((await sealedInput(fixture, leadAttempt)).manifest)
  assert.equal(lead.tool_profile_version, 'native-session-stage-tools/1')
  assert.equal(lead.stage_instructions_sha256, await packDigest(fixture, 'examine'))
  assert.deepEqual(
    lead.brief.sections.map((section) => section.name),
    [...SHARED, 'observations', 'lots', 'parts'],
  )

  const { lot: led, row: researchRow } = await successorOf(batch, 'led 0603 red', 'research')
  const { row: imagesRow } = await successorOf(batch, 'led 0603 red', 'images')
  const crystal = await batch.lot('16 mhz crystal')
  const research = stageInput((await sealedInput(fixture, researchRow.attempt_id)).manifest)
  const images = stageInput((await sealedInput(fixture, imagesRow.attempt_id)).manifest)
  assert.equal(research.stage_instructions_sha256, await packDigest(fixture, 'research'))
  assert.equal(images.stage_instructions_sha256, await packDigest(fixture, 'images'))
  assert.deepEqual(
    research.brief.sections.map((section) => [section.name, section.count > 0]),
    [
      ['batch', true],
      ['human', true],
      ['asked', false],
      ['evidence', true],
      // Match state and the vocabulary arrive with later changes; their sections exist, empty.
      ['match', false],
      ['identity', true],
      ['observations', true],
      ['vocabulary', false],
    ],
  )
  const entries = inlineEntries(research)
  const [batchEntry] = ofKind(entries, 'batch')
  assert.equal(batchEntry.title, 'Synthetic manual processing')
  const identities = ofKind(entries, 'identity')
  assert.deepEqual(
    identities.map((entry) => entry.proposal_id),
    research.pinned_proposal_ids,
  )
  // Each identity carries the proposal as Examine published it, not only its id.
  assert.equal(identities[0].proposal.summary, 'Identity from the label: led 0603 red.')
  assert.deepEqual(identities[0].proposal.relies_on.fields, ['identity'])
  const [note] = ofKind(entries, 'note').filter((entry) => entry.text.includes('16 MHz'))
  assert.equal(note.source, 'human')
  const own = ofKind(entries, 'observation').map((entry) => entry.observation.id)
  assert.deepEqual(own, led.evidence_observation_ids)
  // The photo lists the regions both lots were read from, each with its lot.
  const [photo] = ofKind(entries, 'evidence')
  assert.equal(photo.label, 'Tray')
  assert.deepEqual(photo.regions.map((region) => region.lot_id).sort(), [led.id, crystal.id].sort())
  // Images keeps the crystal on the same photo out of frame; its own item is not listed there.
  const keepOut = ofKind(inlineEntries(images), 'keep_out')
  assert.deepEqual(
    keepOut.map((entry) => entry.observation_id),
    crystal.evidence_observation_ids,
  )
  assert.equal(ofKind(inlineEntries(images), 'identity').length, 0)
  // The lead was sealed before it had read anything; its current brief carries every
  // observation with its full readings, and every lot.
  assert.equal(ofKind(inlineEntries(lead), 'observation').length, 0)
  const leadNow = await currentBrief(fixture, batch.batchId, lead)
  assert.deepEqual(
    ofKind(leadNow.entries, 'observation')
      .map((entry) => entry.observation.readings.markings)
      .sort(),
    [['16 MHz crystal'], ['LED 0603 red']],
  )
  assert.deepEqual(
    ofKind(leadNow.entries, 'lot')
      .map((entry) => entry.lot_id)
      .sort(),
    (await snapshotOf(fixture, batch.batchId)).lots.map((item) => item.id).sort(),
  )
})

test('human facts are marked human, and asked questions keep to the subject and the stage’s fields', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, deps, batchId, leadAttempt } = batch
  const { lot: led, row: ledResearch } = await successorOf(batch, 'led 0603 red', 'research')
  const { lot: crystal, row: crystalResearch } = await successorOf(
    batch,
    '16 mhz crystal',
    'research',
  )
  // The synthetic Research session reads its brief, then asks one quantity question.
  assert.equal(
    await runSessionTurn(deps, ledResearch.attempt_id, new AbortController().signal),
    'waiting_input',
  )
  const status = await fixture.db.pool.query<{ text: string }>(
    "SELECT payload->>'text' AS text FROM agent_session_outbox WHERE session_id=$1 AND kind='status' ORDER BY seq LIMIT 1",
    [ledResearch.attempt_id],
  )
  assert.match(status.rows[0].text, /^Read the brief at revision \d+: \d+ entries$/)
  const kept = await fixture.db.pool.query(
    'SELECT 1 FROM processing_brief_view WHERE attempt_id=$1',
    [ledResearch.attempt_id],
  )
  assert.equal(kept.rowCount, 1)

  const question = await fixture.db.pool.query<{ id: string }>(
    'SELECT id FROM processing_question WHERE job_id=$1',
    [ledResearch.job_id],
  )
  const asked = (await sealedInput(fixture, ledResearch.attempt_id)).manifest
  const answer = await fixture.http(
    `/batches/${batchId}/questions/${question.rows[0].id}/answers`,
    {
      schema_version: 'bench-intake-answer/2',
      expected_question_revision: '1',
      expected_capture_revision: (await snapshotOf(fixture, batchId)).revision,
      attempt_id: ledResearch.attempt_id,
      input_sha256: ledResearch.input_digest.toString('hex'),
      steps: [
        { step_id: 'left', value: { kind: 'number', value: '480', basis: 'counted' } },
        { step_id: 'packing', value: { kind: 'choice', option_id: 'reel' } },
      ],
    },
  )
  assert.equal(answer.status, 200, JSON.stringify(answer.value))
  await edit(fixture, batchId, { kind: 'note', subject_id: crystal.id, text: 'Crystal is HC-49.' })

  // Examine works on quantity: it sees the question with its assumptions and the answer.
  const examine = await currentBrief(
    fixture,
    batchId,
    (await sealedInput(fixture, leadAttempt)).manifest,
  )
  const [lead] = ofKind(examine.entries, 'question')
  assert.equal(lead.state, 'answered')
  assert.deepEqual(lead.fields, ['quantity'])
  assert.deepEqual(
    lead.steps.map((step) => [step.id, step.assumption]),
    [
      ['left', 'Treating the lot as one item until answered.'],
      ['packing', 'Loose in a bag.'],
    ],
  )
  const [answered] = ofKind(examine.entries, 'answer')
  assert.equal(answered.source, 'human')
  assert.equal(answered.actor_id, fixture.identity.actor)
  assert.deepEqual(
    answered.steps.map((step) => step.value),
    ['480 · counted', 'On a reel'],
  )
  assert.equal(lead.answer_id, answered.answer_id)

  // Research doesn't work on quantity, so the question isn't in its list; the answer, a human
  // fact about its own lot, is.
  const ledBrief = await currentBrief(fixture, batchId, asked)
  assert.equal(ofKind(ledBrief.entries, 'question').length, 0)
  assert.equal(ofKind(ledBrief.entries, 'answer').length, 1)
  assert.equal(
    ofKind(ledBrief.entries, 'note').some((note) => note.text === 'Crystal is HC-49.'),
    false,
  )
  // Another lot's brief has neither its answer nor its question, but has its own note.
  const crystalBrief = await currentBrief(
    fixture,
    batchId,
    (await sealedInput(fixture, crystalResearch.attempt_id)).manifest,
  )
  assert.equal(ofKind(crystalBrief.entries, 'answer').length, 0)
  const [crystalNote] = ofKind(crystalBrief.entries, 'note').filter(
    (note) => note.subject_id === crystal.id,
  )
  assert.equal(crystalNote.source, 'human')
  assert.notEqual(led.id, crystal.id)
})

test('a correction keeps the reading before and after; an earlier one shows only its current reading', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId, leadAttempt } = batch
  const led = await batch.lot('led 0603 red')
  const crystal = await batch.lot('16 mhz crystal')
  const observations = (await snapshotOf(fixture, batchId)).evidence_observations!
  const ledObservation = observations.find((item) => item.id === led.evidence_observation_ids![0])!
  const corrected = await edit(fixture, batchId, {
    kind: 'observation',
    observation_id: ledObservation.id,
    evidence_version_id: ledObservation.evidence_version_id,
    page: ledObservation.page,
    region: ledObservation.region,
    readings: { markings: ['LED 0603 RED', 'R'] },
  })
  // A correction made before readings were kept: the row says edited, with no kept reading.
  const crystalObservation = crystal.evidence_observation_ids![0]
  await fixture.db.pool.query(
    'UPDATE capture_evidence_observation SET operator_edited=true WHERE id=$1',
    [crystalObservation],
  )

  const brief = await currentBrief(
    fixture,
    batchId,
    (await sealedInput(fixture, leadAttempt)).manifest,
  )
  const corrections = ofKind(brief.entries, 'correction')
  const kept = corrections.find((entry) => entry.observation_id === ledObservation.id)!
  assert.deepEqual(kept.before, ledObservation.readings)
  assert.deepEqual(kept.after, { markings: ['LED 0603 RED', 'R'] })
  assert.equal(kept.earlier_known, true)
  assert.equal(kept.actor_id, fixture.identity.actor)
  assert.equal(kept.revision, corrected.revision)
  assert.ok(kept.corrected_at && !Number.isNaN(Date.parse(kept.corrected_at)))
  assert.equal(kept.source, 'human')
  const earlier = corrections.find((entry) => entry.observation_id === crystalObservation)!
  assert.equal(earlier.earlier_known, false)
  assert.equal(earlier.before, null)
  assert.equal(earlier.actor_id, null)
  // The lead's lot entry says which of its readings were corrected.
  const [ledLot] = ofKind(brief.entries, 'lot').filter((entry) => entry.lot_id === led.id)
  assert.equal(ledLot.reexamine, true)
  assert.deepEqual(ledLot.corrected_observation_ids, [ledObservation.id])
  // An unchanged reading keeps nothing.
  await edit(fixture, batchId, {
    kind: 'observation',
    observation_id: ledObservation.id,
    evidence_version_id: ledObservation.evidence_version_id,
    page: ledObservation.page,
    region: ledObservation.region,
    readings: { markings: ['LED 0603 RED', 'R'] },
  })
  const rows = await fixture.db.pool.query(
    'SELECT 1 FROM capture_evidence_observation_correction WHERE observation_id=$1',
    [ledObservation.id],
  )
  assert.equal(rows.rowCount, 1)
})

test('read_batch gives a /7 lead its brief with full readings; earlier leads keep their view', async (t) => {
  const stage = await formedBatch(t, { stageInputs: true })
  const legacy = await formedBatch(t)
  await edit(stage.fixture, stage.batchId, { kind: 'add_part', label: 'Crystal Part' })
  await withClients(async (open) => {
    const lead = await open(stage.deps.toolUrl, await running(stage.fixture, stage.leadAttempt))
    assert.equal((await toolNames(lead)).includes('read_lot'), false)
    assert.ok(await readBatchTakes(lead, 'page_token'))
    const read = await call(lead, 'read_batch', {})
    assert.equal(read.ok, true, JSON.stringify(read))
    assert.equal(read.brief!.view, 'current')
    assert.equal(read.revision, (await snapshotOf(stage.fixture, stage.batchId)).revision)
    // The lead sees the batch's Parts, which a lot may share.
    const [part] = ofKind(read.brief!.entries, 'part')
    assert.equal(part.label, 'Crystal Part')
    const observations = ofKind(read.brief!.entries, 'observation')
    assert.deepEqual(observations.map((entry) => entry.observation.readings.markings).sort(), [
      ['16 MHz crystal'],
      ['LED 0603 red'],
    ])
    // A page of an older brief gives its own revision as the base for writes, and says a newer
    // one exists.
    const sealed = stageInput((await sealedInput(stage.fixture, stage.leadAttempt)).manifest)
    const old = await call(lead, 'read_batch', { revision: sealed.brief.revision })
    assert.equal(old.revision, sealed.brief.revision)
    assert.deepEqual(old.brief!.newer, { revision: read.revision })

    const legacyLead = await open(
      legacy.deps.toolUrl,
      await running(legacy.fixture, legacy.leadAttempt),
    )
    const view = await call(legacyLead, 'read_batch', {})
    assert.equal(view.ok, true)
    assert.equal(view.brief, undefined)
    assert.equal(view.batch!.revision, (await snapshotOf(legacy.fixture, legacy.batchId)).revision)
    // An earlier lead keeps its read_batch as it was: no arguments.
    assert.equal(await readBatchTakes(legacyLead, 'page_token'), false)
    assert.equal(
      (await call(legacyLead, 'read_batch', { page_token: 'abc' })).error,
      'validation_failed',
    )
    const { row } = await successorOf(legacy, 'led 0603 red', 'research')
    const legacyResearch = await open(
      legacy.deps.toolUrl,
      await running(legacy.fixture, row.attempt_id),
    )
    assert.equal((await toolNames(legacyResearch)).includes('read_lot'), false)
  })
})

test('read_lot reads only its own lot, with tokens of its own attempt', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture } = batch
  const { lot: led, row: ledRow } = await successorOf(batch, 'led 0603 red', 'research')
  const { lot: crystal, row: crystalRow } = await successorOf(batch, '16 mhz crystal', 'images')
  await withClients(async (open) => {
    const session = await open(batch.deps.toolUrl, await running(fixture, ledRow.attempt_id))
    const other = await open(batch.deps.toolUrl, await running(fixture, crystalRow.attempt_id))
    assert.ok((await toolNames(session)).includes('read_lot'))
    assert.equal(
      (await call(session, 'read_lot', { lot_id: crystal.id })).error,
      'tool_not_allowed',
    )
    const own = await call(session, 'read_lot', { lot_id: led.id })
    assert.equal(own.ok, true, JSON.stringify(own))
    const theirs = await call(other, 'read_lot', { lot_id: crystal.id })
    assert.equal(theirs.ok, true)
    // A token names its attempt's view; another session's token or a made-up one is refused.
    const token = Buffer.from(
      canonicalRecord({
        attemptId: crystalRow.attempt_id,
        view: 'current',
        digest: theirs.brief!.sha256,
        page: 1,
      }),
    ).toString('base64url')
    assert.equal(
      (await call(session, 'read_lot', { lot_id: led.id, page_token: token })).error,
      'validation_failed',
    )
    assert.equal(
      (await call(session, 'read_lot', { lot_id: led.id, page_token: 'abc' })).error,
      'validation_failed',
    )
    assert.equal(
      (await call(session, 'read_lot', { lot_id: led.id, revision: '999999' })).error,
      'brief_revision_unavailable',
    )
  })
})

/** Eight 16 KB batch notes: a brief over two pages per 32 KiB and past the manifest cap. */
async function largeNotes(fixture: Fixture, batchId: string) {
  for (let index = 0; index < 8; index += 1) {
    await edit(fixture, batchId, {
      kind: 'note',
      subject_id: null,
      text: `${index}:${'é'.repeat(8000)}`,
    })
  }
}

async function requeueResearch(fixture: Fixture, batchId: string, lotId: string) {
  const started = await fixture.http(`/batches/${batchId}/processing`, {
    schema_version: 'bench-intake-processing/1',
    expected_capture_revision: (await snapshotOf(fixture, batchId)).revision,
    subject_ids: [lotId],
    stages: ['research'],
  })
  assert.equal(started.status, 202, JSON.stringify(started.value))
  return (started.value as { attempt_ids: string[] }).attempt_ids[0]
}

async function allPages(
  session: Client,
  lotId: string,
  first: Record<string, unknown>,
): Promise<SessionBriefPageDto[]> {
  const pages: SessionBriefPageDto[] = []
  let args: Record<string, unknown> = { lot_id: lotId, ...first }
  for (;;) {
    const read = await call(session, 'read_lot', args)
    assert.equal(read.ok, true, JSON.stringify(read))
    pages.push(read.brief!)
    if (!read.brief!.next_page_token) {
      return pages
    }
    args = { lot_id: lotId, page_token: read.brief!.next_page_token }
  }
}

test('a large brief keeps the manifest under its cap, its opening within budget and its pages sealed', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const led = await batch.lot('led 0603 red')
  await largeNotes(fixture, batchId)
  await edit(fixture, batchId, { kind: 'lot', id: led.id, quantity: { mode: 'set', value: '480' } })
  const attemptId = await requeueResearch(fixture, batchId, led.id)
  const sealed = await sealedInput(fixture, attemptId)
  const manifest = stageInput(sealed.manifest)
  // Start pins the lot's stable identity, as stable-identity queueing does.
  const [identity] = await batch.identities(led.id)
  assert.deepEqual(manifest.pinned_proposal_ids, [identity.id])
  assert.ok(sealed.bytes.length <= MAX_PROCESSING_SNAPSHOT_BYTES)
  const stored = manifest.brief.pages.filter((page) => !page.entries)
  assert.ok(stored.length > 0, 'some pages are only in the page store')
  const rows = await fixture.db.pool.query<{ page_index: number }>(
    'SELECT page_index FROM processing_input_page WHERE input_id=$1 ORDER BY page_index',
    [sealed.inputId],
  )
  assert.deepEqual(
    rows.rows.map((row) => row.page_index),
    stored.map((page) => page.index),
  )

  // The opening renders what fits and names where the rest is.
  const opening = JSON.parse(openingText(manifest, 0, false, attemptId)) as {
    brief: {
      entries: BriefEntryDto[]
      rest: { tool: string; arguments: { lot_id: string; page_token: string } } | null
    }
  }
  // The rendered brief, with where the rest is, fits the budget, and holds as much as fits.
  assert.ok(Buffer.byteLength(JSON.stringify(opening.brief)) <= BRIEF_OPENING_MAX_BYTES)
  assert.ok(Buffer.byteLength(JSON.stringify(opening.brief)) > BRIEF_OPENING_MAX_BYTES - 20000)
  assert.equal(opening.brief.rest!.tool, 'read_lot')
  await withClients(async (open) => {
    const session = await open(batch.deps.toolUrl, await running(fixture, attemptId))
    const rest = await call(session, 'read_lot', opening.brief.rest!.arguments)
    assert.equal(rest.ok, true, JSON.stringify(rest))
    assert.equal(rest.brief!.view, 'sealed')

    // The lot edit is held only in a stored page; editing the lot again leaves that page as sealed.
    const sealedPages = await allPages(session, led.id, { revision: manifest.brief.revision })
    assert.equal(sealedPages.length, manifest.brief.pages.length)
    const editPage = sealedPages.find((page) =>
      page.entries.some((entry) => entry.kind === 'lot_edit' && entry.lot_id === led.id),
    )!
    assert.ok(stored.some((page) => page.index === editPage.page))
    await edit(fixture, batchId, {
      kind: 'lot',
      id: led.id,
      quantity: { mode: 'set', value: '500' },
    })
    const again = await allPages(session, led.id, { revision: manifest.brief.revision })
    const [lotEdit] = ofKind(again[editPage.page - 1].entries, 'lot_edit')
    assert.deepEqual(lotEdit.quantity, { mode: 'set', value: '480' })
    assert.ok(again[editPage.page - 1].newer, 'the page says a newer brief exists')
    const current = await allPages(session, led.id, {})
    const [now] = ofKind(
      current.flatMap((page) => page.entries),
      'lot_edit',
    ).filter((entry) => entry.lot_id === led.id)
    assert.deepEqual(now.quantity, { mode: 'set', value: '500' })
  })
})

test('an edit after queueing or between pages never mixes two briefs in one page sequence', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const led = await batch.lot('led 0603 red')
  await largeNotes(fixture, batchId)
  const attemptId = await requeueResearch(fixture, batchId, led.id)
  const manifest = stageInput((await sealedInput(fixture, attemptId)).manifest)
  await withClients(async (open) => {
    const session = await open(batch.deps.toolUrl, await running(fixture, attemptId))

    // An edit between queueing and the first read: the current view has it, the sealed one not.
    await edit(fixture, batchId, { kind: 'note', subject_id: led.id, text: 'Reel of 5000.' })
    const current = await allPages(session, led.id, {})
    const sealed = await allPages(session, led.id, { revision: manifest.brief.revision })
    const hasNote = (pages: SessionBriefPageDto[]) =>
      pages.some((page) =>
        page.entries.some((entry) => entry.kind === 'note' && entry.text === 'Reel of 5000.'),
      )
    assert.equal(hasNote(current), true)
    assert.equal(hasNote(sealed), false)
    assert.ok(BigInt(current[0].revision) > BigInt(manifest.brief.revision))
    assert.equal(current[0].newer, null)
    assert.deepEqual(sealed[0].newer, { revision: current[0].revision })

    // An edit between two current-view pages: page two comes from the first page's revision.
    const first = await call(session, 'read_lot', { lot_id: led.id })
    assert.ok(first.brief!.next_page_token)
    const edited = await edit(fixture, batchId, {
      kind: 'note',
      subject_id: led.id,
      text: 'Second reel found.',
    })
    const second = await call(session, 'read_lot', {
      lot_id: led.id,
      page_token: first.brief!.next_page_token,
    })
    assert.equal(second.ok, true, JSON.stringify(second))
    assert.equal(second.brief!.revision, first.brief!.revision)
    assert.equal(second.brief!.sha256, first.brief!.sha256)
    assert.deepEqual(second.brief!.newer, { revision: edited.revision })

    // The views kept are the ones read most recently: continuing a view keeps it among them.
    for (let index = 0; index < BRIEF_VIEWS_PER_ATTEMPT - 1; index += 1) {
      await edit(fixture, batchId, { kind: 'note', subject_id: led.id, text: `Later ${index}.` })
      assert.equal((await call(session, 'read_lot', { lot_id: led.id })).ok, true)
    }
    const third = await call(session, 'read_lot', {
      lot_id: led.id,
      page_token: second.brief!.next_page_token,
    })
    assert.equal(third.ok, true, JSON.stringify(third))
    await edit(fixture, batchId, { kind: 'note', subject_id: led.id, text: 'One more view.' })
    assert.equal((await call(session, 'read_lot', { lot_id: led.id })).ok, true)
    const fourth = await call(session, 'read_lot', {
      lot_id: led.id,
      page_token: first.brief!.next_page_token,
    })
    assert.equal(fourth.ok, true, JSON.stringify(fourth))

    // Current views are kept within a bound; a token for one no longer kept is refused.
    for (let index = 0; index < BRIEF_VIEWS_PER_ATTEMPT; index += 1) {
      await edit(fixture, batchId, { kind: 'note', subject_id: led.id, text: `Count ${index}.` })
      assert.equal((await call(session, 'read_lot', { lot_id: led.id })).ok, true)
    }
    const evicted = await call(session, 'read_lot', {
      lot_id: led.id,
      page_token: first.brief!.next_page_token,
    })
    assert.equal(evicted.error, 'brief_revision_unavailable')
  })
})

/** A driver that records what the turn was given, then runs the synthetic session. */
function recording(seen: { instructions: string; tools: string[] }[]): SessionDriver {
  return async (turn, context) => {
    seen.push({ instructions: turn.instructions, tools: [...turn.tools] })
    await syntheticSessionDriver(turn, context)
  }
}

test('the claim checks the sealed stage pack and tool profile; a retained /6 input keeps its binding', async (t) => {
  const legacy = await formedBatch(t)
  // The switch turns on after the batch's attempts were sealed as `/6`.
  legacy.fixture.config.stageInputs = 'local'
  const seen: { instructions: string; tools: string[] }[] = []
  const deps = { ...legacy.deps, drivers: { 'synthetic-session/1': recording(seen) } }
  const { row } = await successorOf(legacy, 'led 0603 red', 'research')
  assert.equal(
    (await sealedInput(legacy.fixture, row.attempt_id)).manifest.schema_version,
    'bench-intake-input/6',
  )
  assert.equal(
    await runSessionTurn(deps, row.attempt_id, new AbortController().signal),
    'waiting_input',
  )
  const profile = await legacy.fixture.db.pool.query<{ text: string }>(
    "SELECT convert_from(instruction_bytes,'UTF8') AS text FROM processing_profile WHERE id='synthetic-session/1'",
  )
  assert.equal(seen[0].instructions, profile.rows[0].text)
  assert.equal(seen[0].tools.includes('read_lot'), false)

  const stage = await formedBatch(t, { stageInputs: true })
  const stageDeps = { ...stage.deps, drivers: { 'synthetic-session/1': recording(seen) } }
  const { row: stageRow } = await successorOf(stage, 'led 0603 red', 'research')
  assert.equal(
    await runSessionTurn(stageDeps, stageRow.attempt_id, new AbortController().signal),
    'waiting_input',
  )
  const pack = await stage.fixture.db.pool.query<{ text: string }>(
    "SELECT convert_from(instruction_bytes,'UTF8') AS text FROM processing_stage_instructions WHERE profile_id='synthetic-session/1' AND stage='research'",
  )
  assert.equal(seen[1].instructions, `${profile.rows[0].text}\n\n${pack.rows[0].text}`)
  assert.ok(seen[1].tools.includes('read_lot'))

  // A sealed stage pack digest that doesn't match the stored pack is refused at claim.
  const { row: images } = await successorOf(stage, 'led 0603 red', 'images')
  const input = await sealedInput(stage.fixture, images.attempt_id)
  const tampered = {
    ...stageInput(input.manifest),
    stage_instructions_sha256: await packDigest(stage.fixture, 'research'),
  }
  const bytes = Buffer.from(canonicalRecord(tampered))
  const { createHash } = await import('node:crypto')
  await stage.fixture.db.pool.query(
    'ALTER TABLE processing_input DISABLE TRIGGER processing_input_immutable',
  )
  await stage.fixture.db.pool.query(
    'UPDATE processing_input SET manifest_bytes=$2,manifest_digest=$3 WHERE id=$1',
    [input.inputId, bytes, createHash('sha256').update(bytes).digest()],
  )
  await stage.fixture.db.pool.query(
    'ALTER TABLE processing_input ENABLE TRIGGER processing_input_immutable',
  )
  await assert.rejects(
    runSessionTurn(stage.deps, images.attempt_id, new AbortController().signal),
    /agent_input_invalid/,
  )
})

test('queueing follows the lead’s sealed version: a retained /6 lead never gets /7 successors', async (t) => {
  const batch = await formedBatch(t)
  const { fixture, deps, batchId, leadJob, leadAttempt } = batch
  fixture.config.stageInputs = 'local'
  // New evidence with a new item: the `/6` lead forms a lot and publishes its identity.
  await photoWithNote(fixture, batchId, 'Bag', '10k resistor')
  await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
  await transaction(fixture.runner.pool, (client) => queueSessionResume(client, leadJob))
  assert.equal(await runSessionTurn(deps, leadAttempt, new AbortController().signal), 'finished')
  const resistor = await batch.lot('10k resistor')
  const queued = await batch.successors(resistor.id)
  assert.equal(queued.length, 2)
  for (const row of queued) {
    assert.equal(
      decodeSessionInput(row.input_bytes, row.input_digest).schema_version,
      'bench-intake-input/6',
    )
  }
})

test('a legacy regroup supersedes a successor queued for a resume, and its replacement stays /6', async (t) => {
  const batch = await formedBatch(t)
  const { fixture, deps, batchId, leadJob, leadAttempt } = batch
  fixture.config.stageInputs = 'local'
  const { lot: led, row: research } = await successorOf(batch, 'led 0603 red', 'research')
  assert.equal(
    await runSessionTurn(deps, research.attempt_id, new AbortController().signal),
    'waiting_input',
  )
  await fixture.db.pool.query(
    `INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key)
     SELECT gen_random_uuid(),$1,COALESCE(max(seq),0)+1,'revision',$2::jsonb,'test-revision'
     FROM agent_session_inbox WHERE session_lineage_id=$1`,
    [research.job_id, JSON.stringify({ fields: ['identity'], reason: 'Revised.' })],
  )
  await transaction(fixture.runner.pool, (client) => queueSessionResume(client, research.job_id))
  // A later photo of the same reel joins the lot: the lead regroups it and republishes.
  await photoWithNote(fixture, batchId, 'Reel', 'LED 0603 red')
  await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
  await transaction(fixture.runner.pool, (client) => queueSessionResume(client, leadJob))
  assert.equal(await runSessionTurn(deps, leadAttempt, new AbortController().signal), 'finished')
  const prior = await fixture.db.pool.query<{ state: string }>(
    'SELECT state FROM processing_attempt WHERE id=$1',
    [research.attempt_id],
  )
  assert.equal(prior.rows[0].state, 'superseded')
  const replaced = (await batch.successors(led.id)).find((row) => row.stage === 'research')!
  assert.notEqual(replaced.attempt_id, research.attempt_id)
  assert.equal(
    decodeSessionInput(replaced.input_bytes, replaced.input_digest).schema_version,
    'bench-intake-input/6',
  )
})

test('replacement follows the lead’s sealed version, not the configuration', async (t) => {
  const batch = await formedBatch(t)
  const { fixture, batchId } = batch
  fixture.config.stageInputs = 'local'
  const { row } = await successorOf(batch, 'led 0603 red', 'images')
  await fixture.db.pool.query("UPDATE processing_attempt SET state='failed' WHERE id=$1", [
    row.attempt_id,
  ])
  await fixture.db.pool.query(
    "UPDATE agent_session SET session_state='failed' WHERE attempt_id=$1",
    [row.attempt_id],
  )
  const job = await fixture.db.pool.query<{ revision: string }>(
    'SELECT revision::text FROM processing_job WHERE id=$1',
    [row.job_id],
  )
  const receipt = await replaceSession(fixture.api.pool, fixture.config, batchId, row.job_id, 'r', {
    expected_capture_revision: (await snapshotOf(fixture, batchId)).revision,
    expected_revision: job.rows[0].revision,
    attempt_id: row.attempt_id,
  })
  const replaced = await sealedInput(fixture, (receipt as { attempt_ids: string[] }).attempt_ids[0])
  assert.equal(replaced.manifest.schema_version, 'bench-intake-input/6')
})

async function stageInputsOf(fixture: Fixture, attemptIds: readonly string[]) {
  const versions: [string, string][] = []
  for (const attemptId of attemptIds) {
    const { manifest } = await sealedInput(fixture, attemptId)
    versions.push([manifest.stage, manifest.schema_version])
  }
  return versions.sort()
}

test('Start before a lead follows the configuration on both synthetic routes', async (t) => {
  const { processingFixture } = await import('../support/processing.ts')
  for (const route of ['local', 'bridge'] as const) {
    const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
    t.after(() => fixture.dispose())
    // The bridge route never has the switch: its worker refuses it, so it keeps `/6`.
    if (route === 'local') {
      fixture.config.stageInputs = 'local'
    }
    const capture = await fixture.seedCapture()
    const batchId = capture.batch.id
    const started = await fixture.http(`/batches/${batchId}/processing`, {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.packetA.id],
      stages: ['research', 'images', 'inventory'],
    })
    if (route === 'local') {
      // A `/7` batch has no Inventory session; Research and Images seal briefs.
      assert.equal(started.status, 202, JSON.stringify(started.value))
      const ids = (started.value as { attempt_ids: string[] }).attempt_ids
      assert.deepEqual(await stageInputsOf(fixture, ids), [
        ['images', 'bench-intake-input/7'],
        ['research', 'bench-intake-input/7'],
      ])
      const inventoryOnly = await fixture.http(`/batches/${batchId}/processing`, {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: (await snapshotOf(fixture, batchId)).revision,
        subject_ids: [capture.packetA.id],
        stages: ['inventory'],
      })
      assert.equal(inventoryOnly.status, 422)
    } else {
      // Today's Start: Inventory waits for current Research and Images.
      assert.equal(started.status, 409)
      assert.equal((started.value as { code?: string }).code, 'inventory_waiting')
      const research = await fixture.http(`/batches/${batchId}/processing`, {
        schema_version: 'bench-intake-processing/1',
        expected_capture_revision: capture.batch.revision,
        subject_ids: [capture.packetA.id],
        stages: ['research', 'images'],
      })
      assert.equal(research.status, 202, JSON.stringify(research.value))
      const ids = (research.value as { attempt_ids: string[] }).attempt_ids
      assert.deepEqual(await stageInputsOf(fixture, ids), [
        ['images', 'bench-intake-input/6'],
        ['research', 'bench-intake-input/6'],
      ])
    }
  }
})

test('the brief is the same for an unchanged batch, and its entries stay within their sections', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { row } = await successorOf(batch, 'led 0603 red', 'research')
  const manifest = stageInput((await sealedInput(batch.fixture, row.attempt_id)).manifest)
  const first: SessionBriefDto = await currentBrief(batch.fixture, batch.batchId, manifest)
  const second = await currentBrief(batch.fixture, batch.batchId, manifest)
  assert.equal(canonicalRecord(first), canonicalRecord(second))
  let offset = 0
  for (const section of first.sections) {
    offset += section.count
  }
  assert.equal(offset, first.entries.length)
})

test('a kept current view larger than the default JSON bound reads back', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture } = batch
  const { row } = await successorOf(batch, 'led 0603 red', 'research')
  const manifest = stageInput((await sealedInput(fixture, row.attempt_id)).manifest)
  const base = await currentBrief(fixture, batch.batchId, manifest)
  // About 400 KiB of notes: past the 256 KiB a retained document parses to by default.
  const notes: BriefEntryDto[] = Array.from({ length: 50 }, (_, index) => ({
    kind: 'note',
    source: 'human',
    note_id: `7c3e1d04-92ab-4f6e-b81d-${index.toString(16).padStart(12, '0')}`,
    subject_id: null,
    text: 'n'.repeat(8000),
    text_sha256: 'a'.repeat(64),
    actor_id: fixture.identity.actor,
    created_at: '2026-11-25T00:00:00.000Z',
  }))
  const large = {
    ...base,
    sections: base.sections.map((section) =>
      section.name === 'human' ? { ...section, count: section.count + notes.length } : section,
    ),
    entries: [...base.entries.slice(0, 1), ...notes, ...base.entries.slice(1)],
  }
  assert.ok(Buffer.byteLength(canonicalRecord(large)) > 256 * 1024)
  const read = await transaction(fixture.runner.pool, async (client) => {
    assert.equal(await keepCurrentView(client, row.attempt_id, large), true)
    return keptCurrentView(client, row.attempt_id, briefDigest(large))
  })
  assert.equal(canonicalRecord(read), canonicalRecord(large))
})

test('an entry larger than a page has a page of its own', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const led = await batch.lot('led 0603 red')
  // The longest note capture allows, in four-byte characters: over 32 KiB as one entry.
  await edit(fixture, batchId, { kind: 'note', subject_id: led.id, text: '\u{1F4C4}'.repeat(8192) })
  const attemptId = await requeueResearch(fixture, batchId, led.id)
  const manifest = stageInput((await sealedInput(fixture, attemptId)).manifest)
  const alone = manifest.brief.pages.find((page) =>
    page.entries?.some((entry) => entry.kind === 'note' && entry.text.length === 16384),
  )
  assert.ok(alone, 'the note is sealed')
  assert.equal(alone.entry_count, 1)
  await withClients(async (open) => {
    const session = await open(batch.deps.toolUrl, await running(fixture, attemptId))
    const pages = await allPages(session, led.id, {})
    assert.ok(pages.some((page) => page.entries.length === 1 && page.entries[0].kind === 'note'))
  })
})

test("reads at once keep the view bound and don't fail on each other", async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const { lot: led, row } = await successorOf(batch, 'led 0603 red', 'research')
  await withClients(async (open) => {
    // Two connections of the same run, as a provider may open.
    const token = await running(fixture, row.attempt_id)
    const session = await open(batch.deps.toolUrl, token)
    const second = await open(batch.deps.toolUrl, token)
    // Two first reads of the same view at once.
    const same = await Promise.all([
      call(session, 'read_lot', { lot_id: led.id }),
      call(session, 'read_lot', { lot_id: led.id }),
    ])
    assert.deepEqual(
      same.map((read) => read.ok),
      [true, true],
    )
    for (let index = 0; index < BRIEF_VIEWS_PER_ATTEMPT - 1; index += 1) {
      await edit(fixture, batchId, { kind: 'note', subject_id: led.id, text: `View ${index}.` })
      assert.equal((await call(session, 'read_lot', { lot_id: led.id })).ok, true)
    }
    // Two new views at once on a full store: the bound still holds.
    await edit(fixture, batchId, { kind: 'note', subject_id: led.id, text: 'One more.' })
    const first = call(session, 'read_lot', { lot_id: led.id })
    await edit(fixture, batchId, { kind: 'note', subject_id: led.id, text: 'And another.' })
    const reads = await Promise.all([first, call(second, 'read_lot', { lot_id: led.id })])
    assert.ok(reads.every((read) => read.ok))
    const kept = await fixture.db.pool.query(
      'SELECT 1 FROM processing_brief_view WHERE attempt_id=$1',
      [row.attempt_id],
    )
    assert.ok(kept.rowCount! <= BRIEF_VIEWS_PER_ATTEMPT)
  })
})

test('Start pins the lot’s own identity, not another lot’s that cites its observations', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId, leadAttempt } = batch
  const led = await batch.lot('led 0603 red')
  const crystal = await batch.lot('16 mhz crystal')
  const [ledIdentity] = await batch.identities(led.id)
  // The lead publishes an identity about the crystal that also cites the LED lot's set.
  const value = await fixture.db.pool.query<{ value: { sources: unknown[] } }>(
    "SELECT convert_from(value_bytes,'UTF8')::jsonb AS value FROM processing_proposal WHERE id=$1",
    [ledIdentity.id],
  )
  await withClients(async (open) => {
    const lead = await open(batch.deps.toolUrl, await running(fixture, leadAttempt))
    const published = await call(lead, 'propose', {
      proposal: {
        schema_version: 'bench-intake-proposal/5',
        subject_id: crystal.id,
        summary: 'The crystal, read beside the LED reel.',
        sources: value.rows[0].value.sources,
        relies_on: {
          fields: ['identity'],
          sources: [
            ...value.rows[0].value.sources,
            { kind: 'observation_set', lot_id: led.id, version: led.observation_set_version },
          ],
        },
      },
    })
    assert.equal(published.ok, true, JSON.stringify(published))
  })
  const attemptId = await requeueResearch(fixture, batchId, led.id)
  const manifest = stageInput((await sealedInput(fixture, attemptId)).manifest)
  assert.deepEqual(manifest.pinned_proposal_ids, [ledIdentity.id])
})

test('without the switch, a /7 lead’s batch seals no new /7 input', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true })
  const { fixture, batchId } = batch
  const led = await batch.lot('led 0603 red')
  delete fixture.config.stageInputs
  const started = await fixture.http(`/batches/${batchId}/processing`, {
    schema_version: 'bench-intake-processing/1',
    expected_capture_revision: (await snapshotOf(fixture, batchId)).revision,
    subject_ids: [led.id],
    stages: ['research'],
  })
  assert.equal(started.status, 422)
  assert.equal((started.value as { code: string }).code, 'unsupported_processing_profile')
})
