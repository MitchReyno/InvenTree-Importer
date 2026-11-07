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
