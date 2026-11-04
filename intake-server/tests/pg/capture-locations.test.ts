import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  validate,
  type CaptureEditDto,
  type CaptureSnapshotDto,
  type MediaSnapshotDto,
} from '@invimport/contracts'
import { captureRepository } from '../../src/capture/repository.ts'
import { editMedia } from '../../src/media/edit.ts'
import { materializeWithMedia } from '../../src/review/media-material.ts'
import { mediaScopeFixture } from '../support/media-input-scopes.ts'

type Fixture = Awaited<ReturnType<typeof mediaScopeFixture>>

async function setup() {
  const fixture = await mediaScopeFixture()
  const capture = captureRepository(fixture.pool, fixture.binding)
  let batch = fixture.batch
  let mediaRevision = (
    await fixture.pool.query('SELECT revision::text FROM media_batch WHERE batch_id=$1', [batch.id])
  ).rows[0]?.revision as string | undefined

  async function edit(change: CaptureEditDto['change']) {
    const value = await capture.edit(batch.id, randomUUID(), {
      expected_revision: batch.revision,
      change,
    })
    validate('CaptureSnapshot', value)
    batch = value as CaptureSnapshotDto
    return batch
  }

  async function media(change: Parameters<typeof editMedia>[4]['change']) {
    const current = (
      await fixture.pool.query('SELECT revision::text FROM media_batch WHERE batch_id=$1', [
        batch.id,
      ])
    ).rows[0]?.revision as string | undefined
    mediaRevision = current ?? mediaRevision ?? '1'
    const value = (await editMedia(fixture.pool, fixture.binding, batch.id, randomUUID(), {
      expected_revision: mediaRevision,
      change,
    })) as MediaSnapshotDto
    mediaRevision = value.revision
    batch = (await capture.read(batch.id)) as CaptureSnapshotDto
    return value
  }

  async function observe(pk: string) {
    const id = randomUUID()
    await fixture.pool.query(
      `INSERT INTO capture_observation(id,batch_id,target_id,target_context_id,model,pk,label)
       VALUES($1,$2,$3,$4,'location',$5,$6)`,
      [id, batch.id, fixture.binding.targetId, fixture.binding.targetContextId, pk, `Drawer ${pk}`],
    )
    return {
      mode: 'set' as const,
      value: {
        observation_id: id,
        target_context_id: fixture.binding.targetContextId,
        model: 'location' as const,
        pk,
      },
    }
  }

  /** One Part per lot, chosen as an observed existing Part, so effects carry each location. */
  async function choosePartsFor(lotIds: string[]) {
    const id = randomUUID()
    await fixture.pool.query(
      `INSERT INTO capture_observation(id,batch_id,target_id,target_context_id,model,pk,label)
       VALUES($1,$2,$3,$4,'part',$5,$6)`,
      [id, batch.id, fixture.binding.targetId, fixture.binding.targetContextId, '29', 'Resistor'],
    )
    const choice = {
      mode: 'set' as const,
      value: {
        observation_id: id,
        target_context_id: fixture.binding.targetContextId,
        model: 'part' as const,
        pk: '29',
      },
    }
    const parts = new Map<string, string>()
    for (const lotId of lotIds) {
      const known = new Set(batch.parts.map((part) => part.id))
      await edit({ kind: 'add_part', label: `Part for ${lotId.slice(-4)}` })
      // Parts are listed by ID, not creation order.
      const partId = batch.parts.find((part) => !known.has(part.id))!.id
      await edit({ kind: 'part', id: partId, choice })
      await edit({ kind: 'lot', id: lotId, part_subject_id: partId })
      parts.set(lotId, partId)
    }
    return parts
  }

  async function material(lotIds: string[]) {
    const client = await fixture.pool.connect()
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ')
      return await materializeWithMedia(
        client,
        { ...fixture.binding, origin: 'http://127.0.0.1:1', mediaEnabled: true } as never,
        batch,
        lotIds,
        false,
      )
    } finally {
      await client.query('ROLLBACK')
      client.release()
    }
  }

  return {
    fixture,
    get batch() {
      return batch
    },
    edit,
    media,
    observe,
    choosePartsFor,
    material,
  }
}

