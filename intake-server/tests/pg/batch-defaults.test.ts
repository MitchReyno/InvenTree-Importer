import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type {
  CaptureSnapshotDto,
  CatalogueModelDto,
  CatalogueRecordDto,
} from '@invimport/contracts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import { database } from '#/db/database.ts'
import { grantFoundation } from '#/operations/grants.ts'
import { grantCapture } from '#/capture/grants.ts'
import { createServer } from '#/api/server.ts'
import { registerCapture } from '#/capture/routes.ts'
import type { CatalogueReader } from '#/capture/catalogue.ts'
import { saveAgentSettings, unsavedAgentSettings } from '#/agents/settings.ts'
import { AUTO_TAGS_REQUESTED } from '#/capture/context-input.ts'
import { inputManifest } from '#/processing/model.ts'
import { materialize } from '#/review/model.ts'

const records: Record<CatalogueModelDto, Map<string, CatalogueRecordDto>> = {
  location: new Map([
    [
      '11',
      {
        kind: 'location',
        pk: '11',
        name: 'Drawer 4',
        description: '',
        path: 'Bench/Drawer 4',
        parent_pk: null,
        structural: false,
      },
    ],
    [
      '12',
      {
        kind: 'location',
        pk: '12',
        name: 'Drawer 5',
        description: '',
        path: 'Bench/Drawer 5',
        parent_pk: null,
        structural: false,
      },
    ],
  ]),
  supplier: new Map([
    [
      '7',
      {
        kind: 'supplier',
        pk: '7',
        name: 'Mouser Electronics',
        description: '',
        manufacturer: false,
      },
    ],
  ]),
}

/** The Capture API under a Capture-only role, with a catalogue that answers from `records`. */
async function captureApi() {
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool, { profile: 'protected-read-only' })
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
  const runtime = database(runtimeUrl.toString())
  const config = {
    origin: 'http://127.0.0.1:1',
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
    credentialRef: 'batch_defaults_fixture',
    apiKey: 'fake-only',
  }
  // `deleted` holds `model:pk` keys removed from InvenTree after they were saved.
  const state = { down: false, lookups: 0, deleted: new Set<string>() }
  const catalogue: CatalogueReader = {
    search: async () => {
      throw new Error('unused')
    },
    candidates: async (model) => ({
      model,
      target_context_id: identity.context,
      candidates: [...records[model].values()],
      coverage: { loaded: records[model].size, total: records[model].size, truncated: false },
    }),
    record: async (model, pk) => {
      state.lookups += 1
      if (state.down) {
        return { status: 'unavailable' }
      }
      const record = state.deleted.has(`${model}:${pk}`) ? undefined : records[model].get(pk)
      return record ? { status: 'found', record } : { status: 'not_found' }
    },
  }
  const app = createServer(config)
  await registerCapture(app, runtime.pool, config, undefined, catalogue)
  config.origin = await app.listen({ host: '127.0.0.1', port: 0 })
  const token = (await (await fetch(`${config.origin}/api/v1/bootstrap`)).json())
    .csrf_token as string
  const http = async (
    path: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST',
    key: string | null = randomUUID(),
  ) => {
    const response = await fetch(`${config.origin}/api/v1${path}`, {
      method,
      headers: {
        origin: config.origin,
        'x-intake-csrf': token,
        ...(key === null ? {} : { 'idempotency-key': key }),
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, value: await response.json() }
  }
  const binding = {
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
  }
  return {
    db,
    identity,
    binding,
    state,
    http,
    saveDefaults: (
      expected_revision: string,
      location_pk: string | null,
      supplier_pk: string | null,
    ) => http('/batch-defaults', { expected_revision, location_pk, supplier_pk }, 'PUT'),
    createBatch: async () =>
      (await http('/batches', { title: 'Reel drawer', note: '' })).value as CaptureSnapshotDto,
    async dispose() {
      await app.close()
      await runtime.pool.end()
      await db.dispose()
    },
  }
}

test('batch defaults save under a revision and name each saved record on read', async () => {
  const api = await captureApi()
  try {
    assert.deepEqual((await api.http('/batch-defaults')).value, {
      revision: '0',
      location: null,
      supplier: null,
    })
    const saved = await api.saveDefaults('0', '11', '7')
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.value, {
      revision: '1',
      location: { pk: '11', label: 'Drawer 4', status: 'found' },
      supplier: { pk: '7', label: 'Mouser Electronics', status: 'found' },
    })
    const stale = await api.saveDefaults('0', '12', null)
    assert.equal(stale.status, 412)
    assert.equal(stale.value.code, 'revision_conflict')
    // A newly chosen record must exist, and must be checkable.
    const missing = await api.saveDefaults('1', '99', null)
    assert.equal(missing.status, 422)
    assert.equal(missing.value.code, 'batch_default_not_found')
    api.state.down = true
    assert.equal((await api.saveDefaults('1', '12', '7')).status, 503)
    api.state.down = false
    // A saved record deleted later is reported, and an unchanged one can still be saved.
    api.state.deleted.add('location:11')
    assert.deepEqual((await api.http('/batch-defaults')).value.location, {
      pk: '11',
      label: null,
      status: 'not_found',
    })
    const kept = await api.saveDefaults('1', '11', null)
    assert.equal(kept.status, 200)
    assert.equal(kept.value.revision, '2')
    assert.equal(kept.value.supplier, null)
    // A stale save is a conflict even when its record is missing or can't be checked.
    const staleMissing = await api.saveDefaults('1', '99', null)
    assert.equal(staleMissing.status, 412)
    api.state.down = true
    assert.equal((await api.saveDefaults('1', '12', null)).status, 412)
    api.state.down = false
    api.state.down = true
    assert.deepEqual((await api.http('/batch-defaults')).value.location, {
      pk: '11',
      label: null,
      status: 'unavailable',
    })
  } finally {
    await api.dispose()
  }
})

