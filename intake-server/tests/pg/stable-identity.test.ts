import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { ProcessingProposalV5Dto } from '@invimport/contracts'
import { formedBatch, photoWithNote } from '../support/lot-pipeline.ts'
import { transaction } from '../../src/db/database.ts'
import { triggerExamine } from '../../src/processing/examine-trigger.ts'
import { onLeadIdentity } from '../../src/processing/stable-identity.ts'
import { lockCaptureForInputSettlement } from '../../src/capture/repository.ts'
import { claimSessionSlot } from '../../src/agents/session/slots.ts'
import { saveAgentSettings } from '../../src/agents/settings.ts'
import { queueSessionResume, runSessionTurn } from '../../src/agents/session/session-runner.ts'

test('a stable identity queues the lot’s Research and Images, pinned to it, as agent_writer', async (t) => {
  const { fixture, lot, successors, identities, pinned } = await formedBatch(t)
  for (const label of ['led 0603 red', '16 mhz crystal']) {
    const formed = await lot(label)
    const [identity] = await identities(formed.id)
    assert.equal(identity.stale, null)
    const rows = await successors(formed.id)
    assert.deepEqual(
      rows.map((row) => [row.stage, row.job_state, row.attempt_state]),
      [
        ['images', 'queued', 'queued'],
        ['research', 'queued', 'queued'],
      ],
    )
    for (const row of rows) {
      assert.deepEqual(pinned(row), [identity.id])
    }
  }
  // Ordering is the stable-identity rule: /2 successors record no dependency rows.
  const dependencies = await fixture.db.pool.query('SELECT 1 FROM processing_dependency')
  assert.equal(dependencies.rowCount, 0)
})

test('a lot regrouped before its successors start supersedes them; the next identity queues fresh ones', async (t) => {
  const { fixture, deps, batchId, leadJob, leadAttempt, lot, successors, identities, pinned } =
    await formedBatch(t)
  const led = await lot('led 0603 red')
  const before = await successors(led.id)
  // A later photo of the same reel joins the LED lot: its observation set changes.
  await photoWithNote(fixture, batchId, 'Reel', 'LED 0603 red')
  await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
  await transaction(fixture.runner.pool, (client) => queueSessionResume(client, leadJob))
  assert.equal(await runSessionTurn(deps, leadAttempt, new AbortController().signal), 'finished')

  const [first, second] = await identities(led.id)
  assert.equal(first.stale, 'lot_regrouped')
  assert.equal(second.stale, null)
  const states = await fixture.db.pool.query<{ state: string }>(
    'SELECT state FROM processing_attempt WHERE id = ANY($1::uuid[]) ORDER BY id',
    [before.map((row) => row.attempt_id)],
  )
  assert.deepEqual(
    states.rows.map((row) => row.state),
    ['superseded', 'superseded'],
  )
  const after = await successors(led.id)
  for (const row of after) {
    assert.equal(row.attempt_state, 'queued')
    assert.ok(!before.some((prior) => prior.attempt_id === row.attempt_id))
    assert.deepEqual(pinned(row), [second.id])
  }
  // The unchanged lot keeps its successors.
  const crystal = await lot('16 mhz crystal')
  assert.equal((await identities(crystal.id)).length, 1)
})

test('a running successor is told about a revised identity instead of being replaced', async (t) => {
  const { fixture, deps, batchId, leadJob, leadAttempt, lot, successors } = await formedBatch(t)
  const led = await lot('led 0603 red')
  const research = (await successors(led.id)).find((row) => row.stage === 'research')!
  // The Research session has started.
  await fixture.db.pool.query("UPDATE processing_attempt SET state='running' WHERE id=$1", [
    research.attempt_id,
  ])
  await fixture.db.pool.query(
    "UPDATE agent_session SET session_state='running' WHERE attempt_id=$1",
    [research.attempt_id],
  )
  await photoWithNote(fixture, batchId, 'Reel', 'LED 0603 red')
  await triggerExamine(fixture.writer.pool, fixture.config, { quietMs: 0 })
  await transaction(fixture.runner.pool, (client) => queueSessionResume(client, leadJob))
  assert.equal(await runSessionTurn(deps, leadAttempt, new AbortController().signal), 'finished')

  const now = (await successors(led.id)).find((row) => row.stage === 'research')!
  assert.equal(now.attempt_id, research.attempt_id)
  assert.equal(now.attempt_state, 'running')
  const inbox = await fixture.db.pool.query<{ kind: string; payload: { fields: string[] } }>(
    'SELECT kind,payload FROM agent_session_inbox WHERE session_lineage_id=$1',
    [research.job_id],
  )
  // The new photo's observation and the re-stated identity both reach it.
  assert.deepEqual(
    inbox.rows.map((row) => row.kind),
    ['evidence', 'revision'],
  )
  assert.deepEqual(inbox.rows[1].payload.fields, ['identity'])
})