async function dispose(fixture: Fixture) {
  await fixture.dispose()
}

const effectLocation = (
  material: Awaited<ReturnType<Awaited<ReturnType<typeof setup>>['material']>>,
  lotId: string,
) => material.effects.find((effect) => effect.lot_id === lotId)?.location_id ?? null

test('Part and group assignments are retained, validated and omitted when absent', async () => {
  const s = await setup()
  try {
    const legacy = s.batch
    assert.equal('group_locations' in legacy, false)
    await s.edit({ kind: 'add_part', label: 'Shared' })
    const partId = s.batch.parts[0].id
    assert.equal('location' in s.batch.parts[0], false)

    const drawer = await s.observe('41')
    await s.edit({ kind: 'part', id: partId, location: drawer })
    assert.deepEqual(s.batch.parts[0].location, drawer)
    await s.edit({ kind: 'part', id: partId, location: { mode: 'clear' } })
    assert.deepEqual(s.batch.parts[0].location, { mode: 'clear' })
    await s.edit({ kind: 'part', id: partId, location: { mode: 'unset' } })
    assert.equal('location' in s.batch.parts[0], false)

    const grouped = await s.media({ kind: 'group', label: 'Packet' })
    const groupId = grouped.groups[0].id
    await s.edit({ kind: 'group_location', group_id: groupId, location: drawer })
    assert.deepEqual(s.batch.group_locations, [
      { group_id: groupId, version: s.batch.revision, location: drawer },
    ])
    await s.edit({ kind: 'group_location', group_id: groupId, location: { mode: 'unset' } })
    assert.equal('group_locations' in s.batch, false)

    await assert.rejects(
      s.edit({ kind: 'group_location', group_id: randomUUID(), location: drawer }),
      /group_not_found/,
    )
    await assert.rejects(
      s.edit({
        kind: 'group_location',
        group_id: groupId,
        location: { mode: 'set', value: { ...drawer.value, observation_id: randomUUID() } },
      }),
      /invalid_reference/,
    )
    await s.edit({ kind: 'group_location', group_id: groupId, location: { mode: 'clear' } })
    await s.media({ kind: 'ungroup', group_id: groupId })
    assert.equal('group_locations' in s.batch, false, 'a retired group no longer assigns')
    await assert.rejects(
      s.edit({ kind: 'group_location', group_id: groupId, location: drawer }),
      /group_not_found/,
    )
    await assert.rejects(
      s.fixture.pool.query('UPDATE capture_group_location SET version=version+1'),
      /immutable|authority/,
    )
  } finally {
    await dispose(s.fixture)
  }
})