test('a new batch copies the defaults into its first revision through the picker writes', async () => {
  const api = await captureApi()
  try {
    const { revision, ...fields } = unsavedAgentSettings()
    await saveAgentSettings(api.db.pool, api.binding, {
      ...fields,
      expected_revision: revision,
      auto_tags_default: true,
      new_batch_instructions: 'Count reels by their labels.',
    })
    await api.saveDefaults('0', '11', '7')
    const batch = await api.createBatch()
    assert.equal(batch.revision, '1')
    assert.equal(batch.creation_notices, undefined)
    const location = batch.observations.find((item) => item.model === 'location')!
    const supplier = batch.observations.find((item) => item.model === 'company')!
    assert.equal(location.pk, '11')
    assert.equal(location.label, 'Drawer 4')
    assert.deepEqual(supplier.mapping, { kind: 'company', manufacturer: false, supplier: true })
    assert.deepEqual(batch.defaults.location, {
      mode: 'set',
      value: {
        observation_id: location.id,
        target_context_id: api.identity.context,
        model: 'location',
        pk: '11',
      },
    })
    const intent = batch.settings_intent!.value
    assert.deepEqual(intent.supplier, {
      absent: false,
      selection: {
        mode: 'existing',
        reference: {
          observation_id: supplier.id,
          target_context_id: api.identity.context,
          model: 'company',
          pk: '7',
        },
      },
    })
    assert.equal(intent.shared_tags.auto, true)
    // The derived batch context is what Processing and Review fingerprints read.
    const context = batch.context!.find((record) => record.subject_id === null)!
    assert.equal(context.value.supplier.mode, 'set')
    const instructions = await api.db.pool.query(
      'SELECT group_id,version,text,actor_id FROM capture_instruction WHERE batch_id=$1',
      [batch.id],
    )
    assert.deepEqual(instructions.rows, [
      {
        group_id: null,
        version: '1',
        text: 'Count reels by their labels.',
        actor_id: api.identity.actor,
      },
    ])

    // Processing seals the copied supplier and the Auto tags request into each lot's input.
    const withLot = (
      await api.http(`/batches/${batch.id}/edits`, {
        expected_revision: batch.revision,
        change: { kind: 'add_lot', label: 'Reel A', note: '', part_subject_id: null },
      })
    ).value as CaptureSnapshotDto
    const lot = withLot.lots[0]
    const input = inputManifest(withLot, lot.id, 'reading', [], null)
    const sealed = input.notes.map((item) => item.text).join('\n')
    assert.match(sealed, /"pk":"7"/)
    assert.match(sealed, new RegExp(AUTO_TAGS_REQUESTED))
    // Review's fingerprint covers the copied supplier: without it the digest changes.
    const reviewed = materialize(withLot, [lot.id])
    const withoutContext = materialize({ ...withLot, context: [] }, [lot.id])
    assert.notEqual(reviewed.digest, withoutContext.digest)

    // A later change applies only to batches created after it.
    await api.saveDefaults('1', '12', null)
    await saveAgentSettings(api.db.pool, api.binding, {
      ...fields,
      expected_revision: '1',
      auto_tags_default: true,
      new_batch_instructions: 'Weigh small parts instead of counting.',
    })
    const reread = (await api.http(`/batches/${batch.id}`)).value as CaptureSnapshotDto
    assert.deepEqual(reread.defaults.location, batch.defaults.location)
    const next = await api.createBatch()
    assert.equal(next.observations.find((item) => item.model === 'location')!.label, 'Drawer 5')
    assert.equal(
      next.observations.some((item) => item.model === 'company'),
      false,
    )
    const copied = await api.db.pool.query<{ batch_id: string; text: string }>(
      'SELECT batch_id,text FROM capture_instruction WHERE batch_id = ANY($1::uuid[])',
      [[batch.id, next.id]],
    )
    assert.deepEqual(Object.fromEntries(copied.rows.map((row) => [row.batch_id, row.text])), {
      [batch.id]: 'Count reels by their labels.',
      [next.id]: 'Weigh small parts instead of counting.',
    })
  } finally {
    await api.dispose()
  }
})