test('an operator move supersedes queued successors, and a stale pin settles at claim', async (t) => {
  const { fixture, deps, batchId, read, lot, successors, identities } = await formedBatch(t)
  const led = await lot('led 0603 red')
  const crystal = await lot('16 mhz crystal')
  const crystalBefore = await successors(crystal.id)
  const snapshot = await read()
  const observation = snapshot.evidence_observations!.find((item) => item.lot_id === led.id)!
  const moved = await fixture.http(`/batches/${batchId}/edits`, {
    expected_revision: snapshot.revision,
    change: { kind: 'observation_move', observation_id: observation.id, lot_id: crystal.id },
  })
  assert.equal(moved.status, 200)
  // Both lots' observation sets changed: their queued successors wait for a new identity. The
  // LED identity cited the moved observation, so it is stale for that reason.
  for (const [lotId, reason] of [
    [led.id, 'evidence_removed'],
    [crystal.id, 'lot_regrouped'],
  ]) {
    assert.deepEqual(
      (await successors(lotId)).map((row) => [row.job_state, row.attempt_state]),
      [
        ['superseded', 'superseded'],
        ['superseded', 'superseded'],
      ],
    )
    assert.deepEqual(
      (await identities(lotId)).map((row) => row.stale),
      [reason],
    )
  }
  // A worker that picks up a superseded successor settles it without running.
  assert.equal(
    await runSessionTurn(deps, crystalBefore[0].attempt_id, new AbortController().signal),
    'cancelled',
  )
  const session = await fixture.db.pool.query<{ session_state: string }>(
    'SELECT session_state FROM agent_session WHERE attempt_id=$1',
    [crystalBefore[0].attempt_id],
  )
  assert.equal(session.rows[0].session_state, 'cancelled')
})

test('a queued successor whose pinned identity went stale is superseded when it is claimed', async (t) => {
  const { fixture, deps, lot, successors, identities } = await formedBatch(t)
  const led = await lot('led 0603 red')
  const [identity] = await identities(led.id)
  const research = (await successors(led.id)).find((row) => row.stage === 'research')!
  await fixture.db.pool.query(
    "INSERT INTO processing_proposal_stale(proposal_id,reason) VALUES($1,'lot_regrouped')",
    [identity.id],
  )
  assert.equal(
    await runSessionTurn(deps, research.attempt_id, new AbortController().signal),
    'cancelled',
  )
  const after = (await successors(led.id)).find((row) => row.stage === 'research')!
  assert.equal(after.attempt_state, 'superseded')
})

test('an identity relying on an older observation set is stale and queues nothing', async (t) => {
  const { fixture, batchId, read, lot, successors } = await formedBatch(t)
  const led = await lot('led 0603 red')
  const before = await successors(led.id)
  const proposal = {
    schema_version: 'bench-intake-proposal/5',
    subject_id: led.id,
    summary: 'Identity from an older grouping.',
    sources: [{ kind: 'observation', observation_id: randomUUID() }],
    relies_on: {
      fields: ['identity'],
      sources: [{ kind: 'observation_set', lot_id: led.id, version: '0' }],
    },
  } as unknown as ProcessingProposalV5Dto
  const proposalId = (
    await fixture.db.pool.query<{ id: string }>(
      `SELECT p.id FROM processing_proposal p JOIN processing_attempt a ON a.id=p.attempt_id
       JOIN processing_job j ON j.id=a.job_id WHERE j.stage='examine' LIMIT 1`,
    )
  ).rows[0].id
  const outcome = await transaction(fixture.writer.pool, async (client) => {
    const capture = await lockCaptureForInputSettlement(client, fixture.config, batchId)
    return onLeadIdentity(client, fixture.config, capture.snapshot, proposal, proposalId)
  })
  assert.equal(outcome, 'not_stable')
  assert.deepEqual(
    (await successors(led.id)).map((row) => row.attempt_id),
    before.map((row) => row.attempt_id),
  )
  assert.equal((await read()).id, batchId)
})

