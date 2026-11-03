import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import { captureRepository } from '../../src/capture/repository.ts'
import { validate, type CaptureSnapshotDto, type CaptureContextDto } from '@invimport/contracts'

async function checked(value: Promise<unknown>): Promise<CaptureSnapshotDto> {
  const result = await value
  validate('CaptureSnapshot', result)
  return result as CaptureSnapshotDto
}

const context: CaptureContextDto = {
  supplier: { mode: 'unset' },
  purchase_date: { mode: 'set', value: '2026-11-03' },
  tags: { mode: 'set', value: ['incoming', 'packet A'] },
}

test('settings save is atomic and preserves context, exact values and request identity', async () => {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const repo = captureRepository(db.pool, {
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
  })
  try {
    let saved = await checked(
      repo.create(randomUUID(), { title: 'Original', note: 'Keep packets separate' }),
    )
    assert.equal(saved.context, undefined)
    const key = randomUUID()
    const input = {
      expected_revision: saved.revision,
      change: {
        kind: 'settings' as const,
        title: 'New title',
        quantity: { mode: 'set' as const, value: '9007199254740.123456' },
        location: { mode: 'clear' as const },
        context,
        note: 'Counted exactly',
      },
    }
    saved = await checked(repo.edit(saved.id, key, input))
    assert.equal(saved.title, 'New title')
    assert.deepEqual(saved.defaults.quantity, input.change.quantity)
    assert.deepEqual(saved.context?.[0].value, context)
    assert.equal(saved.context?.[0].actor_id, identity.actor)
    assert.equal(saved.notes.at(-1)?.text, 'Counted exactly')
    assert.deepEqual(await repo.read(saved.id), saved)
    assert.deepEqual(await repo.edit(saved.id, key, input), saved)
    await assert.rejects(
      repo.edit(saved.id, key, { ...input, change: { ...input.change, title: 'Other' } }),
    )
    for (const invalid of [
      { ...context, purchase_date: { mode: 'set' as const, value: '2026-02-30' } },
      {
        ...context,
        supplier: {
          mode: 'set' as const,
          value: {
            model: 'company' as const,
            pk: '9007199254740993',
            observation_id: randomUUID(),
            target_context_id: identity.context,
          },
        },
      },
    ]) {
      await assert.rejects(
        repo.edit(saved.id, randomUUID(), {
          expected_revision: saved.revision,
          change: {
            kind: 'settings',
            title: 'Must roll back',
            context: invalid,
            note: 'Must not append',
          },
        }),
      )
      assert.deepEqual(await repo.read(saved.id), saved)
    }
    await assert.rejects(repo.edit(saved.id, randomUUID(), input))
  } finally {
    await db.dispose()
  }
})

