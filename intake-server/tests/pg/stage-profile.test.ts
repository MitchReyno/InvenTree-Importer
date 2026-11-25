import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { validate } from '@invimport/contracts'
import type { BriefEntryDto, ProcessingInputV7Dto, SessionInputDto } from '@invimport/contracts'
import { canonicalRecord } from '@invimport/contracts/json'
import { formedBatch, photoWithNote, type Fixture } from '../support/lot-pipeline.ts'
import { processingFixture } from '../support/processing.ts'
import { transaction } from '#/db/database.ts'
import { captureInTransaction } from '#/capture/repository.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import { triggerExamine } from '#/processing/examine-trigger.ts'
import { assembleBrief } from '#/processing/brief.ts'
import { briefScope, decodeSessionInput } from '#/processing/session-input.ts'
import { sessionProfiles } from '#/processing/session-policy.ts'
import { stagePacks } from '#/processing/stage-policy.ts'
import {
  closeWithin,
  openingText,
  runSessionTurn,
  syntheticSessionDriver,
  type SessionDriver,
} from '#/agents/session/session-runner.ts'

type Batch = Awaited<ReturnType<typeof formedBatch>>

interface ToolResult {
  ok: boolean
  error?: string
  sections?: { section: string; title: string }[]
  section?: { section: string; title: string; text: string }
  vocabulary?: {
    entries: Extract<BriefEntryDto, { kind: 'vocabulary' }>[]
    total: number
    next_page_token?: string
  }
}

const EXAMINE_GUIDE = [
  'transcription',
  'packaging-and-nos',
  'quantities',
  'inspect-region',
  'logos',
  'logo-look-alikes',
  'same-part',
]
const RESEARCH_GUIDE = [
  'modes',
  'nsn-and-data-books',
  'datasheets',
  'identity-and-specifications',
  'naming-and-notes',
  'vocabulary-and-gaps',
  'logos',
  'logo-look-alikes',
  'same-part',
]
const IMAGES_GUIDE = [
  'what-to-crop',
  'bounds',
  'framing',
  'upright-and-straighten',
  'light',
  'review',
]
/** About 1.8 KB, as Mitch asked; the guard leaves room for a few characters of drift. */
const GUIDE_SECTION_MAX_BYTES = 1900

function hex(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex')
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
    manifest: decodeSessionInput(row.manifest_bytes, row.manifest_digest),
  }
}

function stageInput(manifest: SessionInputDto): ProcessingInputV7Dto {
  assert.equal(manifest.schema_version, 'bench-intake-input/7')
  return manifest as ProcessingInputV7Dto
}

async function successorOf(batch: Batch, label: string, stage: 'research' | 'images') {
  const lot = await batch.lot(label)
  const row = (await batch.successors(lot.id)).find((item) => item.stage === stage)!
  return { lot, row }
}

async function profileText(fixture: Fixture, profileId: string) {
  const rows = await fixture.db.pool.query<{ text: string }>(
    "SELECT convert_from(instruction_bytes,'UTF8') AS text FROM processing_profile WHERE id=$1",
    [profileId],
  )
  return rows.rows[0].text
}

async function packText(fixture: Fixture, profileId: string, stage: string) {
  const rows = await fixture.db.pool.query<{ text: string }>(
    `SELECT convert_from(instruction_bytes,'UTF8') AS text FROM processing_stage_instructions
     WHERE profile_id=$1 AND stage=$2`,
    [profileId, stage],
  )
  return rows.rows[0].text
}