test('Inventory waits for current Research and Images results', async (t) => {
  const { fixture, deps, batchId, read, lot, successors } = await formedBatch(t)
  const led = await lot('led 0603 red')
  const start = async () =>
    fixture.http(`/batches/${batchId}/processing`, {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: (await read()).revision,
      subject_ids: [led.id],
      stages: ['inventory'],
    })
  const waiting = await start()
  assert.equal(waiting.status, 409)
  assert.equal((waiting.value as { code: string }).code, 'inventory_waiting')
  // Each publishes a proposal; the synthetic sessions then wait on their question.
  for (const row of await successors(led.id)) {
    assert.ok(
      ['finished', 'waiting_input'].includes(
        await runSessionTurn(deps, row.attempt_id, new AbortController().signal),
      ),
    )
  }
  assert.equal((await start()).status, 202)
})

test('Research and Images take slots alongside the running lead session', async (t) => {
  const { fixture, lot, successors } = await formedBatch(t)
  const led = await lot('led 0603 red')
  const rows = await successors(led.id)
  await transaction(fixture.runner.pool, async (client) => {
    for (const row of rows) {
      assert.equal(await claimSessionSlot(client, fixture.config, row.attempt_id), true)
    }
  })
  const held = await fixture.db.pool.query('SELECT 1 FROM agent_slot WHERE attempt_id IS NOT NULL')
  assert.equal(held.rowCount, 2)
})

test('a resumed lead session starts ahead of older queued per-lot sessions', async (t) => {
  const { fixture, leadJob, leadAttempt, lot, successors } = await formedBatch(t)
  const current = await fixture.http('/agent-settings')
  await saveAgentSettings(fixture.api.pool, fixture.config, {
    expected_revision: (current.value as { revision: string }).revision,
    selection: { provider: 'claude', authentication: 'api_key', model: 'claude-sonnet-5-5' },
    session_concurrency: 1,
  })
  await transaction(fixture.runner.pool, (client) => queueSessionResume(client, leadJob))
  const [first] = await successors((await lot('led 0603 red')).id)
  // Nothing holds a slot, so only queue order decides.
  const held = await fixture.db.pool.query('SELECT 1 FROM agent_slot WHERE attempt_id IS NOT NULL')
  assert.equal(held.rowCount, 0)
  await transaction(fixture.runner.pool, async (client) => {
    assert.equal(await claimSessionSlot(client, fixture.config, first.attempt_id), false)
    assert.equal(await claimSessionSlot(client, fixture.config, leadAttempt), true)
  })
})

test('a regroup and an identity racing for the lot: the identity waits, then sees the new set', async (t) => {
  const { fixture, batchId, lot, successors } = await formedBatch(t)
  const led = await lot('led 0603 red')
  const proposalId = (
    await fixture.db.pool.query<{ id: string }>(
      `SELECT p.id FROM processing_proposal p JOIN processing_attempt a ON a.id=p.attempt_id
       JOIN processing_job j ON j.id=a.job_id WHERE j.stage='examine' LIMIT 1`,
    )
  ).rows[0].id
  const proposal = {
    schema_version: 'bench-intake-proposal/5',
    subject_id: led.id,
    summary: 'Identity from the label.',
    sources: [{ kind: 'observation', observation_id: randomUUID() }],
    relies_on: {
      fields: ['identity'],
      sources: [{ kind: 'observation_set', lot_id: led.id, version: led.observation_set_version! }],
    },
  } as unknown as ProcessingProposalV5Dto
  const regroup = await fixture.writer.pool.connect()
  try {
    await regroup.query('BEGIN')
    await lockCaptureForInputSettlement(regroup, fixture.config, batchId)
    await regroup.query(
      'UPDATE capture_lot SET observation_set_version=observation_set_version+1 WHERE id=$1',
      [led.id],
    )
    // The identity's transaction blocks on the capture lock the regroup holds.
    const identity = transaction(fixture.writer.pool, async (client) => {
      const capture = await lockCaptureForInputSettlement(client, fixture.config, batchId)
      return onLeadIdentity(client, fixture.config, capture.snapshot, proposal, proposalId)
    })
    await new Promise((resolve) => setTimeout(resolve, 200))
    await regroup.query('COMMIT')
    assert.equal(await identity, 'not_stable')
  } finally {
    regroup.release()
  }
  // The earlier successors are untouched by the losing identity.
  assert.equal((await successors(led.id)).length, 2)
})

