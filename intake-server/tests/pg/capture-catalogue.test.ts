import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { AddressInfo } from 'node:net'
import { validate } from '@invimport/contracts'
import { isolatedDatabase, seedAuthority } from '../support/database.ts'
import { database } from '../../src/db/database.ts'
import { grantFoundation } from '../../src/operations/grants.ts'
import { grantCapture } from '../../src/capture/grants.ts'
import { createServer } from '../../src/api/server.ts'
import { registerCapture } from '../../src/capture/routes.ts'
import { captureRead } from '../../src/capture/read.ts'
import { catalogueReader } from '../../src/capture/catalogue.ts'
import { inventoryTransport } from '../../src/inventory/transport.ts'

type Handler = (url: URL, response: ServerResponse) => void | Promise<void>

/** Controlled loopback HTTP endpoint recording every request it receives. */
async function controlled(handler: Handler) {
  const hits: string[] = []
  const server = createHttpServer(async (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? '/', 'http://fixture.invalid')
    hits.push(`${url.pathname}${url.search}`)
    await handler(url, response)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return {
    origin,
    hits,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function json(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(value))
}

const locations = [
  {
    pk: 11,
    name: 'Incoming inspection drawer',
    description: '',
    pathstring: 'Bench/Incoming inspection drawer',
    parent: 10,
    structural: false,
  },
  {
    pk: 12,
    name: 'Drawer 4',
    description: 'Resistors',
    pathstring: 'Bench/Drawer 4',
    parent: 10,
    structural: false,
  },
  {
    pk: 13,
    name: 'Drawer 4',
    description: null,
    pathstring: 'Store/Drawer 4',
    parent: 20,
    structural: false,
  },
]
const suppliers = [
  { pk: 7, name: 'Mouser Electronics', description: '', is_supplier: true, is_manufacturer: false },
]

test('catalogue HTTP reads authorize before traffic, fence context and never follow target links', async () => {
  const sink = await controlled((_url, response) =>
    json(response, { count: 0, next: null, previous: null, results: [] }),
  )
  let mode: 'normal' | 'redirect' | 'error' | 'invalid' | 'rotate' = 'normal'
  let rotate: (() => Promise<void>) | undefined
  const target = await controlled(async (url, response) => {
    if (mode === 'redirect') {
      response.writeHead(302, { location: `${sink.origin}/api/stock/location/` })
      response.end()
      return
    }
    if (mode === 'error') {
      json(response, { detail: 'boom' }, 500)
      return
    }
    if (mode === 'invalid') {
      json(response, locations)
      return
    }
    if (mode === 'rotate') {
      await rotate?.()
    }
    const search = url.searchParams.get('search')
    if (url.pathname === '/api/company/7/') {
      json(response, { ...suppliers[0], website: '' })
      return
    }
    const rows = url.pathname === '/api/company/' ? suppliers : locations
    const filtered = search === null ? rows : rows.filter((row) => row.name.includes(search))
    json(response, {
      count: filtered.length,
      next: `${sink.origin}${url.pathname}?limit=100&offset=100`,
      previous: null,
      results: filtered,
    })
  })

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
    credentialRef: 'catalogue_fixture',
    apiKey: 'fake-only',
  }
  const transport = inventoryTransport({
    kind: 'protected-read-only',
    origin: target.origin,
    targetId: identity.target,
    contextId: identity.context,
    protectedOrigins: [target.origin],
    credential: 'fake-only',
  })
  const binding = { targetId: identity.target, contextId: identity.context }
  const app = createServer(config)
  await registerCapture(
    app,
    runtime.pool,
    config,
    captureRead((operation) => transport.read(binding, operation)),
    catalogueReader({
      list: (operation) => transport.list(binding, operation),
      read: (operation) => transport.read(binding, operation),
      targetContextId: identity.context,
    }),
  )
  config.origin = await app.listen({ host: '127.0.0.1', port: 0 })
  const token = (await (await fetch(`${config.origin}/api/v1/bootstrap`)).json())
    .csrf_token as string
  const http = async (path: string, body?: unknown) => {
    const response = await fetch(`${config.origin}/api/v1${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin: config.origin,
        'x-intake-csrf': token,
        'idempotency-key': randomUUID(),
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, value: await response.json() }
  }

  try {
    const batch = (await http('/batches', { title: 'Catalogue', note: '' })).value
    const searched = await http(`/batches/${batch.id}/catalogue/location?q=Drawer%204`)
    assert.equal(searched.status, 200)
    validate('CatalogueSearch', searched.value)
    assert.deepEqual(
      searched.value.results.map((record: { pk: string; path: string }) => [
        record.pk,
        record.path,
      ]),
      [
        ['12', 'Bench/Drawer 4'],
        ['13', 'Store/Drawer 4'],
      ],
    )
    assert.deepEqual(target.hits, [
      '/api/stock/location/?limit=50&offset=0&ordering=name&search=Drawer+4',
    ])

    const typo = await http(`/batches/${batch.id}/catalogue/location?q=Incomming`)
    assert.deepEqual(typo.value.results, [], 'strict upstream search omits the typo')
    const snapshot = await http(`/batches/${batch.id}/catalogue/location/candidates`)
    assert.equal(snapshot.status, 200)
    validate('CatalogueCandidates', snapshot.value)
    assert.ok(
      snapshot.value.candidates.some(
        (record: { name: string }) => record.name === 'Incoming inspection drawer',
      ),
      'the admitted snapshot still contains the intended record for fuzzy ranking',
    )
    assert.deepEqual(snapshot.value.coverage, { loaded: 3, total: 3, truncated: false })

    const exact = await http(`/batches/${batch.id}/catalogue/supplier?q=7`)
    assert.equal(exact.value.exact_id.status, 'found')
    assert.equal(exact.value.exact_id.record.pk, '7')
    // Selection binds only through the existing observation command.
    const observed = await http(`/batches/${batch.id}/observations`, { model: 'company', pk: '7' })
    assert.equal(observed.status, 201)
    assert.deepEqual(observed.value.mapping, {
      kind: 'company',
      manufacturer: false,
      supplier: true,
    })
    assert.equal(sink.hits.length, 0, 'upstream next links are never followed')

    const hitsBefore = target.hits.length
    const refusedBeforeTraffic: Array<[string, number]> = [
      [`/batches/${randomUUID()}/catalogue/location?q=Drawer`, 404],
      [`/batches/${batch.id}/catalogue/part?q=Drawer`, 400],
      [`/batches/${batch.id}/catalogue/location?q=${'x'.repeat(101)}`, 400],
      [`/batches/${batch.id}/catalogue/location?q=a%0Ab`, 400],
      [`/batches/${batch.id}/catalogue/location`, 400],
    ]
    for (const [path, status] of refusedBeforeTraffic) {
      assert.equal((await http(path)).status, status, path)
    }
    assert.equal(target.hits.length, hitsBefore, 'refusals send no target request')

    for (const [failure, code] of [
      ['redirect', 'catalogue_unavailable'],
      ['error', 'catalogue_unavailable'],
      ['invalid', 'catalogue_unavailable'],
    ] as const) {
      mode = failure
      const refused = await http(`/batches/${batch.id}/catalogue/location?q=Drawer`)
      assert.equal(refused.status, 503, failure)
      assert.equal(refused.value.code, code)
    }
    assert.equal(sink.hits.length, 0, 'the redirect sink was never reached')

    // A target-context rotation while the read is in flight makes its result unusable.
    mode = 'rotate'
    rotate = async () => {
      const next = randomUUID()
      await db.pool.query('INSERT INTO target_context VALUES ($1,$2,2,$3)', [
        next,
        identity.target,
        Buffer.alloc(32, 1),
      ])
      await db.pool.query('UPDATE target SET current_context_id=$1 WHERE id=$2', [
        next,
        identity.target,
      ])
      rotate = undefined
    }
    const rotated = await http(`/batches/${batch.id}/catalogue/location?q=Drawer`)
    assert.equal(rotated.status, 409)
    assert.equal(rotated.value.code, 'target_context_changed')
    mode = 'normal'
    const rotatedHits = target.hits.length
    assert.equal((await http(`/batches/${batch.id}/catalogue/location?q=Drawer`)).status, 409)
    assert.equal(target.hits.length, rotatedHits, 'a stale context is refused before traffic')
  } finally {
    await app.close()
    await runtime.close()
    await target.close()
    await sink.close()
    await db.pool.query(`DROP OWNED BY ${role}`)
    await db.pool.query(`DROP ROLE ${role}`)
    await db.dispose()
  }
})

test('archived batches and unconfigured targets refuse catalogue reads without traffic', async () => {
  const target = await controlled((_url, response) =>
    json(response, { count: 0, next: null, previous: null, results: [] }),
  )
  const db = await isolatedDatabase()
  const identity = await seedAuthority(db.pool)
  const config = {
    origin: 'http://127.0.0.1:1',
    actorId: identity.actor,
    targetId: identity.target,
    targetContextId: identity.context,
    credentialRef: 'catalogue_fixture',
    apiKey: 'fake-only',
  }
  const app = createServer(config)
  await registerCapture(app, db.pool, config)
  config.origin = await app.listen({ host: '127.0.0.1', port: 0 })
  const token = (await (await fetch(`${config.origin}/api/v1/bootstrap`)).json())
    .csrf_token as string
  const post = (path: string, body: unknown) =>
    fetch(`${config.origin}/api/v1${path}`, {
      method: 'POST',
      headers: {
        origin: config.origin,
        'x-intake-csrf': token,
        'idempotency-key': randomUUID(),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }).then((response) => response.json())
  try {
    const batch = await post('/batches', { title: 'Unconfigured', note: '' })
    const unconfigured = await fetch(
      `${config.origin}/api/v1/batches/${batch.id}/catalogue/supplier?q=Mouser`,
    )
    assert.equal(unconfigured.status, 503)
    assert.equal((await unconfigured.json()).code, 'catalogue_unavailable')
    await post(`/batches/${batch.id}/edits`, {
      expected_revision: batch.revision,
      change: { kind: 'batch', archived: true },
    })
    const archived = await fetch(
      `${config.origin}/api/v1/batches/${batch.id}/catalogue/supplier/candidates`,
    )
    assert.equal(archived.status, 409)
    assert.equal(target.hits.length, 0)
  } finally {
    await app.close()
    await target.close()
    await db.dispose()
  }
})