async function guideRows(fixture: Fixture, profileId: string, stage: string) {
  const rows = await fixture.db.pool.query<{ section: string; text: string; bytes: number }>(
    `SELECT section,convert_from(text_bytes,'UTF8') AS text,octet_length(text_bytes) AS bytes
     FROM processing_stage_guide WHERE profile_id=$1 AND stage=$2 ORDER BY position`,
    [profileId, stage],
  )
  return rows.rows
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

/** Opens MCP clients for the test body and closes them before the fixtures go. */
async function withClients(
  work: (open: (url: string, token: string) => Promise<Client>) => Promise<void>,
) {
  const clients: Client[] = []
  try {
    await work(async (url, token) => {
      const client = new Client({ name: 'stage-profile-test', version: '1' })
      await client.connect(
        new StreamableHTTPClientTransport(new URL(url), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      )
      clients.push(client)
      return client
    })
  } finally {
    await Promise.all(clients.map((client) => closeWithin(client, 5_000)))
  }
}

/** A tool's structured result, checked against the tool result contract as it arrived. */
async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args })
  validate('SessionToolResult', result.structuredContent)
  return result.structuredContent as unknown as ToolResult
}

async function toolNames(client: Client) {
  return (await client.listTools()).tools.map((tool) => tool.name).sort()
}

function recording(seen: { instructions: string; tools: string[] }[]): SessionDriver {
  return async (turn, context) => {
    seen.push({ instructions: turn.instructions, tools: [...turn.tools] })
    await syntheticSessionDriver(turn, context)
  }
}