test('a successor that has run is resumed after its pinned identity goes stale, not superseded', async (t) => {
  const { fixture, deps, lot, successors, identities } = await formedBatch(t)
  const led = await lot('led 0603 red')
  const research = (await successors(led.id)).find((row) => row.stage === 'research')!
  assert.notEqual(
    await runSessionTurn(deps, research.attempt_id, new AbortController().signal),
    'cancelled',
  )
  const [identity] = await identities(led.id)
  await fixture.db.pool.query(
    "INSERT INTO processing_proposal_stale(proposal_id,reason) VALUES($1,'answer_received')",
    [identity.id],
  )
  // A revision notice wakes it, as the fan-out does.
  await fixture.db.pool.query(
    `INSERT INTO agent_session_inbox(id,session_lineage_id,seq,kind,payload,idempotency_key)
     SELECT gen_random_uuid(),$1,COALESCE(max(seq),0)+1,'revision',$2::jsonb,'test-revision'
     FROM agent_session_inbox WHERE session_lineage_id=$1`,
    [research.job_id, JSON.stringify({ fields: ['identity'], reason: 'Revised.' })],
  )
  await transaction(fixture.runner.pool, (client) => queueSessionResume(client, research.job_id))
  assert.notEqual(
    await runSessionTurn(deps, research.attempt_id, new AbortController().signal),
    'cancelled',
  )
  const after = (await successors(led.id)).find((row) => row.stage === 'research')!
  assert.equal(after.attempt_id, research.attempt_id)
  assert.notEqual(after.attempt_state, 'superseded')
})

const identityFor = (lotId: string, version: string) =>
  ({
    schema_version: 'bench-intake-proposal/5',
    subject_id: lotId,
    summary: 'Identity from the label.',
    sources: [{ kind: 'observation', observation_id: randomUUID() }],
    relies_on: {
      fields: ['identity'],
      sources: [{ kind: 'observation_set', lot_id: lotId, version }],
    },
  }) as unknown as ProcessingProposalV5Dto

test('on native-agent/2, a stable identity queues successors as agent_writer with saved settings', async (t) => {
  const { fixture, batchId, lot, successors, identities, pinned } = await formedBatch(t)
  const crystal = await lot('16 mhz crystal')
  const before = await successors(crystal.id)
  await fixture.db.pool.query(
    "UPDATE processing_attempt SET state='cancelled' WHERE id = ANY($1::uuid[])",
    [before.map((row) => row.attempt_id)],
  )
  const [identity] = await identities(crystal.id)
  const native = { ...fixture.config, profileId: 'native-agent/2' as const }
  const outcome = await transaction(fixture.writer.pool, async (client) => {
    const capture = await lockCaptureForInputSettlement(client, native, batchId)
    return onLeadIdentity(
      client,
      native,
      capture.snapshot,
      identityFor(crystal.id, crystal.observation_set_version!),
      identity.id,
    )
  })
  assert.equal(outcome, 'queued')
  for (const row of await successors(crystal.id)) {
    assert.equal(row.attempt_state, 'queued')
    assert.deepEqual(pinned(row), [identity.id])
  }
})

test('a republished identity replaces a successor that has not started', async (t) => {
  const { fixture, batchId, lot, successors, pinned } = await formedBatch(t)
  const led = await lot('led 0603 red')
  const before = await successors(led.id)
  // Another current proposal stands in for the lead's next identity.
  const next = (
    await fixture.db.pool.query<{ id: string }>(
      `SELECT p.id FROM processing_proposal p JOIN processing_attempt a ON a.id=p.attempt_id
       JOIN processing_job j ON j.id=a.job_id
       WHERE j.stage='examine' AND p.relies_on->'fields' ? 'quantity' LIMIT 1`,
    )
  ).rows[0].id
  await transaction(fixture.writer.pool, async (client) => {
    const capture = await lockCaptureForInputSettlement(client, fixture.config, batchId)
    assert.equal(
      await onLeadIdentity(
        client,
        fixture.config,
        capture.snapshot,
        identityFor(led.id, led.observation_set_version!),
        next,
      ),
      'queued',
    )
  })
  const after = await successors(led.id)
  for (const row of after) {
    assert.ok(!before.some((prior) => prior.attempt_id === row.attempt_id))
    assert.deepEqual(pinned(row), [next])
  }
})

