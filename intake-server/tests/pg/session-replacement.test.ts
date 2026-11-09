import { validate, type ProcessingReceiptDto } from '@invimport/contracts'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { processingFixture } from '../support/processing.ts'
import { lotSession } from '../support/sessions.ts'
import { replaceSession } from '../../src/processing/session-replacement.ts'
import { submitSessionInbox } from '../../src/agents/tools/inbox.ts'

for (const lead of [false, true]) {
  test(`${lead ? 'lead' : 'lot'} replacement preserves lineage and rejects stale or active requests`, async () => {
    const f = await processingFixture()
    try {
      const capture = await f.seedCapture()
      const prior = await lotSession(f, capture, capture.packetA)
      if (lead) {
        await f.db.pool.query(
          "UPDATE processing_job SET subject_id=NULL,stage='examine' WHERE id=$1",
          [prior.job],
        )
      }
      const config = { ...f.config, profileId: 'synthetic-session/1' as const }
      const input = {
        expected_capture_revision: capture.batch.revision,
        expected_revision: '1',
        attempt_id: prior.attempt,
      }
      await assert.rejects(
        replaceSession(f.api.pool, config, capture.batch.id, prior.job, 'active', input),
        { code: 'session_not_replaceable' },
      )
      await f.db.pool.query(
        "UPDATE agent_session SET session_state='resume_unavailable' WHERE attempt_id=$1",
        [prior.attempt],
      )
      await f.db.pool.query(
        'INSERT INTO agent_slot(actor_id,slot_index,attempt_id,claimed_at) VALUES($1,0,$2,now())',
        [f.identity.actor, prior.attempt],
      )
      await assert.rejects(
        replaceSession(f.api.pool, config, capture.batch.id, prior.job, 'held', input),
        { code: 'session_reap_pending' },
      )
      await f.db.pool.query(
        'UPDATE agent_slot SET attempt_id=NULL,claimed_at=NULL WHERE actor_id=$1',
        [f.identity.actor],
      )
      await assert.rejects(
        replaceSession(
          f.api.pool,
          { ...config, targetId: '00000000-0000-4000-8000-000000000099' },
          capture.batch.id,
          prior.job,
          'wrong-target',
          input,
        ),
      )
      const message = await submitSessionInbox(f.api.pool, {
        binding: config,
        batchId: capture.batch.id,
        lineageId: prior.job,
        actorId: f.identity.actor,
        idempotencyKey: 'pending',
        kind: 'chat',
        payload: { text: 'Keep this input' },
      })
      const result = await replaceSession(
        f.api.pool,
        config,
        capture.batch.id,
        prior.job,
        'replace',
        input,
      )
      validate('ProcessingReceipt', result)
      const receipt = result as ProcessingReceiptDto
      assert.deepEqual(receipt.job_ids, [prior.job])
      assert.notEqual(receipt.attempt_ids[0], prior.attempt)
      assert.deepEqual(
        await replaceSession(f.api.pool, config, capture.batch.id, prior.job, 'replace', input),
        receipt,
      )
      await assert.rejects(
        replaceSession(f.api.pool, config, capture.batch.id, prior.job, 'stale', input),
        { code: 'stale_attempt' },
      )
      const history = await f.db.pool.query(
        'SELECT attempt_id, native_session_id FROM agent_session WHERE session_lineage_id=$1',
        [prior.job],
      )
      assert.equal(history.rowCount, 2)
      assert.ok(history.rows.every((row) => row.native_session_id === null))
      const pending = await f.db.pool.query(
        'SELECT id FROM agent_session_inbox WHERE session_lineage_id=$1',
        [prior.job],
      )
      assert.deepEqual(
        pending.rows.map((row) => row.id),
        [message.item_id],
      )
    } finally {
      await f.dispose()
    }
  })
}

test('replacement retains a successor identity pin and refuses stale identity work', async (t) => {
  const { formedBatch } = await import('../support/lot-pipeline.ts')
  const { runSessionTurn } = await import('../../src/agents/session-runner.ts')
  const { fixture, deps, batchId, read, lot, successors, identities, pinned } = await formedBatch(t)
  const formed = await lot('led 0603 red')
  const [identity] = await identities(formed.id)
  const prior = (await successors(formed.id)).find((row) => row.stage === 'research')!
  await fixture.db.pool.query(
    "UPDATE agent_session SET session_state='resume_unavailable' WHERE attempt_id=$1",
    [prior.attempt_id],
  )
  const snapshot = await read()
  const rows = await fixture.db.pool.query<{ revision: string }>(
    'SELECT revision FROM processing_job WHERE id=$1',
    [prior.job_id],
  )
  const input = {
    expected_capture_revision: snapshot.revision,
    expected_revision: rows.rows[0].revision,
    attempt_id: prior.attempt_id,
  }
  await replaceSession(
    fixture.api.pool,
    fixture.config,
    batchId,
    prior.job_id,
    'pinned-replacement',
    input,
  )
  const replacement = (await successors(formed.id)).find((row) => row.stage === 'research')!
  assert.deepEqual(pinned(replacement), [identity.id])
  await fixture.db.pool.query(
    "INSERT INTO processing_proposal_stale(proposal_id,reason) VALUES($1,'lot_regrouped')",
    [identity.id],
  )
  assert.equal(
    await runSessionTurn(deps, replacement.attempt_id, new AbortController().signal),
    'cancelled',
  )
})

test('a replacement session gets the batch instructions its predecessor had already read', async () => {
  const { deliverInstructions } = await import('../../src/agents/instructions.ts')
  const f = await processingFixture()
  try {
    const capture = await f.seedCapture()
    const prior = await lotSession(f, capture, capture.packetA)
    const config = { ...f.config, profileId: 'synthetic-session/1' as const }
    await f.db.pool.query(
      `INSERT INTO capture_instruction(id,batch_id,group_id,version,text,actor_id)
       VALUES(gen_random_uuid(),$1,NULL,(SELECT revision FROM capture_batch WHERE id=$1),$2,$3)`,
      [capture.batch.id, 'Keep the two resistor packets apart.', f.identity.actor],
    )
    await deliverInstructions(f.api.pool, config, capture.batch.id)
    // The earlier session read everything in its inbox, then could not resume.
    await f.db.pool.query(
      `INSERT INTO agent_session_cursor(session_lineage_id,acked_seq,acked_at)
       SELECT $1,max(seq),now() FROM agent_session_inbox WHERE session_lineage_id=$1`,
      [prior.job],
    )
    await f.db.pool.query(
      "UPDATE agent_session SET session_state='resume_unavailable' WHERE attempt_id=$1",
      [prior.attempt],
    )
    await replaceSession(f.api.pool, config, capture.batch.id, prior.job, 'replace', {
      expected_capture_revision: capture.batch.revision,
      expected_revision: '1',
      attempt_id: prior.attempt,
    })
    const unread = await f.db.pool.query<{ text: string }>(
      `SELECT i.payload->>'text' AS text FROM agent_session_inbox i
         JOIN agent_session_cursor c ON c.session_lineage_id=i.session_lineage_id
       WHERE i.session_lineage_id=$1 AND i.kind='instruction' AND i.seq>c.acked_seq`,
      [prior.job],
    )
    assert.deepEqual(
      unread.rows.map((row) => row.text),
      ['Keep the two resistor packets apart.'],
    )
  } finally {
    await f.dispose()
  }
})
