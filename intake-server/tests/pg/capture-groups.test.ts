import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { validate, type MediaEditDto, type MediaSnapshotDto } from '@invimport/contracts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import { captureRepository } from '../../src/capture/repository.ts'
import { editMedia } from '../../src/media/edit.ts'

test('bulk grouping, rename, notes and ungroup preserve evidence and reject partial moves', async () => {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const binding = {
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
  }
  try {
    const batch = (await captureRepository(db.pool, binding).create(randomUUID(), {
      title: 'Groups',
      note: '',
    })) as { id: string }
    const evidenceIds = [randomUUID(), randomUUID()]
    for (const id of evidenceIds) {
      await db.pool.query(
        'INSERT INTO media_evidence(id,batch_id,label,actor_id) VALUES ($1,$2,$3,$4)',
        [id, batch.id, 'Original', identity.actor],
      )
    }
    let revision = '1'
    async function edit(change: MediaEditDto['change'], key = randomUUID()) {
      const value = await editMedia(db.pool, binding, batch.id, key, {
        expected_revision: revision,
        change,
      })
      validate('MediaSnapshot', value)
      const saved = value as MediaSnapshotDto
      revision = saved.revision
      return saved
    }
    let saved = await edit({ kind: 'group', label: 'Packet' })
    const groupId = saved.groups[0].id
    const instructionId = randomUUID()
    await db.pool.query(
      'INSERT INTO capture_instruction(id,batch_id,group_id,version,text,actor_id) VALUES($1,$2,$3,1,$4,$5)',
      [
        instructionId,
        batch.id,
        groupId,
        'One packet, keep separate from other packets',
        identity.actor,
      ],
    )
    saved = await edit({ kind: 'move_many', evidence_ids: evidenceIds, group_id: groupId })
    assert.ok(saved.evidence.every((evidence) => evidence.group_id === groupId))
    saved = await edit({ kind: 'rename_group', group_id: groupId, label: 'Front and back' })
    assert.equal(saved.groups[0].label, 'Front and back')
    const noteKey = randomUUID()
    const noteInput = {
      expected_revision: revision,
      change: {
        kind: 'evidence_note' as const,
        evidence_id: evidenceIds[0],
        text: 'Read the reverse',
      },
    }
    saved = await edit(noteInput.change, noteKey)
    assert.deepEqual(await editMedia(db.pool, binding, batch.id, noteKey, noteInput), saved)
    await assert.rejects(
      editMedia(db.pool, binding, batch.id, noteKey, {
        ...noteInput,
        change: { ...noteInput.change, text: 'Changed payload' },
      }),
      /payload_conflict/,
    )
    await assert.rejects(
      editMedia(db.pool, binding, batch.id, randomUUID(), {
        expected_revision: noteInput.expected_revision,
        change: { kind: 'move_many', evidence_ids: evidenceIds, group_id: null },
      }),
      /revision_conflict/,
    )
    assert.equal(
      saved.evidence.find((evidence) => evidence.id === evidenceIds[0])?.note?.text,
      'Read the reverse',
    )
    await assert.rejects(
      edit({ kind: 'move_many', evidence_ids: [evidenceIds[0], randomUUID()], group_id: null }),
    )
    const foreignBatch = (await captureRepository(db.pool, binding).create(randomUUID(), {
      title: 'Other',
      note: '',
    })) as { id: string }
    const foreignGroupId = randomUUID()
    await db.pool.query('INSERT INTO media_group(id,batch_id,label,actor_id) VALUES($1,$2,$3,$4)', [
      foreignGroupId,
      foreignBatch.id,
      'Foreign',
      identity.actor,
    ])
    await assert.rejects(
      edit({ kind: 'move_many', evidence_ids: evidenceIds, group_id: foreignGroupId }),
      /not_found/,
    )
    const memberships = await db.pool.query(
      'SELECT count(*)::int AS count FROM media_group_selection WHERE batch_id=$1',
      [batch.id],
    )
    assert.equal(memberships.rows[0].count, 2)
    saved = await edit({ kind: 'ungroup', group_id: groupId })
    assert.equal(saved.groups.length, 0)
    assert.equal(saved.evidence.length, 2)
    assert.ok(saved.evidence.every((evidence) => evidence.group_id === null))
    assert.equal(
      saved.evidence.find((evidence) => evidence.id === evidenceIds[0])?.note?.text,
      'Read the reverse',
    )
    await assert.rejects(edit({ kind: 'move_many', evidence_ids: evidenceIds, group_id: groupId }))
    assert.equal(
      (
        await db.pool.query('SELECT count(*)::int AS count FROM media_group WHERE batch_id=$1', [
          batch.id,
        ])
      ).rows[0].count,
      1,
    )
    assert.equal(
      (
        await db.pool.query(
          'SELECT id FROM capture_instruction WHERE batch_id=$1 AND group_id=$2',
          [batch.id, groupId],
        )
      ).rows[0].id,
      instructionId,
    )
    const capture = captureRepository(db.pool, binding)
    const current = await capture.read(batch.id)
    await capture.edit(batch.id, randomUUID(), {
      expected_revision: current.revision,
      change: { kind: 'batch', archived: true },
    })
    await assert.rejects(
      edit({ kind: 'evidence_note', evidence_id: evidenceIds[0], text: 'Blocked' }),
      /batch_archived/,
    )
    await assert.rejects(
      db.pool.query('UPDATE media_group_history SET label=$1 WHERE batch_id=$2', [
        'Changed',
        batch.id,
      ]),
      /immutable/,
    )
  } finally {
    await db.dispose()
  }
})