test('supplier observations and explicit lot context are target-bound, inherited defaults retain independent versions', async () => {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const repo = captureRepository(db.pool, {
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
  })
  try {
    let saved = await checked(repo.create(randomUUID(), { title: 'Context', note: '' }))
    saved = await checked(
      repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: {
          kind: 'add_lot',
          label: 'Packet',
          note: '',
          part_subject_id: null,
        },
      }),
    )
    const observation = {
      id: randomUUID(),
      model: 'company' as const,
      pk: '9007199254740993',
      label: 'Supplier',
      target_context_id: identity.context,
      observed_at: '2026-11-03T00:00:00.000Z',
      mapping: { kind: 'company' as const, manufacturer: false, supplier: true },
    }
    await repo.observe(saved.id, randomUUID(), observation)
    saved = await checked(
      repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: {
          kind: 'settings',
          context: {
            ...context,
            supplier: {
              mode: 'set',
              value: {
                model: 'company',
                pk: observation.pk,
                observation_id: observation.id,
                target_context_id: identity.context,
              },
            },
          },
        },
      }),
    )
    const notSupplier = {
      ...observation,
      id: randomUUID(),
      pk: '9007199254740994',
      mapping: { kind: 'company' as const, manufacturer: true, supplier: false },
    }
    await repo.observe(saved.id, randomUUID(), notSupplier)
    await assert.rejects(
      repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: {
          kind: 'settings',
          context: {
            ...context,
            supplier: {
              mode: 'set',
              value: {
                model: 'company',
                pk: notSupplier.pk,
                observation_id: notSupplier.id,
                target_context_id: identity.context,
              },
            },
          },
        },
      }),
      /invalid_supplier_reference/,
    )
    await assert.rejects(
      repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: {
          kind: 'settings',
          context: {
            ...context,
            supplier: {
              mode: 'set',
              value: {
                model: 'company',
                pk: observation.pk,
                observation_id: observation.id,
                target_context_id: randomUUID(),
              },
            },
          },
        },
      }),
      /invalid_reference/,
    )
    const defaultRecord = saved.context![0]
    const lotContext = {
      supplier: { mode: 'clear' as const },
      purchase_date: { mode: 'inherit' as const },
      tags: { mode: 'unknown' as const },
    }
    saved = await checked(
      repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: { kind: 'lot', id: saved.lots[0].id, context: lotContext },
      }),
    )
    assert.deepEqual(
      saved.context!.find((record) => record.subject_id === saved.lots[0].id)!.value,
      lotContext,
    )
    assert.deepEqual(
      saved.context!.find((record) => record.subject_id === null),
      defaultRecord,
    )
    const overrideRecord = saved.context!.find((record) => record.subject_id === saved.lots[0].id)
    saved = await checked(
      repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: {
          kind: 'settings',
          context: { ...context, tags: { mode: 'set', value: ['changed default'] } },
        },
      }),
    )
    assert.deepEqual(
      saved.context!.find((record) => record.subject_id === saved.lots[0].id),
      overrideRecord,
    )
    const retained = saved
    await assert.rejects(
      repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: { kind: 'lot', id: randomUUID(), context: lotContext },
      }),
    )
    assert.deepEqual(await repo.read(saved.id), retained)
    saved = await checked(
      repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: { kind: 'batch', archived: true },
      }),
    )
    await assert.rejects(
      repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: { kind: 'settings', title: 'Blocked' },
      }),
    )
  } finally {
    await db.dispose()
  }
})

test('splitting physical lots preserves explicit human context on the new children', async () => {
  const { transaction } = await import('../../src/db/database.ts')
  const { lockCaptureForOperatorCommand } = await import('../../src/capture/repository.ts')
  const { applyRestructure } = await import('../../src/capture/operator-commands.ts')
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const binding = {
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
  }
  const repo = captureRepository(db.pool, binding)
  try {
    let saved = await checked(repo.create(randomUUID(), { title: 'Packets', note: '' }))
    saved = await checked(
      repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: { kind: 'add_lot', label: 'Packet', note: '', part_subject_id: null },
      }),
    )
    const originalId = saved.lots[0].id
    const value = {
      supplier: { mode: 'clear' as const },
      purchase_date: { mode: 'inherit' as const },
      tags: { mode: 'set' as const, value: ['opened'] },
    }
    saved = await checked(
      repo.edit(saved.id, randomUUID(), {
        expected_revision: saved.revision,
        change: { kind: 'lot', id: originalId, context: value },
      }),
    )
    saved = await transaction(db.pool, async (client) => {
      const scope = await lockCaptureForOperatorCommand(client, binding, saved.id, saved.revision)
      const input = {
        expected_revision: saved.revision,
        preview: false,
        change: {
          kind: 'split_lot' as const,
          lot_id: originalId,
          children: [
            { label: 'A', quantity: '2' },
            { label: 'B', quantity: '3' },
          ],
        },
      }
      await applyRestructure(client, scope, input)
      return scope.commit(input)
    })
    for (const lot of saved.lots.filter((lot) => lot.id !== originalId)) {
      assert.deepEqual(saved.context?.find((record) => record.subject_id === lot.id)?.value, value)
    }
  } finally {
    await db.dispose()
  }
})

