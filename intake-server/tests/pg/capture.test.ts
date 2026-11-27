import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from '#/api/server.ts'
import { registerCapture } from '#/capture/routes.ts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import { grantFoundation } from '#/operations/grants.ts'
import { grantCapture } from '#/capture/grants.ts'
import { database, transaction } from '#/db/database.ts'
import { verifyBytes } from '#/db/authority.ts'
import {
  validate,
  type CaptureSnapshotDto,
  type CaptureEditDto,
  type CaptureObservationDto,
} from '@invimport/contracts'

test('capture public HTTP/PG: distinct contributions, history, revisions, observations, defaults, restart and restricted authority', async () => {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const role = `intake_${randomUUID().replaceAll('-', '')}`
  const password = randomUUID()
  await db.pool.query(
    `CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 4`,
  )
  await grantFoundation(db.pool, role)
  await grantCapture(db.pool, role)
  const runtimeUrl = new URL(db.url)
  runtimeUrl.username = role
  runtimeUrl.password = password
  let runtime = database(runtimeUrl.toString())
  const config = {
    origin: 'http://127.0.0.1:1',
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
    credentialRef: 'capture_fixture',
    apiKey: 'fake-only',
  }
  let reads = 0
  const start = async () => {
    const app = createServer(config)
    await registerCapture(app, runtime.pool, config, async (op) => {
      reads++
      return { label: `${op.model === 'part' ? '100 Ω resistor' : 'Drawer'} ${op.pk}` }
    })
    config.origin = await app.listen({ host: '127.0.0.1', port: 0 })
    return app
  }
  let app = await start()
  let token = (await (await fetch(`${config.origin}/api/v1/bootstrap`)).json()).csrf_token as string
  const http = async (path: string, body?: unknown, key = randomUUID()) => {
    const response = await fetch(`${config.origin}/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin: config.origin,
        'x-intake-csrf': token,
        'idempotency-key': key,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, value: await response.json() }
  }
  try {
    const createKey = randomUUID()
    const create = {
      title: 'Packets Ω',
      note: 'Original label says approx.20; count separately.\nDo not merge.',
    }
    let response = await http('/batches', create, createKey)
    assert.equal(response.status, 201)
    let b = response.value as CaptureSnapshotDto
    validate('CaptureSnapshot', b)
    const batchId = b.id
    const sourceId = b.source_id
    assert.equal(b.notes[0].text, create.note)
    assert.equal(b.notes[0].producer, 'human')
    assert.equal(b.notes[0].actor_id, identity.actor)
    assert.equal((await http('/batches', create, createKey)).value.id, batchId)
    assert.equal((await http('/batches', { ...create, title: 'changed' }, createKey)).status, 409)
    async function edit(change: CaptureEditDto['change']) {
      const result = await http(`/batches/${batchId}/edits`, {
        expected_revision: b.revision,
        change,
      })
      assert.equal(result.status, 200, JSON.stringify(result.value))
      b = result.value as CaptureSnapshotDto
    }
    await edit({ kind: 'add_part', label: 'Shared resistor' })
    const partId = b.parts[0].id
    for (const label of ['Packet A', 'Packet B']) {
      await edit({ kind: 'add_lot', label, note: `${label} human count`, part_subject_id: partId })
    }
    const a = b.lots.find((l) => l.label === 'Packet A')!
    const bb = b.lots.find((l) => l.label === 'Packet B')!
    assert.notEqual(a.id, bb.id)
    assert.notEqual(a.contribution_key, bb.contribution_key)
    const originalLots = b.lots.map((l) => ({ id: l.id, key: l.contribution_key }))
    const observe = async (model: 'part' | 'location', pk: string) => {
      const r = await http(`/batches/${batchId}/observations`, { model, pk })
      assert.equal(r.status, 201)
      return r.value as CaptureObservationDto
    }
    const part = await observe('part', '9007199254740993')
    const loc4 = await observe('location', '104')
    const loc8 = await observe('location', '108')
    const loc5 = await observe('location', '105')
    const ref = (o: CaptureObservationDto) => {
      if (o.model !== 'part' && o.model !== 'location') {
        throw new Error('unexpected_fixture_model')
      }
      return {
        mode: 'set' as const,
        value: {
          observation_id: o.id,
          target_context_id: o.target_context_id,
          model: o.model,
          pk: o.pk,
        },
      }
    }
    await edit({ kind: 'part', id: partId, choice: ref(part) })
    await edit({ kind: 'defaults', quantity: { mode: 'unknown' }, location: ref(loc4) })
    await edit({ kind: 'lot', id: a.id, quantity: { mode: 'set', value: '0.000001' } })
    await edit({
      kind: 'lot',
      id: bb.id,
      quantity: { mode: 'set', value: '9999999999999.999999' },
      location: ref(loc8),
    })
    await edit({ kind: 'defaults', location: ref(loc5) })
    assert.deepEqual(b.lots.find((l) => l.id === a.id)?.location, { mode: 'inherit' })
    assert.deepEqual(b.lots.find((l) => l.id === bb.id)?.location, ref(loc8))
    assert.deepEqual(b.defaults.location, ref(loc5))
    assert.deepEqual(b.defaults.quantity, { mode: 'unknown' })
    const retainedKey = randomUUID()
    const retainedEdit = {
      expected_revision: b.revision,
      change: { kind: 'batch', title: 'Scoped retained command' },
    }
    response = await http(`/batches/${batchId}/edits`, retainedEdit, retainedKey)
    assert.equal(response.status, 200)
    b = response.value
    const otherTarget = await seedAuthority(db.pool)
    const previousBinding = { targetId: config.targetId, targetContextId: config.targetContextId }
    try {
      // Simulate an operator rebinding this actor's server; retained retries cannot disclose old scope.
      config.targetId = otherTarget.target
      config.targetContextId = otherTarget.context
      assert.equal((await http(`/batches/${batchId}`)).status, 404)
      assert.equal((await http(`/batches/${batchId}/edits`, retainedEdit, retainedKey)).status, 404)
      const newScope = await http('/batches', create, createKey)
      assert.equal(newScope.status, 201)
      assert.notEqual(newScope.value.id, batchId)
    } finally {
      Object.assign(config, previousBinding)
    }
    const revision = b.revision
    const race = await Promise.all(
      ['client-one', 'client-two'].map((title) =>
        http(`/batches/${batchId}/edits`, {
          expected_revision: revision,
          change: { kind: 'batch', title },
        }),
      ),
    )
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 412])
    b = (await http(`/batches/${batchId}`)).value
    const stableRevision = b.revision
    for (const quantity of [0.5, '0', '1e2', '1.0000001', '2.0', '01', '1\n', '10000000000000']) {
      assert.equal(
        (
          await http(`/batches/${batchId}/edits`, {
            expected_revision: b.revision,
            change: { kind: 'lot', id: a.id, quantity: { mode: 'set', value: quantity } },
          })
        ).status,
        400,
      )
    }
    for (const pk of [93, '0', '093', '93\n', '9223372036854775808', { pk: '93' }]) {
      assert.equal(
        (await http(`/batches/${batchId}/observations`, { model: 'part', pk })).status,
        400,
      )
    }
    for (const choice of [
      '93',
      93,
      { mode: 'set', value: '93' },
      { mode: 'set', value: { ...ref(part).value, pk: 93 } },
    ]) {
      assert.equal(
        (
          await http(`/batches/${batchId}/edits`, {
            expected_revision: b.revision,
            change: { kind: 'part', id: partId, choice },
          })
        ).status,
        400,
      )
    }
    for (const choice of [
      ref(loc4),
      { ...ref(part), value: { ...ref(part).value, observation_id: randomUUID() } },
      { ...ref(part), value: { ...ref(part).value, target_context_id: randomUUID() } },
    ]) {
      assert.equal(
        (
          await http(`/batches/${batchId}/edits`, {
            expected_revision: b.revision,
            change: { kind: 'part', id: partId, choice },
          })
        ).status,
        422,
      )
    }
    const other = (await http('/batches', { title: 'Other', note: '' })).value as CaptureSnapshotDto
    assert.equal(
      (
        await http(`/batches/${other.id}/edits`, {
          expected_revision: other.revision,
          change: { kind: 'part', id: partId, choice: ref(part) },
        })
      ).status,
      404,
    )
    assert.equal(
      (
        await http(`/batches/${other.id}/edits`, {
          expected_revision: other.revision,
          change: { kind: 'defaults', location: ref(loc4) },
        })
      ).status,
      422,
    )
    assert.equal(
      (await http(`/batches/${randomUUID()}/observations`, { model: 'part', pk: '93' })).status,
      404,
    )
    assert.equal(reads, 4, 'unauthorized scope cannot initiate an inventory read')
    assert.equal((await http(`/batches/${batchId}`)).value.revision, stableRevision)
    await edit({ kind: 'lot', id: a.id, quantity: { mode: 'clear' } })
    await edit({ kind: 'lot', id: a.id, label: 'Packet A corrected' })
    assert.deepEqual(
      b.lots.find((l) => l.id === a.id)?.quantity,
      { mode: 'clear' },
      'omitted quantity must not reset explicit clear',
    )
    await edit({ kind: 'lot', id: a.id, quantity: { mode: 'unknown' } })
    await edit({ kind: 'lot', id: a.id, quantity: { mode: 'unset' } })
    await edit({ kind: 'lot', id: a.id, quantity: { mode: 'inherit' } })
    await edit({
      kind: 'note',
      subject_id: a.id,
      text: 'Corrected count is unknown; preserve original claim.',
    })
    await edit({ kind: 'batch', archived: true })
    assert.equal(
      (
        await http(`/batches/${batchId}/edits`, {
          expected_revision: b.revision,
          change: { kind: 'note', subject_id: null, text: 'forbidden' },
        })
      ).status,
      409,
    )
    await app.close()
    await runtime.close()
    runtime = database(runtimeUrl.toString())
    app = await start()
    token = (await (await fetch(`${config.origin}/api/v1/bootstrap`)).json()).csrf_token as string
    b = (await http(`/batches/${batchId}`)).value
    assert.equal(b.source_id, sourceId)
    assert.equal(b.archived, true)
    assert.deepEqual(
      b.lots.map((l) => ({ id: l.id, key: l.contribution_key })),
      originalLots,
    )
    assert.equal(b.parts[0].choice.mode, 'set')
    assert.deepEqual(b.lots.find((l) => l.id === bb.id)?.location, ref(loc8))
    assert.equal(b.notes[0].text, create.note)
    assert.equal(b.notes.length, 4)
    await edit({ kind: 'batch', archived: false })
    assert.equal((await http('/batches')).value.batches.length, 2)
    const rows = (
      await db.pool.query(
        'SELECT command_bytes,command_digest FROM capture_revision WHERE batch_id=$1 ORDER BY revision',
        [batchId],
      )
    ).rows
    for (const row of rows) {
      verifyBytes(row.command_bytes, row.command_digest)
    }
    assert.equal(JSON.parse(rows[0].command_bytes.toString()).note, create.note)
    assert.equal(
      (
        await db.pool.query(
          "SELECT value FROM capture_selection WHERE subject_id=$1 AND field='quantity' ORDER BY version",
          [a.id],
        )
      ).rows.length,
      5,
    )
    for (const table of [
      'capture_source',
      'capture_note',
      'capture_observation',
      'capture_selection',
      'capture_revision',
    ]) {
      await assert.rejects(db.pool.query(`DELETE FROM ${table}`), /immutable_authority/)
    }
    await assert.rejects(
      db.pool.query('UPDATE capture_lot SET contribution_key=$1 WHERE id=$2', [randomUUID(), a.id]),
      /immutable_capture_identity/,
    )
    await assert.rejects(
      runtime.pool.query('UPDATE capture_batch SET source_id=$1 WHERE id=$2', [
        randomUUID(),
        batchId,
      ]),
      { code: '42501' },
    )
    await assert.rejects(
      transaction(db.pool, (c) =>
        c.query("INSERT INTO capture_subject(batch_id,id,kind,label) VALUES($1,$2,'lot','naked')", [
          batchId,
          randomUUID(),
        ]),
      ),
      { code: '23514' },
    )
  } finally {
    await app.close()
    await runtime.close()
    await db.pool.query(`DROP OWNED BY ${role}`)
    await db.pool.query(`DROP ROLE ${role}`)
    await db.dispose()
  }
})
