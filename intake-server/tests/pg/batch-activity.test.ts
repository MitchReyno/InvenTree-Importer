import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { validate, type BatchActivityDto, type SessionHistoryDto } from '@invimport/contracts'
import { processingFixture } from '../support/processing.ts'
import { leadSession, lotSession, oneStepAsk, seedPhoto } from '../support/sessions.ts'
import { replaceSession } from '#/processing/session-replacement.ts'
import { transaction } from '#/db/database.ts'
import { issueSessionCapability } from '#/agents/tools/capability.ts'
import { sessionTools } from '#/agents/tools/handlers.ts'
import { submitSessionInbox } from '#/agents/tools/inbox.ts'
import { readBatchActivity } from '#/agents/tools/activity.ts'
import { sealed } from '#/processing/model.ts'

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

test('after a fresh attempt, the earlier attempt’s action stays with no agent note', async () => {
  await withFixture(async (fixture, capture) => {
    const call = tools(fixture)
    const research = await lotSession(fixture, capture, capture.packetA)
    const token = await issue(fixture, research.attempt)
    await call('status', token, { text: 'Reading the label' })
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
    const before = await readActivity(fixture, capture.batch.id)
    assert.equal(before.entries[0].agent_note?.text, 'Reading the label')

    // Start fresh replaces a session that can't resume. The new attempt has no status line yet,
    // and the first attempt's line is not carried over.
    await fixture.db.pool.query(
      "UPDATE agent_session SET session_state='resume_unavailable' WHERE attempt_id=$1",
      [research.attempt],
    )
    const job = await fixture.db.pool.query<{ revision: string }>(
      'SELECT revision::text FROM processing_job WHERE id=$1',
      [research.job],
    )
    const batch = (await fixture.http(`/batches/${capture.batch.id}`)).value as { revision: string }
    const receipt = await replaceSession(
      fixture.api.pool,
      fixture.config,
      capture.batch.id,
      research.job,
      randomUUID(),
      {
        expected_capture_revision: batch.revision,
        expected_revision: job.rows[0].revision,
        attempt_id: research.attempt,
      },
    )
    assert.ok(receipt)
    const after = await readActivity(fixture, capture.batch.id)
    assert.deepEqual(
      after.entries.map((item) => item.entry.id),
      [before.entries[0].entry.id],
    )
    assert.equal(after.entries[0].agent_note, null)
  })
})

function noteSource(
  manifest: { notes: { id: string; subject_id: string | null; text: string }[] },
  lotId: string,
) {
  const note = manifest.notes.find((item) => item.subject_id === lotId)!
  return {
    kind: 'note' as const,
    note_id: note.id,
    text_sha256: createHash('sha256').update(note.text, 'utf8').digest('hex'),
  }
}

async function readHistory(fixture: Fixture, batchId: string, jobId: string) {
  const read = await fixture.http(`/batches/${batchId}/processing/${jobId}/history`)
  assert.equal(read.status, 200, JSON.stringify(read.value))
  return read.value as SessionHistoryDto
}

test('proposals and answers of several jobs resolve as each job’s own history resolves them', async () => {
  await withFixture(async (fixture, capture) => {
    const batchId = capture.batch.id
    const call = tools(fixture)
    const sessions = []
    for (const lot of [capture.packetA, capture.packetB]) {
      const session = await lotSession(fixture, capture, lot)
      const token = await issue(fixture, session.attempt)
      const source = noteSource(session.manifest, lot.id)
      await call('propose', token, {
        proposal: {
          schema_version: 'bench-intake-proposal/6',
          subject_id: lot.id,
          summary: `Identity of ${lot.label}`,
          sources: [source],
          relies_on: { fields: ['identity'], sources: [source] },
        },
      })
      const asked = await call(
        'ask',
        token,
        oneStepAsk({
          kind: 'quantity',
          subject_id: lot.id,
          prompt: `How many are in ${lot.label}?`,
          reason: 'The label is folded.',
          fields: ['quantity'],
          assumption: 'About 20.',
        }),
      )
      sessions.push({ session, token, lot, questionId: asked.id! })
    }
    for (const { session, questionId } of sessions) {
      const batch = (await fixture.http(`/batches/${batchId}`)).value as { revision: string }
      const answered = await fixture.http(`/batches/${batchId}/questions/${questionId}/answers`, {
        schema_version: 'bench-intake-answer/2',
        expected_question_revision: '1',
        expected_capture_revision: batch.revision,
        attempt_id: session.attempt,
        input_sha256: sealed(session.manifest).digest.toString('hex'),
        steps: [{ step_id: 'answer', value: { kind: 'number', value: '21', basis: 'counted' } }],
      })
      assert.equal(answered.status, 200, JSON.stringify(answered.value))
    }
    // Only Packet A's session reads its inbox, so the two cursors differ. Reading after a
    // sequence acknowledges everything up to it.
    const read = (await call('read_inbox', sessions[0].token, { after_seq: '0' })) as {
      items?: { seq: string }[]
    }
    const last = read.items?.at(-1)?.seq
    assert.ok(last, 'Packet A has an inbox item to read')
    await call('read_inbox', sessions[0].token, { after_seq: last })

    const activity = await readActivity(fixture, batchId, 20)
    for (const { session, lot } of sessions) {
      const own = activity.entries.filter((item) => item.job_id === session.job)
      const proposed = own.find((item) => item.entry.details.kind === 'proposal')!
      assert.ok(
        proposed.entry.links.some((link) => link.kind === 'lot' && link.lot_id === lot.id),
        `the proposal links ${lot.label}`,
      )
      const history = await readHistory(fixture, batchId, session.job)
      for (const item of own) {
        const same = history.entries.find((entry) => entry.id === item.entry.id)
        assert.deepEqual(item.entry, same, `${item.entry.id} matches its job's history`)
      }
    }
    const answers = activity.entries.filter((item) => item.entry.details.kind === 'answer')
    const readOf = (jobId: string) => {
      const entry = answers.find((item) => item.job_id === jobId)!.entry
      return 'read' in entry ? entry.read : undefined
    }
    assert.equal(readOf(sessions[0].session.job), true)
    assert.equal(readOf(sessions[1].session.job), false)
  })
})

test('a batch of another account is not found, and a limit outside 1–20 is refused', async () => {
  await withFixture(async (fixture, capture) => {
    const call = tools(fixture)
    const research = await lotSession(fixture, capture, capture.packetA)
    const token = await issue(fixture, research.attempt)
    await call('status', token, { text: 'Reading the label' })
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
    // The owner reads it; the same batch under another actor, target or context is not found.
    const owned = await readBatchActivity(fixture.api.pool, fixture.config, capture.batch.id)
    assert.equal(owned.entries.length, 1)
    for (const field of ['actorId', 'targetId', 'targetContextId'] as const) {
      await assert.rejects(
        readBatchActivity(
          fixture.api.pool,
          { ...fixture.config, [field]: randomUUID() },
          capture.batch.id,
        ),
        { code: 'not_found' },
      )
    }
    const tooMany = await fixture.http(`/batches/${capture.batch.id}/processing/activity?limit=21`)
    assert.equal(tooMany.status, 400)
    const empty = await readActivity(fixture, (await fixture.seedCapture()).batch.id)
    assert.deepEqual(empty.entries, [])
  })
})
