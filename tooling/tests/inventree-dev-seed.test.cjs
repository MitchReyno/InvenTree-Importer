const test = require('node:test')
const assert = require('node:assert/strict')
const { readFile } = require('node:fs/promises')
const { join } = require('node:path')
const seed = require('../inventree-dev/seed.cjs')

const repository = join(__dirname, '../..')
const SEED_KEY = 'bench_intake_seed'

/** In-memory stand-in for the InvenTree REST endpoints the loader uses. */
function fakeApi(initial = {}) {
  const tables = {
    'part/category': [],
    'stock/location': [],
    company: [],
    part: [],
    'company/part/manufacturer': [],
    'company/part': [],
    stock: [],
    ...initial,
  }
  const metadata = new Map()
  const models = {
    'part/category': 'partcategory',
    'stock/location': 'stocklocation',
    company: 'company',
    part: 'part',
    'company/part/manufacturer': 'manufacturerpart',
    'company/part': 'supplierpart',
    stock: 'stockitem',
  }
  let next = 100
  const calls = []
  const api = {
    calls,
    tables,
    metadata,
    async get(path) {
      calls.push(['GET', path])
      const meta = path.match(/^\/api\/metadata\/([a-z]+)\/(\d+)\/$/)
      if (meta) return { metadata: metadata.get(`${meta[1]}:${meta[2]}`) ?? {} }
      const [endpoint, query = ''] = path
        .replace(/^\/api\//, '')
        .replace(/\/$/, '')
        .split('/?')
      const filters = Object.fromEntries(new URLSearchParams(query))
      return (tables[endpoint] ?? []).filter((row) =>
        Object.entries(filters).every(([key, value]) => String(row[key]) === value),
      )
    },
    async post(path, body) {
      calls.push(['POST', path, body])
      const endpoint = path.replace(/^\/api\//, '').replace(/\/$/, '')
      const row = { pk: next++, ...body }
      if (endpoint === 'part/category' || endpoint === 'stock/location') {
        const parent = tables[endpoint].find((item) => item.pk === body.parent)
        row.pathstring = parent ? `${parent.pathstring}/${body.name}` : body.name
      }
      tables[endpoint].push(row)
      api.lastModel = models[endpoint]
      // InvenTree answers a stock create with the list of items it created.
      const response = endpoint === 'stock' ? [row] : row
      if (api.failTagOnce && endpoint === api.failTagOnce) {
        api.failTagOnce = undefined
        api.interruptNextTag = true
      }
      return response
    },
    async patch(path, body) {
      calls.push(['PATCH', path, body])
      if (api.interruptNextTag) {
        api.interruptNextTag = false
        throw new Error('interrupted')
      }
      const meta = path.match(/^\/api\/metadata\/([a-z]+)\/(\d+)\/$/)
      assert(meta, `only metadata is ever patched: ${path}`)
      metadata.set(`${meta[1]}:${meta[2]}`, {
        ...metadata.get(`${meta[1]}:${meta[2]}`),
        ...body.metadata,
      })
      return { metadata: metadata.get(`${meta[1]}:${meta[2]}`) }
    },
  }
  return api
}

function categories(...paths) {
  return paths.map((pathstring, index) => ({
    pk: index + 1,
    pathstring,
    name: pathstring.split('/').pop(),
  }))
}

const fixtures = {
  version: 1,
  locations: [
    { key: 'loc-bench', name: 'Bench' },
    { key: 'loc-drawer', name: 'Drawer A1', parent: 'loc-bench' },
  ],
  companies: [
    { key: 'co-maker', name: 'Seed Maker', is_manufacturer: true },
    { key: 'co-shop', name: 'Seed Shop', is_supplier: true },
  ],
  parts: [
    {
      key: 'part-amp',
      name: 'Seed amp',
      IPN: 'SEED-IC-0001',
      description: 'Dual op-amp',
      category: 'Integrated Circuits/Op-Amps',
      manufacturer: 'co-maker',
      MPN: 'SEED358',
      supplier: 'co-shop',
      SKU: 'SEED-358-ND',
    },
  ],
  stock: [{ key: 'stock-amp', part: 'part-amp', location: 'loc-drawer', quantity: 10 }],
}

test('fixtures load once and a re-run creates nothing', async () => {
  const api = fakeApi({
    'part/category': categories('Integrated Circuits', 'Integrated Circuits/Op-Amps'),
  })
  const first = await seed.loadFixtures(api, fixtures)
  assert.deepEqual(first, { created: 8, existing: 0, adopted: 0 })
  const amp = api.tables.part[0]
  assert.equal(amp.category, 2)
  assert.equal(api.metadata.get(`part:${amp.pk}`)[SEED_KEY], 'part-amp')
  assert.equal(api.tables.stock[0].location, api.tables['stock/location'][1].pk)
  const before = JSON.stringify(api.tables)
  const second = await seed.loadFixtures(api, fixtures)
  assert.deepEqual(second, { created: 0, existing: 8, adopted: 0 })
  assert.equal(JSON.stringify(api.tables), before)
})

test('records the loader did not seed are left alone', async () => {
  const api = fakeApi({
    'part/category': categories('Integrated Circuits', 'Integrated Circuits/Op-Amps'),
    company: [{ pk: 50, name: 'Seed Maker' }],
  })
  api.metadata.set('company:50', { owner: 'someone', [SEED_KEY]: 'another-seed' })
  await seed.loadFixtures(api, fixtures)
  assert.deepEqual(api.metadata.get('company:50'), { owner: 'someone', [SEED_KEY]: 'another-seed' })
  assert(!api.calls.some(([method, path]) => method === 'PATCH' && path.includes('/company/50/')))
  assert.equal(api.tables.company.filter((row) => row.name === 'Seed Maker').length, 2)
})

test('an interrupted create-then-tag is adopted on re-run, not duplicated', async () => {
  const api = fakeApi({
    'part/category': categories('Integrated Circuits', 'Integrated Circuits/Op-Amps'),
  })
  api.failTagOnce = 'part'
  await assert.rejects(seed.loadFixtures(api, fixtures), /interrupted/)
  assert.equal(api.tables.part.length, 1)
  const rerun = await seed.loadFixtures(api, fixtures)
  assert.equal(api.tables.part.length, 1)
  assert.equal(rerun.adopted, 1)
  assert.equal(api.metadata.get(`part:${api.tables.part[0].pk}`)[SEED_KEY], 'part-amp')
})

test('a fixture category missing on the server is refused', async () => {
  const api = fakeApi({ 'part/category': categories('Integrated Circuits') })
  await assert.rejects(seed.loadFixtures(api, fixtures), /inventree_dev_seed_unknown_category/)
  assert(
    !api.calls.some(([method]) => method === 'POST'),
    'nothing is created before every category resolves',
  )
})

test('the importer runs with an empty env file and a scrubbed environment', () => {
  const command = seed.importerCommand(
    { stateDir: '/private/state', repository },
    { tokens: { writer: 'inv-writer-20261106' } },
    ['parameters', '--write'],
    {
      PATH: '/bin',
      HOME: '/home/x',
      INVENTREE_USER: 'real',
      INVENTREE_PASSWORD: 'real-secret',
      INVENTREE_URL: 'https://protected.example',
    },
  )
  assert.equal(command.command, 'uv')
  assert.deepEqual(command.args, [
    'run',
    '--project',
    join(repository, 'backend'),
    'invimport',
    '--env-file',
    '/dev/null',
    'parameters',
    '--write',
  ])
  assert.equal(command.env.INVENTREE_URL, 'http://127.0.0.1:4320')
  assert.equal(command.env.INVENTREE_TOKEN, 'inv-writer-20261106')
  assert.equal(command.env.INVENTREE_USER, undefined)
  assert.equal(command.env.INVENTREE_PASSWORD, undefined)
  assert.equal(command.env.PATH, '/bin')
})

test('seeding fails when the config sync left anything incomplete', async () => {
  const outcomes = []
  const deps = {
    run: async (command) => {
      outcomes.push(command.args.slice(-2).join(' '))
      return { status: 0, stdout: command.args.includes('check') ? '{"complete": false}' : '' }
    },
    api: fakeApi(),
    fixtures,
  }
  await assert.rejects(
    seed.seed(
      { stateDir: '/private/state', repository, env: {} },
      { tokens: { writer: 'w' } },
      deps,
    ),
    /inventree_dev_seed_incomplete/,
  )
  assert.deepEqual(outcomes.slice(0, 2), ['parameters --write', 'categories --write'])
})

test('fixture parts use categories that the importer config defines', async () => {
  const shipped = JSON.parse(
    await readFile(join(repository, 'tooling/inventree-dev/seed/fixtures.json'), 'utf8'),
  )
  const configured = seed.configuredCategoryPaths(
    await readFile(join(repository, 'backend/config/categories.yaml'), 'utf8'),
  )
  assert(configured.has('Integrated Circuits/Op-Amps'))
  assert(configured.has('Capacitors/Ceramic Capacitors'))
  assert(!configured.has('Capacitors/Ceramic Capacitors/aliases'))
  assert(shipped.parts.length >= 3)
  for (const part of shipped.parts) assert(configured.has(part.category), part.category)
  const keys = [shipped.locations, shipped.companies, shipped.parts, shipped.stock]
    .flat()
    .map((row) => row.key)
  assert.equal(new Set(keys).size, keys.length, 'seed keys are unique')
})
