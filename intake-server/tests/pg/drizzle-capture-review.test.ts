import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import { transaction } from '../../src/db/database.ts'
import { CaptureError } from '../../src/capture/repository.ts'
import { recordDisposition, recordInstruction } from '../../src/capture/operator-commands.ts'
import { latestInstructions, loadReviewContext } from '../../src/capture/review-context.ts'

const ABOVE_SAFE_INTEGER = '9007199254740993'
const lotA = '00000000-0000-4000-8000-00000000000a'
const lotB = '00000000-0000-4000-8000-00000000000b'
const lotC = '00000000-0000-4000-8000-00000000000c'
const lotD = '00000000-0000-4000-8000-00000000000d'
const groupId = '00000000-0000-4000-8000-000000000010'
const digest = 'ab'.repeat(32)

test('review context keeps exact bigint strings, latest instructions and retirement lineage', async () => {
  const db = await isolatedDatabase()
  try {
    const { actor, target, context } = await seedAuthority(db.pool)
    const batchId = randomUUID()
    const sourceId = randomUUID()
    const streamId = randomUUID()
    const scope = {
      batchId,
      actorId: actor,
      nextRevision: ABOVE_SAFE_INTEGER,
    }

    await transaction(db.pool, async (client) => {
      await client.query('INSERT INTO ui_stream(id,stream_key) VALUES($1,$2)', [
        streamId,
        `review-${batchId}`,
      ])
      await client.query(
        'INSERT INTO capture_source(id,namespace_key,created_by) VALUES($1,$2,$3)',
        [sourceId, `native_batch:${sourceId}`, actor],
      )
      await client.query(
        `INSERT INTO capture_batch(id,source_id,actor_id,target_id,target_context_id,stream_id,title)
         VALUES($1,$2,$3,$4,$5,$6,'Lineage')`,
        [batchId, sourceId, actor, target, context, streamId],
      )
      for (const lotId of [lotA, lotB, lotC, lotD]) {
        await client.query(
          'INSERT INTO capture_subject(batch_id,id,kind,label) VALUES($1,$2,$3,$4)',
          [batchId, lotId, 'lot', `Lot ${lotId.slice(-1)}`],
        )
        await client.query(
          'INSERT INTO capture_lot(batch_id,id,source_id,contribution_key) VALUES($1,$2,$3,$4)',
          [batchId, lotId, sourceId, randomUUID()],
        )
      }
      await client.query(
        'INSERT INTO media_group(id,batch_id,label,actor_id) VALUES($1,$2,$3,$4)',
        [groupId, batchId, 'Packets', actor],
      )
      await client.query(
        `INSERT INTO capture_lot_lineage(batch_id,predecessor_lot_id,successor_lot_id,action,revision,actor_id)
         VALUES($1,$2,$4,'merge',$5,$6),($1,$3,$4,'merge',$5,$6)`,
        [batchId, lotB, lotA, lotC, ABOVE_SAFE_INTEGER, actor],
      )
      await client.query(
        `INSERT INTO capture_lot_retirement(batch_id,lot_id,revision,actor_id)
         VALUES($1,$2,$4,$5),($1,$3,$4,$5)`,
        [batchId, lotB, lotA, ABOVE_SAFE_INTEGER, actor],
      )
      await recordDisposition(client, scope, {
        subjectId: lotC,
        code: 'possible_duplicate',
        dependencyDigest: digest,
        reason: 'drizzle insert',
      })
      await client.query(
        `INSERT INTO capture_issue_disposition(
           id,batch_id,subject_id,code,dependency_digest,reason,revision,actor_id,created_at)
         VALUES($1,$2,$3,'possible_duplicate',$4,'newer',$5,$6,'2001-06-01T00:00:00Z'),
                ($7,$2,$3,'possible_duplicate',$4,'older',$5,$6,'2001-01-01T00:00:00Z'),
                ($8,$2,$3,'possible_duplicate',$4,'tie lower id',$5,$6,'2000-01-01T00:00:00Z'),
                ($9,$2,$3,'possible_duplicate',$4,'tie higher id',$5,$6,'2000-01-01T00:00:00Z')`,
        [
          '00000000-0000-4000-8000-0000000000a2',
          batchId,
          lotC,
          Buffer.from(digest, 'hex'),
          ABOVE_SAFE_INTEGER,
          actor,
          '00000000-0000-4000-8000-0000000000a1',
          '00000000-0000-4000-8000-0000000000a3',
          '00000000-0000-4000-8000-0000000000a4',
        ],
      )
      await client.query(
        `INSERT INTO capture_instruction(id,batch_id,group_id,version,text,actor_id)
         VALUES($1,$2,NULL,1,'older batch',$3),
               ($4,$2,NULL,$5,'latest batch',$3),
               ($6,$2,$7,$5,'highest version',$3),
               ($8,$2,$7,2,'lower version',$3)`,
        [
          randomUUID(),
          batchId,
          actor,
          randomUUID(),
          ABOVE_SAFE_INTEGER,
          randomUUID(),
          groupId,
          randomUUID(),
        ],
      )

      const review = await loadReviewContext(client, batchId)
      assert.deepEqual([...review.retiredLotIds].sort(), [lotA, lotB])
      assert.deepEqual(
        review.retired.map((record) => ({
          lotId: record.lotId,
          action: record.action,
          revision: record.revision,
          successorLotIds: record.successorLotIds,
        })),
        [
          { lotId: lotA, action: 'merge', revision: ABOVE_SAFE_INTEGER, successorLotIds: [lotC] },
          { lotId: lotB, action: 'merge', revision: ABOVE_SAFE_INTEGER, successorLotIds: [lotC] },
        ],
      )
      assert.deepEqual(review.predecessors.get(lotC), [lotA, lotB])
      const recorded = review.dispositions.get(lotC) ?? []
      assert.deepEqual(
        recorded.map((row) => row.reason),
        ['drizzle insert', 'newer', 'older', 'tie higher id', 'tie lower id'],
      )
      assert.equal(recorded[0]?.dependencyDigest, digest)
      assert.equal(recorded[1]?.createdAt, '2001-06-01T00:00:00.000Z')
      assert.equal(recorded[2]?.createdAt, '2001-01-01T00:00:00.000Z')

      const instructions = await latestInstructions(client, batchId)
      assert.deepEqual(
        instructions.map((row) => ({ groupId: row.groupId, version: row.version, text: row.text })),
        [
          { groupId: null, version: ABOVE_SAFE_INTEGER, text: 'latest batch' },
          { groupId, version: ABOVE_SAFE_INTEGER, text: 'highest version' },
        ],
      )
      assert.match(instructions[0]?.createdAt ?? '', /^\d{4}-\d{2}-\d{2}T/)
    })

    const client = await db.pool.connect()
    try {
      await assert.rejects(
        () =>
          recordInstruction(client, scope, {
            expected_revision: ABOVE_SAFE_INTEGER,
            group_id: randomUUID(),
            text: 'Missing group',
          }),
        (error: unknown) =>
          error instanceof CaptureError &&
          error.code === 'group_not_found' &&
          error.statusCode === 404,
      )
    } finally {
      client.release()
    }

    await transaction(db.pool, async (client) => {
      await client.query(
        `INSERT INTO capture_lot_retirement(batch_id,lot_id,revision,actor_id)
         VALUES($1,$2,1,$3)`,
        [batchId, lotD, actor],
      )
      await assert.rejects(
        () => loadReviewContext(client, batchId),
        /capture_retirement_without_lineage/,
      )
    })
  } finally {
    await db.dispose()
  }
})