test('additive context migrations preserve legacy batches and old edit commands keep the new context', async () => {
  const { readFile, readdir } = await import('node:fs/promises')
  const { createHash } = await import('node:crypto')
  const { migrate } = await import('../../src/operations/migrate.ts')
  const db = await isolatedDatabase({ migrate: false })
  try {
    await db.pool.query('CREATE TABLE schema_migration(name text PRIMARY KEY,sha256 text NOT NULL)')
    const directory = new URL('../../migrations/', import.meta.url)
    for (const name of (await readdir(directory))
      .filter((name) => /^\d{4}_.*\.sql$/.test(name) && name < '0012')
      .sort()) {
      const sql = await readFile(new URL(name, directory), 'utf8')
      await db.pool.query(sql)
      await db.pool.query('INSERT INTO schema_migration VALUES($1,$2)', [
        name,
        createHash('sha256').update(sql).digest('hex'),
      ])
    }
    const identity = await seedAuthority(db.pool)
    const sourceId = randomUUID()
    const streamId = randomUUID()
    const batchId = randomUUID()
    await db.pool.query(
      'INSERT INTO capture_source(id,namespace_key,created_by) VALUES($1,$2,$3)',
      [sourceId, `native_batch:${sourceId}`, identity.actor],
    )
    await db.pool.query('INSERT INTO ui_stream(id,stream_key) VALUES($1,$2)', [
      streamId,
      `capture:${batchId}`,
    ])
    await db.pool.query(
      'INSERT INTO capture_batch(id,source_id,actor_id,target_id,target_context_id,stream_id,title) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [
        batchId,
        sourceId,
        identity.actor,
        identity.target,
        identity.context,
        streamId,
        'Legacy title',
      ],
    )
    await migrate(db.pool)
    const repo = captureRepository(db.pool, {
      actorId: identity.actor,
      targetId: identity.target,
      targetContextId: identity.context,
    })
    let saved = await repo.read(batchId)
    assert.equal(saved.context, undefined)
    assert.equal(saved.title, 'Legacy title')
    assert.equal(saved.source_id, sourceId)
    saved = await checked(
      repo.edit(batchId, randomUUID(), {
        expected_revision: saved.revision,
        change: { kind: 'settings', context },
      }),
    )
    const retainedContext = saved.context
    saved = await checked(
      repo.edit(batchId, randomUUID(), {
        expected_revision: saved.revision,
        change: { kind: 'batch', title: 'Legacy edit kind' },
      }),
    )
    assert.deepEqual(saved.context, retainedContext)
    await assert.rejects(
      db.pool.query('UPDATE capture_context SET value=$1 WHERE batch_id=$2', [{}, batchId]),
      /immutable/,
    )
  } finally {
    await db.dispose()
  }
})

test('public settings HTTP preserves new response fields and rejects active PO intent', async () => {
  const { manualFixture } = await import('../support/manual.ts')
  const fixture = await manualFixture()
  try {
    const created = await fixture.http('/batches', { title: 'HTTP context', note: '' })
    assert.equal(created.status, 201)
    const batch = created.value as CaptureSnapshotDto
    const payload = {
      expected_revision: batch.revision,
      change: { kind: 'settings', title: 'Saved HTTP', context },
    }
    const response = await fixture.http(`/batches/${batch.id}/edits`, payload)
    assert.equal(response.status, 200)
    validate('CaptureSnapshot', response.value)
    assert.equal(response.value.title, 'Saved HTTP')
    assert.deepEqual(response.value.context[0].value, context)
    const rejected = await fixture.http(`/batches/${batch.id}/edits`, {
      expected_revision: response.value.revision,
      change: { ...payload.change, create_purchase_order: true },
    })
    assert.equal(rejected.status, 400)
  } finally {
    await fixture.dispose()
  }
})