test('a gated Inventory never holds back the Research and Images it waits for', async (t) => {
  const { fixture, deps, batchId, read, lot, successors } = await formedBatch(t)
  const led = await lot('led 0603 red')
  const [images, research] = await successors(led.id)
  for (const row of [images, research]) {
    await runSessionTurn(deps, row.attempt_id, new AbortController().signal)
  }
  const started = await fixture.http(`/batches/${batchId}/processing`, {
    schema_version: 'bench-intake-processing/1',
    expected_capture_revision: (await read()).revision,
    subject_ids: [led.id],
    stages: ['inventory'],
  })
  assert.equal(started.status, 202)
  const current = await fixture.http('/agent-settings')
  await saveAgentSettings(fixture.api.pool, fixture.config, {
    expected_revision: (current.value as { revision: string }).revision,
    selection: { provider: 'claude', authentication: 'api_key', model: 'claude-sonnet-5-5' },
    session_concurrency: 1,
  })
  // Only the LED lot is in play: the crystal's queued successors are set aside.
  const crystal = await lot('16 mhz crystal')
  await fixture.db.pool.query(
    "UPDATE processing_attempt SET state='cancelled' WHERE id = ANY($1::uuid[])",
    [(await successors(crystal.id)).map((row) => row.attempt_id)],
  )
  // Research is woken after Inventory queued; Inventory must not keep it from a slot.
  await transaction(fixture.runner.pool, (client) => queueSessionResume(client, research.job_id))
  await transaction(fixture.runner.pool, async (client) => {
    assert.equal(await claimSessionSlot(client, fixture.config, research.attempt_id), true)
  })
})

test('a gated Inventory never holds back another lot’s ready Inventory', async (t) => {
  const { fixture, deps, batchId, read, lot, successors } = await formedBatch(t)
  const crystal = await lot('16 mhz crystal')
  const led = await lot('led 0603 red')
  for (const target of [crystal, led]) {
    for (const row of await successors(target.id)) {
      await runSessionTurn(deps, row.attempt_id, new AbortController().signal)
    }
  }
  // Crystal's Inventory is queued first, then LED's.
  for (const target of [crystal, led]) {
    const started = await fixture.http(`/batches/${batchId}/processing`, {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: (await read()).revision,
      subject_ids: [target.id],
      stages: ['inventory'],
    })
    assert.equal(started.status, 202)
  }
  // Crystal's Research result goes stale, so its Inventory waits at the gate.
  const crystalResearch = (await successors(crystal.id)).find((row) => row.stage === 'research')!
  await fixture.db.pool.query(
    `INSERT INTO processing_proposal_stale(proposal_id,reason)
     SELECT id,'operator_correction' FROM processing_proposal WHERE attempt_id=$1`,
    [crystalResearch.attempt_id],
  )
  const current = await fixture.http('/agent-settings')
  await saveAgentSettings(fixture.api.pool, fixture.config, {
    expected_revision: (current.value as { revision: string }).revision,
    selection: { provider: 'claude', authentication: 'api_key', model: 'claude-sonnet-5-5' },
    session_concurrency: 1,
  })
  const inventory = async (lotId: string) =>
    (
      await fixture.db.pool.query<{ current_attempt_id: string }>(
        "SELECT current_attempt_id FROM processing_job WHERE subject_id=$1 AND stage='inventory'",
        [lotId],
      )
    ).rows[0].current_attempt_id
  assert.equal(
    await runSessionTurn(deps, await inventory(crystal.id), new AbortController().signal),
    'queued',
  )
  await transaction(fixture.runner.pool, async (client) => {
    assert.equal(await claimSessionSlot(client, fixture.config, await inventory(led.id)), true)
  })
})