test('a default that no longer exists, or cannot be checked, is left out and noted', async () => {
  const api = await captureApi()
  try {
    await api.saveDefaults('0', '11', '7')
    api.state.deleted.add('location:11')
    const missing = await api.createBatch()
    assert.deepEqual(missing.defaults.location, { mode: 'unset' })
    assert.deepEqual(missing.creation_notices, [{ field: 'location', code: 'default_not_found' }])
    // Only the batch's own creation note: the notice is never written as human evidence.
    assert.deepEqual(
      missing.notes.map((item) => item.text),
      [''],
    )
    assert.equal(
      missing.observations.some((item) => item.model === 'company'),
      true,
    )

    api.state.down = true
    const unchecked = await api.createBatch()
    assert.deepEqual(unchecked.creation_notices, [
      { field: 'location', code: 'default_unavailable' },
      { field: 'supplier', code: 'default_unavailable' },
    ])
    assert.equal(unchecked.observations.length, 0)
  } finally {
    await api.dispose()
  }
})

test('with no saved defaults a new batch is created as before, with no lookups', async () => {
  const api = await captureApi()
  try {
    const batch = await api.createBatch()
    assert.equal(api.state.lookups, 0)
    assert.equal(batch.settings_intent, undefined)
    assert.equal(batch.observations.length, 0)
    const instructions = await api.db.pool.query(
      'SELECT 1 FROM capture_instruction WHERE batch_id=$1',
      [batch.id],
    )
    assert.equal(instructions.rowCount, 0)
  } finally {
    await api.dispose()
  }
})

test('Settings pickers read the catalogue without a batch', async () => {
  const api = await captureApi()
  try {
    const candidates = await api.http('/catalogue/location/candidates')
    assert.equal(candidates.status, 200)
    assert.equal(candidates.value.candidates.length, 2)
    assert.equal((await api.http('/catalogue/part/candidates')).status, 400)
  } finally {
    await api.dispose()
  }
})

test('a rotated target context refuses batch defaults and a batch that would copy them', async () => {
  const api = await captureApi()
  try {
    await api.saveDefaults('0', '11', null)
    const next = randomUUID()
    await api.db.pool.query('INSERT INTO target_context VALUES ($1,$2,2,$3)', [
      next,
      api.identity.target,
      Buffer.alloc(32, 1),
    ])
    await api.db.pool.query('UPDATE target SET current_context_id=$1 WHERE id=$2', [
      next,
      api.identity.target,
    ])
    const lookups = api.state.lookups
    const read = await api.http('/batch-defaults')
    assert.equal(read.status, 409)
    assert.equal(read.value.code, 'target_context_changed')
    assert.equal(api.state.lookups, lookups, 'refused before any catalogue lookup')
    const created = await api.http('/batches', { title: 'After rotation', note: '' })
    assert.equal(created.status, 409)
    assert.equal(created.value.code, 'target_context_changed')
  } finally {
    await api.dispose()
  }
})

test('a bad key, a replayed creation or a conflicting payload never looks up the defaults', async () => {
  const api = await captureApi()
  try {
    await api.saveDefaults('0', '11', '7')
    const body = { title: 'Reel drawer', note: '' }
    const lookups = () => api.state.lookups
    let before = lookups()
    assert.equal((await api.http('/batches', body, 'POST', null)).status, 400)
    assert.equal(lookups(), before, 'missing key')
    const key = randomUUID()
    const first = await api.http('/batches', body, 'POST', key)
    assert.equal(first.status, 201)
    before = lookups()
    const replay = await api.http('/batches', body, 'POST', key)
    assert.equal(replay.status, 201)
    assert.deepEqual(replay.value, first.value)
    const conflict = await api.http('/batches', { ...body, title: 'Other' }, 'POST', key)
    assert.equal(conflict.status, 409)
    assert.equal(lookups(), before, 'replay and conflict')
  } finally {
    await api.dispose()
  }
})