test('Review resolves lot, Part, group and batch locations per physical lot and blocks conflicts', async () => {
  const s = await setup()
  try {
    const { firstLotId, secondLotId, emptyLotId } = s.fixture
    const [first] = await s.fixture.seedEvidence([firstLotId])
    const [secondX, secondY] = await s.fixture.seedEvidence([secondLotId], 2)
    const x = (await s.media({ kind: 'group', label: 'Bag X' })).groups.find(
      (g) => g.label === 'Bag X',
    )!.id
    const y = (await s.media({ kind: 'group', label: 'Bag Y' })).groups.find(
      (g) => g.label === 'Bag Y',
    )!.id
    await s.media({
      kind: 'move_many',
      evidence_ids: [first.evidenceId, secondX.evidenceId],
      group_id: x,
    })
    await s.media({ kind: 'move_many', evidence_ids: [secondY.evidenceId], group_id: y })

    await s.edit({ kind: 'defaults', location: await s.observe('40') })
    await s.edit({ kind: 'group_location', group_id: x, location: await s.observe('41') })
    await s.edit({ kind: 'group_location', group_id: y, location: await s.observe('42') })
    const parts = await s.choosePartsFor([firstLotId, secondLotId, emptyLotId])
    for (const lotId of [firstLotId, secondLotId, emptyLotId]) {
      await s.edit({ kind: 'lot', id: lotId, quantity: { mode: 'set', value: '5' } })
    }

    let material = await s.material([firstLotId, secondLotId, emptyLotId])
    assert.equal(effectLocation(material, firstLotId), '41', 'one group')
    assert.equal(effectLocation(material, emptyLotId), '40', 'batch default')
    assert.deepEqual(
      material.issues.filter((value) => value.code === 'location_conflict').map((v) => v.lot_id),
      [secondLotId],
    )

    // A shared-Part assignment outranks the conflicting groups; the lots stay distinct.
    await s.edit({ kind: 'part', id: parts.get(secondLotId)!, location: await s.observe('43') })
    material = await s.material([firstLotId, secondLotId, emptyLotId])
    assert.equal(
      material.issues.some((value) => value.code === 'location_conflict'),
      false,
    )
    assert.equal(effectLocation(material, secondLotId), '43')

    // Changing the batch default moves only the fallback lot and never a quantity.
    const before = new Map(
      material.subjects.map((value) => [value.subjectId, value.digest.toString('hex')]),
    )
    await s.edit({ kind: 'defaults', location: await s.observe('44') })
    material = await s.material([firstLotId, secondLotId, emptyLotId])
    const changed = material.subjects
      .filter((value) => before.get(value.subjectId) !== value.digest.toString('hex'))
      .map((value) => value.subjectId)
    assert.deepEqual(changed, [emptyLotId])
    assert.equal(effectLocation(material, emptyLotId), '44')
    assert.deepEqual(
      s.batch.lots.map((value) => value.quantity),
      [firstLotId, secondLotId, emptyLotId].map(() => ({ mode: 'set', value: '5' })),
    )

    // A group clear suppresses the batch default; a lot value outranks every group.
    await s.edit({ kind: 'group_location', group_id: x, location: { mode: 'clear' } })
    material = await s.material([firstLotId])
    assert.equal(effectLocation(material, firstLotId), null)
    assert.equal(
      material.issues.some((value) => value.lot_id === firstLotId),
      false,
    )
    await s.edit({ kind: 'lot', id: firstLotId, location: await s.observe('45') })
    material = await s.material([firstLotId])
    assert.equal(effectLocation(material, firstLotId), '45')
  } finally {
    await dispose(s.fixture)
  }
})

test('moving linked evidence between groups invalidates only the lot it resolves', async () => {
  const s = await setup()
  try {
    const { firstLotId, secondLotId } = s.fixture
    const [first] = await s.fixture.seedEvidence([firstLotId])
    await s.fixture.seedEvidence([secondLotId])
    const x = (await s.media({ kind: 'group', label: 'X' })).groups[0].id
    await s.edit({ kind: 'group_location', group_id: x, location: await s.observe('41') })
    await s.edit({ kind: 'defaults', location: await s.observe('40') })
    await s.choosePartsFor([firstLotId, secondLotId])
    for (const lotId of [firstLotId, secondLotId]) {
      await s.edit({ kind: 'lot', id: lotId, quantity: { mode: 'set', value: '3' } })
    }
    let material = await s.material([firstLotId, secondLotId])
    assert.equal(effectLocation(material, firstLotId), '40')
    const before = new Map(
      material.subjects.map((value) => [value.subjectId, value.digest.toString('hex')]),
    )
    await s.media({ kind: 'move_many', evidence_ids: [first.evidenceId], group_id: x })
    material = await s.material([firstLotId, secondLotId])
    assert.equal(effectLocation(material, firstLotId), '41')
    assert.notEqual(
      material.subjects.find((v) => v.subjectId === firstLotId)!.digest.toString('hex'),
      before.get(firstLotId),
    )
    assert.equal(
      material.subjects.find((v) => v.subjectId === secondLotId)!.digest.toString('hex'),
      before.get(secondLotId),
    )
  } finally {
    await dispose(s.fixture)
  }
})
