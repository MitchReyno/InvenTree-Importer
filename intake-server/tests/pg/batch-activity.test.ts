import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate, type BatchActivityDto } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { leadSession, lotSession, oneStepAsk, seedPhoto } from '../support/sessions.ts'
import { transaction } from '#/db/database.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import { sessionTools } from '#/agents/tools/handlers.ts'
import { submitSessionInbox } from '#/agents/tools/inbox.ts'

type Fixture = Awaited<ReturnType<typeof processingFixture>>
type Capture = Awaited<ReturnType<Fixture['seedCapture']>>

/** More sessions than the Agents read's first page holds. */
const MORE_THAN_AN_AGENTS_PAGE = 51

async function withFixture(run: (fixture: Fixture, capture: Capture) => Promise<void>) {
  const fixture = await processingFixture({ profileId: 'synthetic-session/1' })
  try {
    await run(fixture, await fixture.seedCapture())
  } finally {
    await fixture.dispose()
  }
}

async function readActivity(fixture: Fixture, batchId: string, limit?: number) {
  const query = limit === undefined ? '' : `?limit=${limit}`
  const read = await fixture.http(`/batches/${batchId}/processing/activity${query}`)
  assert.equal(read.status, 200, JSON.stringify(read.value))
  validate('BatchActivity', read.value)
  return read.value as BatchActivityDto
}

function tools(fixture: Fixture) {
  const handlers = sessionTools({
    pool: fixture.runner.pool,
    writerPool: fixture.writer.pool,
    config: fixture.config,
    statusIntervalMs: 0,
    imageBudget: new Map(),
    deliveredMedia: new Map(),
  })
  return async (name: keyof typeof handlers, token: string, args: unknown) => {
    const output = await handlers[name](token, args)
    assert.equal(output.result.ok, true, JSON.stringify(output.result))
    return output.result as { ok: true; id?: string; revision?: string }
  }
}

function issue(fixture: Fixture, attemptId: string) {
  return transaction(fixture.runner.pool, (client) => issueSessionCapability(client, attemptId))
}

/** Finished sessions on new lots, each queued after the last, so they fill the Agents page. */
async function fillerSessions(fixture: Fixture, capture: Capture, count: number) {
  for (let index = 0; index < count; index++) {
    await capture.edit({
      kind: 'add_lot',
      label: `Filler ${index}`,
      note: 'Finished earlier.',
      part_subject_id: null,
    })
    const lot = capture.batch.lots.find((candidate) => candidate.label === `Filler ${index}`)!
    await lotSession(fixture, capture, lot)
  }
}

test('the batch activity read returns the newest actions across jobs, with each job’s latest status', async () => {
  await withFixture(async (fixture, capture) => {
    const batchId = capture.batch.id
    const call = tools(fixture)
    const lead = await leadSession(fixture, capture)
    const leadToken = await issue(fixture, lead.attempt)
    const research = await lotSession(fixture, capture, capture.packetA)
    const researchToken = await issue(fixture, research.attempt)
    // Sessions queued after these push Packet A's off the Agents read's first page.
    await fillerSessions(fixture, capture, MORE_THAN_AN_AGENTS_PAGE)
    const photo = await seedPhoto(fixture, batchId, { width: 768, height: 512 }, 'Bench bag')
    await submitSessionInbox(fixture.api.pool, {
      binding: fixture.config,
      batchId,
      lineageId: lead.job,
      actorId: null,
      idempotencyKey: photo.version,
      kind: 'evidence',
      payload: { evidence_id: photo.evidence, version_id: photo.version },
    })

    // Examine records an observation before any lot holds it, then forms a lot from it.
    let revision = capture.batch.revision
    const observed = await call('record_observation', leadToken, {
      base_revision: revision,
      evidence_version_id: photo.version,
      region: {
        kind: 'pixels',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        source_width: 768,
        source_height: 512,
      },
      readings: { markings: ['S2CN1'] },
    })
    revision = observed.revision!
    await call('status', leadToken, { text: 'lot stable, examine complete' })
    const formed = await call('propose_lot', leadToken, {
      base_revision: revision,
      label: 'GE S2CN1 diodes',
      observation_ids: [observed.id],
      estimated_quantity: '25',
      quantity_basis: 'About 25 in the bag',
    })

    // Research asks about Packet A; its status line is the note, not an entry.
    await call('status', researchToken, { text: 'no public datasheet found' })
    await call(
      'ask',
      researchToken,
      oneStepAsk({
        kind: 'clarification',
        subject_id: capture.packetA.id,
        prompt: 'Is the second date code on the same reel?',
        reason: 'Two date codes are visible.',
        fields: ['identity'],
        assumption: 'Treating them as one reel.',
      }),
    )

    const activity = await readActivity(fixture, batchId)
    const kinds = activity.entries.map((item) => item.entry.details.kind)
    assert.deepEqual(kinds, ['question', 'lot', 'observation'])
    const [asked, lot, observation] = activity.entries

    assert.equal(asked.job_id, research.job)
    assert.equal(asked.stage, 'research')
    assert.equal(asked.subject_id, capture.packetA.id)
    assert.equal(asked.agent_note?.text, 'no public datasheet found')

    assert.equal(lot.job_id, lead.job)
    assert.equal(lot.subject_id, null)
    assert.equal(lot.entry.summary, 'Formed GE S2CN1 diodes')
    assert.ok(lot.entry.links.some((link) => link.kind === 'lot' && link.lot_id === formed.id))
    assert.equal(lot.agent_note?.text, 'lot stable, examine complete')

    // An observation made before any lot existed links to Capture and its place on the map.
    assert.deepEqual(
      observation.entry.links.map((link) => link.kind),
      ['capture_evidence', 'map'],
    )

    // Status lines are never entries, and the limit bounds the read.
    assert.ok(!kinds.includes('status'))
    const newest = await readActivity(fixture, batchId, 1)
    assert.deepEqual(
      newest.entries.map((item) => item.entry.id),
      [asked.entry.id],
    )
  })
})

test('a job whose current attempt has no status line yet has no agent note', async () => {
  await withFixture(async (fixture, capture) => {
    const call = tools(fixture)
    const research = await lotSession(fixture, capture, capture.packetA)
    const token = await issue(fixture, research.attempt)
    await call(
      'ask',
      token,
      oneStepAsk({
        kind: 'clarification',
        subject_id: capture.packetA.id,
        prompt: 'Is this one reel?',
        reason: 'Two date codes are visible.',
        fields: ['identity'],
        assumption: 'Treating them as one reel.',
      }),
    )

    const activity = await readActivity(fixture, capture.batch.id)
    assert.equal(activity.entries.length, 1)
    assert.equal(activity.entries[0].agent_note, null)
  })
})

test('a batch of another account is not found, and a limit outside 1–20 is refused', async () => {
  await withFixture(async (fixture, capture) => {
    const missing = await fixture.http(
      '/batches/00000000-0000-4000-8000-000000000000/processing/activity',
    )
    assert.equal(missing.status, 404)
    const tooMany = await fixture.http(`/batches/${capture.batch.id}/processing/activity?limit=21`)
    assert.equal(tooMany.status, 400)
    const empty = await readActivity(fixture, capture.batch.id)
    assert.deepEqual(empty.entries, [])
  })
})