/** Records catalogue observations on the batch, as the observation command would. */
async function observe(
  fixture: Fixture,
  batchId: string,
  rows: { model: string; pk: string; label: string; mapping: object | null }[],
) {
  const identity = await fixture.db.pool.query<{ target_id: string; target_context_id: string }>(
    'SELECT target_id,target_context_id FROM capture_batch WHERE id=$1',
    [batchId],
  )
  const { target_id: targetId, target_context_id: contextId } = identity.rows[0]
  const ids: string[] = []
  for (const row of rows) {
    const id = randomUUID()
    ids.push(id)
    await fixture.db.pool.query(
      `INSERT INTO capture_observation(id,batch_id,target_id,target_context_id,model,pk,label,mapping)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, batchId, targetId, contextId, row.model, row.pk, row.label, row.mapping],
    )
  }
  return { ids, contextId }
}

const CATALOGUE = [
  { model: 'category', pk: '12', label: 'Diodes', mapping: { kind: 'category' } },
  {
    model: 'parameter_template',
    pk: '31',
    label: 'Forward Voltage',
    mapping: { kind: 'parameter_template', model_type: 'part.part', enabled: true },
  },
  {
    model: 'category_parameter',
    pk: '44',
    label: 'Diodes: Forward Voltage',
    mapping: { kind: 'category_parameter', category_id: '12', template_id: '31' },
  },
  {
    model: 'company',
    pk: '7',
    label: 'Diodes Incorporated',
    mapping: { kind: 'company', manufacturer: true, supplier: false },
  },
  // A Part observation is not vocabulary.
  { model: 'part', pk: '900', label: '1N4148W-7-F', mapping: null },
]

test('the /4 profile row, its stage packs and guides match the policy and are immutable', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/4' })
  t.after(() => fixture.dispose())
  const profile = await fixture.db.pool.query<{
    handler_version: string
    tool_profile_version: string
    qualification: string
    instruction_bytes: Buffer
    instruction_digest: Buffer
  }>("SELECT * FROM processing_profile WHERE id='shared-vm-agent/4'")
  const row = profile.rows[0]
  assert.equal(row.handler_version, 'processing/5')
  assert.equal(row.tool_profile_version, 'native-session-stage-tools/1')
  assert.equal(row.qualification, 'native_unverified')
  const policy = sessionProfiles['shared-vm-agent/4']
  assert.equal(policy.instructionVersion, 'shared-vm-agent/4')
  assert.equal(policy.toolProfileVersion, 'native-session-stage-tools/1')
  assert.equal(row.instruction_digest.toString('hex'), policy.instructionDigest)
  assert.equal(hex(row.instruction_bytes), policy.instructionDigest)
  const base = row.instruction_bytes.toString('utf8')
  assert.match(base, /Weigh facts in this order/)
  assert.match(base, /Attach pictures in figures only when seeing the item helps/)

  for (const stage of ['examine', 'research', 'images'] as const) {
    const packs = await fixture.db.pool.query<{ digest: string }>(
      `SELECT encode(instruction_digest,'hex') AS digest FROM processing_stage_instructions
       WHERE profile_id='shared-vm-agent/4' AND stage=$1`,
      [stage],
    )
    assert.equal(packs.rows[0].digest, stagePacks['shared-vm-agent/4']![stage])
  }
  assert.match(await packText(fixture, 'shared-vm-agent/4', 'examine'), /examine-identity\/1/)
  assert.match(
    await packText(fixture, 'shared-vm-agent/4', 'examine'),
    /Use web search only to read an unfamiliar logo or marking/,
  )
  assert.match(await packText(fixture, 'shared-vm-agent/4', 'research'), /research-identity\/1/)
  assert.match(await packText(fixture, 'shared-vm-agent/4', 'images'), /propose_images/)

  // Each stage's guide holds its sections in order, each within its size.
  const guides = {
    examine: await guideRows(fixture, 'shared-vm-agent/4', 'examine'),
    research: await guideRows(fixture, 'shared-vm-agent/4', 'research'),
    images: await guideRows(fixture, 'shared-vm-agent/4', 'images'),
  }
  assert.deepEqual(
    guides.examine.map((item) => item.section),
    EXAMINE_GUIDE,
  )
  assert.deepEqual(
    guides.research.map((item) => item.section),
    RESEARCH_GUIDE,
  )
  assert.deepEqual(
    guides.images.map((item) => item.section),
    IMAGES_GUIDE,
  )
  for (const item of [...guides.examine, ...guides.research, ...guides.images]) {
    assert.ok(item.bytes <= GUIDE_SECTION_MAX_BYTES, `${item.section} is ${item.bytes} bytes`)
  }
  // The sections both stages read are the same text.
  for (const section of ['logos', 'logo-look-alikes', 'same-part']) {
    assert.equal(
      guides.examine.find((item) => item.section === section)!.text,
      guides.research.find((item) => item.section === section)!.text,
    )
  }
  // Every guide section a pack names exists in that stage's guide.
  for (const stage of ['examine', 'research', 'images'] as const) {
    const named = /Guides: ([a-z, -]+)\./.exec(await packText(fixture, 'shared-vm-agent/4', stage))!
    assert.deepEqual(
      named[1].split(', '),
      guides[stage].map((item) => item.section),
    )
  }

  await assert.rejects(
    fixture.db.pool.query(
      "UPDATE processing_stage_guide SET title='Changed' WHERE profile_id='shared-vm-agent/4'",
    ),
  )
  await assert.rejects(
    fixture.db.pool.query(
      "DELETE FROM processing_stage_instructions WHERE profile_id='shared-vm-agent/4'",
    ),
  )
  // Earlier profiles keep their rows.
  const earlier = await fixture.db.pool.query<{ digest: string }>(
    "SELECT encode(instruction_digest,'hex') AS digest FROM processing_profile WHERE id='shared-vm-agent/3'",
  )
  assert.equal(earlier.rows[0].digest, sessionProfiles['shared-vm-agent/3'].instructionDigest)
})

test('a /4 session seals its stage pack under the switch, and the claim checks it', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, profileId: 'shared-vm-agent/4' })
  const { fixture, leadAttempt } = batch
  const lead = stageInput((await sealedInput(fixture, leadAttempt)).manifest)
  assert.equal(lead.profile_id, 'shared-vm-agent/4')
  assert.equal(lead.instruction_version, 'shared-vm-agent/4')
  assert.equal(lead.tool_profile_version, 'native-session-stage-tools/1')
  assert.equal(lead.stage_instructions_sha256, stagePacks['shared-vm-agent/4']!.examine)

  const seen: { instructions: string; tools: string[] }[] = []
  const deps = { ...batch.deps, drivers: { 'shared-vm-agent/4': recording(seen) } }
  const { row: research } = await successorOf(batch, 'led 0603 red', 'research')
  const sealed = stageInput((await sealedInput(fixture, research.attempt_id)).manifest)
  assert.equal(sealed.stage_instructions_sha256, stagePacks['shared-vm-agent/4']!.research)
  await runSessionTurn(deps, research.attempt_id, new AbortController().signal)
  const base = await profileText(fixture, 'shared-vm-agent/4')
  assert.equal(
    seen[0].instructions,
    `${base}\n\n${await packText(fixture, 'shared-vm-agent/4', 'research')}`,
  )
  assert.ok(seen[0].tools.includes('read_lot'))
  assert.ok(seen[0].tools.includes('read_guide'))
  assert.ok(seen[0].tools.includes('read_vocabulary'))

  // A sealed pack digest that doesn't match the stored pack is refused at claim.
  const { row: images } = await successorOf(batch, 'led 0603 red', 'images')
  const input = await sealedInput(fixture, images.attempt_id)
  const tampered = {
    ...stageInput(input.manifest),
    stage_instructions_sha256: stagePacks['shared-vm-agent/4']!.research,
  }
  const bytes = Buffer.from(canonicalRecord(tampered))
  await fixture.db.pool.query(
    'ALTER TABLE processing_input DISABLE TRIGGER processing_input_immutable',
  )
  await fixture.db.pool.query(
    'UPDATE processing_input SET manifest_bytes=$2,manifest_digest=$3 WHERE id=$1',
    [input.inputId, bytes, createHash('sha256').update(bytes).digest()],
  )
  await fixture.db.pool.query(
    'ALTER TABLE processing_input ENABLE TRIGGER processing_input_immutable',
  )
  await assert.rejects(
    runSessionTurn(batch.deps, images.attempt_id, new AbortController().signal),
    /agent_input_invalid/,
  )
})

test('without the switch a /4 configuration seals no session input', async (t) => {
  const fixture = await processingFixture({ profileId: 'shared-vm-agent/4' })
  t.after(() => fixture.dispose())
  const capture = await fixture.seedCapture()
  await photoWithNote(fixture, capture.batch.id, 'Tray', 'LED 0603 red')
  const result = await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
  assert.deepEqual(result.created, [])
  const jobs = await fixture.db.pool.query('SELECT 1 FROM processing_job WHERE batch_id=$1', [
    capture.batch.id,
  ])
  assert.equal(jobs.rowCount, 0)
})

test('a /4 opening leaves the sealed rules to its packs; synthetic /7 keeps them', async (t) => {
  const stage = await formedBatch(t, { stageInputs: true, profileId: 'shared-vm-agent/4' })
  const synthetic = await formedBatch(t, { stageInputs: true })
  const sealedRules = [
    'You are this batch’s Examine lead session',
    'Ask the operator one question.',
    'Put catalogue values in the proposal’s catalogue block',
  ]
  const kept = ['Your brief is in brief', 'Check read_inbox whenever pending_inbox is above zero']
  const stageLead = (await sealedInput(stage.fixture, stage.leadAttempt)).manifest
  const stageOpening = openingText(stageLead, 0, false, stage.leadAttempt)
  for (const rule of sealedRules) {
    assert.equal(stageOpening.includes(rule), false, rule)
  }
  for (const line of kept) {
    assert.ok(stageOpening.includes(line), line)
  }
  // No /4 opening names a publishing tool: the Images pack publishes with propose_images.
  for (const stageName of ['research', 'images'] as const) {
    const { row } = await successorOf(stage, 'led 0603 red', stageName)
    const lot = (await sealedInput(stage.fixture, row.attempt_id)).manifest
    const opening = openingText(lot, 0, false, row.attempt_id)
    assert.equal(opening.includes('publish proposals with propose'), false, stageName)
    assert.ok(opening.includes('Your brief is in brief'), stageName)
  }
  const syntheticLead = (await sealedInput(synthetic.fixture, synthetic.leadAttempt)).manifest
  const syntheticOpening = openingText(syntheticLead, 0, false, synthetic.leadAttempt)
  for (const rule of [...sealedRules, ...kept]) {
    assert.ok(syntheticOpening.includes(rule), rule)
  }
})

test('read_guide serves the stage’s sealed sections, the same for every session of the profile', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, profileId: 'shared-vm-agent/4' })
  const { fixture, deps, leadAttempt } = batch
  const { row: research } = await successorOf(batch, 'led 0603 red', 'research')
  const { row: images } = await successorOf(batch, 'led 0603 red', 'images')
  const { row: other } = await successorOf(batch, '16 mhz crystal', 'research')
  const leadToken = await running(fixture, leadAttempt)
  const researchToken = await running(fixture, research.attempt_id)
  const imagesToken = await running(fixture, images.attempt_id)
  const otherToken = await running(fixture, other.attempt_id)
  const examineGuide = await guideRows(fixture, 'shared-vm-agent/4', 'examine')
  await withClients(async (open) => {
    const lead = await open(deps.toolUrl, leadToken)
    const researcher = await open(deps.toolUrl, researchToken)
    const imager = await open(deps.toolUrl, imagesToken)
    const peer = await open(deps.toolUrl, otherToken)
    assert.ok((await toolNames(lead)).includes('read_guide'))
    assert.ok((await toolNames(imager)).includes('read_guide'))

    const listed = await call(lead, 'read_guide', {})
    assert.equal(listed.ok, true)
    assert.deepEqual(
      listed.sections!.map((item) => item.section),
      EXAMINE_GUIDE,
    )
    assert.ok(listed.sections!.every((item) => item.title.length > 0))

    const lookAlikes = await call(lead, 'read_guide', { section: 'logo-look-alikes' })
    assert.equal(
      lookAlikes.section!.text,
      examineGuide.find((item) => item.section === 'logo-look-alikes')!.text,
    )
    assert.match(lookAlikes.section!.text, /dtc1/)
    // Two Research sessions of the profile read the same text, and it is Examine's too.
    const first = await call(researcher, 'read_guide', { section: 'logo-look-alikes' })
    const second = await call(peer, 'read_guide', { section: 'logo-look-alikes' })
    assert.equal(first.section!.text, lookAlikes.section!.text)
    assert.equal(second.section!.text, first.section!.text)

    // A section of another stage's guide, or none at all, is a correctable refusal.
    const crop = await call(lead, 'read_guide', { section: 'framing' })
    assert.equal(crop.ok, false)
    assert.equal(crop.error, 'validation_failed')
    assert.equal((await call(imager, 'read_guide', { section: 'framing' })).ok, true)

    // A section added after the profile was sealed stops the guide being served at all.
    await fixture.db.pool.query(
      `INSERT INTO processing_stage_guide(profile_id,stage,section,position,title,text_bytes,text_digest)
       VALUES('shared-vm-agent/4','examine','extra',8,'Extra',convert_to('Added later.','UTF8'),
         sha256(convert_to('Added later.','UTF8')))`,
    )
    for (const args of [{}, { section: 'extra' }, { section: 'logos' }]) {
      const refused = await call(lead, 'read_guide', args)
      assert.equal(refused.ok, false)
      assert.equal(refused.error, 'tool_failed')
    }
    assert.equal((await call(researcher, 'read_guide', { section: 'logos' })).ok, true)
  })
})

test('a /6 session is offered neither read_guide nor read_vocabulary', async (t) => {
  const legacy = await formedBatch(t)
  const { row } = await successorOf(legacy, 'led 0603 red', 'research')
  const token = await running(legacy.fixture, row.attempt_id)
  await withClients(async (open) => {
    const names = await toolNames(await open(legacy.deps.toolUrl, token))
    assert.equal(names.includes('read_guide'), false)
    assert.equal(names.includes('read_vocabulary'), false)
  })
})

test('read_vocabulary lists the batch’s catalogue records by kind and name, in pages', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, profileId: 'shared-vm-agent/4' })
  const { fixture, deps, batchId, leadAttempt } = batch
  const { ids, contextId } = await observe(fixture, batchId, CATALOGUE)
  const { row: research } = await successorOf(batch, 'led 0603 red', 'research')
  const { row: images } = await successorOf(batch, 'led 0603 red', 'images')
  const researchToken = await running(fixture, research.attempt_id)
  const imagesToken = await running(fixture, images.attempt_id)
  const leadToken = await running(fixture, leadAttempt)
  await withClients(async (open) => {
    const researcher = await open(deps.toolUrl, researchToken)
    assert.equal(
      (await toolNames(await open(deps.toolUrl, imagesToken))).includes('read_vocabulary'),
      false,
    )
    assert.equal(
      (await toolNames(await open(deps.toolUrl, leadToken))).includes('read_vocabulary'),
      false,
    )

    const all = await call(researcher, 'read_vocabulary', {})
    assert.equal(all.ok, true)
    assert.equal(all.vocabulary!.total, 4)
    assert.equal(all.vocabulary!.next_page_token, undefined)
    const category = all.vocabulary!.entries.find((entry) => entry.reference.model === 'category')!
    assert.deepEqual(category.reference, {
      observation_id: ids[0],
      target_context_id: contextId,
      model: 'category',
      pk: '12',
    })
    assert.equal(category.label, 'Diodes')
    assert.equal(
      all.vocabulary!.entries.some((entry) => (entry.reference.model as string) === 'part'),
      false,
    )

    const companies = await call(researcher, 'read_vocabulary', { kind: 'company' })
    assert.deepEqual(
      companies.vocabulary!.entries.map((entry) => entry.label),
      ['Diodes Incorporated'],
    )
    assert.deepEqual(companies.vocabulary!.entries[0].mapping, {
      kind: 'company',
      manufacturer: true,
      supplier: false,
    })
    const diodes = await call(researcher, 'read_vocabulary', { search: 'DIOD' })
    assert.deepEqual(diodes.vocabulary!.entries.map((entry) => entry.label).sort(), [
      'Diodes',
      'Diodes Incorporated',
      'Diodes: Forward Voltage',
    ])

    // More than a page continues with its token, under the same filter only.
    await observe(
      fixture,
      batchId,
      Array.from({ length: 60 }, (_, index) => ({
        model: 'category',
        pk: String(100 + index),
        label: `Category ${String(index).padStart(2, '0')}`,
        mapping: { kind: 'category' },
      })),
    )
    const first = await call(researcher, 'read_vocabulary', { kind: 'category' })
    assert.equal(first.vocabulary!.total, 61)
    assert.equal(first.vocabulary!.entries.length, 50)
    const token = first.vocabulary!.next_page_token!
    assert.ok(token)
    const second = await call(researcher, 'read_vocabulary', {
      kind: 'category',
      page_token: token,
    })
    assert.equal(second.vocabulary!.entries.length, 11)
    assert.equal(second.vocabulary!.next_page_token, undefined)
    const labels = [...first.vocabulary!.entries, ...second.vocabulary!.entries].map(
      (entry) => entry.label,
    )
    assert.equal(new Set(labels).size, 61)
    const mismatched = await call(researcher, 'read_vocabulary', {
      kind: 'company',
      page_token: token,
    })
    assert.equal(mismatched.ok, false)
    assert.equal(mismatched.error, 'validation_failed')

    // A record that sorts before the page boundary, added between pages, makes the token stale
    // rather than repeat or skip an entry.
    await observe(fixture, batchId, [
      { model: 'category', pk: '99', label: 'Category 00a', mapping: { kind: 'category' } },
    ])
    const stale = await call(researcher, 'read_vocabulary', { kind: 'category', page_token: token })
    assert.equal(stale.ok, false)
    assert.equal(stale.error, 'stale')
  })
})

/** A token's cursor with another offset, as a session could forge it. */
function withOffset(token: string, offset: number) {
  const cursor = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as object
  return Buffer.from(canonicalRecord({ ...cursor, offset }), 'utf8').toString('base64url')
}

test('vocabulary tokens hold any search and only the offsets they were issued with', async (t) => {
  const batch = await formedBatch(t, { stageInputs: true, profileId: 'shared-vm-agent/4' })
  const { fixture, deps, batchId } = batch
  // The longest search, in four-byte characters, within the batch's 100 read observations.
  const search = '\u{1F50C}'.repeat(100)
  await observe(
    fixture,
    batchId,
    Array.from({ length: 51 }, (_, index) => ({
      model: 'company',
      pk: String(500 + index),
      label: `${search} ${index}`,
      mapping: { kind: 'company', manufacturer: false, supplier: true },
    })),
  )
  const { row: research } = await successorOf(batch, 'led 0603 red', 'research')
  const token = await running(fixture, research.attempt_id)
  await withClients(async (open) => {
    const researcher = await open(deps.toolUrl, token)
    const plugs = await call(researcher, 'read_vocabulary', { search })
    assert.equal(plugs.vocabulary!.total, 51)
    const next = plugs.vocabulary!.next_page_token!
    const rest = await call(researcher, 'read_vocabulary', { search, page_token: next })
    assert.equal(rest.ok, true)
    assert.equal(rest.vocabulary!.entries.length, 1)
    // An offset the tool didn't issue, inside the list or past it, is refused, not served.
    for (const offset of [1, 100]) {
      const forged = await call(researcher, 'read_vocabulary', {
        search,
        page_token: withOffset(next, offset),
      })
      assert.equal(forged.ok, false, String(offset))
      assert.equal(forged.error, 'validation_failed', String(offset))
    }
  })
})

test('a Research brief seals the vocabulary; Examine and Images briefs have no such section', async (t) => {
  const batch = await formedBatch(t, {
    stageInputs: true,
    profileId: 'shared-vm-agent/4',
    beforeExamine: async (fixture, batchId) => {
      await observe(fixture, batchId, CATALOGUE)
    },
  })
  const { fixture, batchId, leadAttempt } = batch
  const sealedEntries = async (attemptId: string) => {
    const manifest = stageInput((await sealedInput(fixture, attemptId)).manifest)
    return manifest.brief.pages.flatMap((page) => page.entries ?? [])
  }
  const labels = (entries: readonly BriefEntryDto[]) =>
    entries
      .filter((entry) => entry.kind === 'vocabulary')
      .map((entry) => (entry as { label: string }).label)
      .sort()
  const { row: research } = await successorOf(batch, 'led 0603 red', 'research')
  const { row: images } = await successorOf(batch, 'led 0603 red', 'images')
  const sealed = stageInput((await sealedInput(fixture, research.attempt_id)).manifest)
  assert.equal(sealed.brief.sections.find((section) => section.name === 'vocabulary')!.count, 4)
  assert.deepEqual(labels(await sealedEntries(research.attempt_id)), [
    'Diodes',
    'Diodes Incorporated',
    'Diodes: Forward Voltage',
    'Forward Voltage',
  ])
  for (const attemptId of [leadAttempt, images.attempt_id]) {
    assert.deepEqual(labels(await sealedEntries(attemptId)), [])
  }

  // A record observed after sealing reaches the current view, not the sealed brief.
  await observe(fixture, batchId, [
    { model: 'category', pk: '13', label: 'Rectifiers', mapping: { kind: 'category' } },
  ])
  const current = await transaction(fixture.runner.pool, async (client) => {
    const capture = await captureInTransaction(client, fixture.config, batchId)
    return assembleBrief(client, fixture.config, capture.snapshot, briefScope(sealed))
  })
  assert.ok(labels(current.entries).includes('Rectifiers'))
  assert.equal(labels(await sealedEntries(research.attempt_id)).includes('Rectifiers'), false)
})
