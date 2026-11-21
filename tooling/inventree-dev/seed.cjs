const { spawn } = require('node:child_process')
const { readFile } = require('node:fs/promises')
const { join } = require('node:path')

const ORIGIN = 'http://127.0.0.1:4320'
const SEED_KEY = 'bench_intake_seed'
// Keys in backend/config/categories.yaml that are properties, not subcategories.
const RESERVED = new Set([
  'ipn_prefix',
  'identity',
  'key_parameters',
  'name',
  'parameters',
  'aliases',
  'description',
  'structural',
])

class SeedError extends Error {}
const refuse = (code) => new SeedError(code)

/** Category paths from the importer's nested-mapping config, without a YAML dependency. */
function configuredCategoryPaths(text) {
  const paths = new Set()
  const stack = []
  for (const line of text.split('\n')) {
    if (/^\s*(#.*)?$/.test(line)) continue
    const indent = line.match(/^ */)[0].length
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    const key = line
      .match(/^ *([^\s#-][^:]*):\s*(#.*)?$/)?.[1]
      ?.trim()
      .replace(/^["']|["']$/g, '')
    if (key === undefined || stack.some((entry) => entry.name === null)) continue
    stack.push({ indent, name: RESERVED.has(key) ? null : key })
    if (!RESERVED.has(key)) paths.add(stack.map((entry) => entry.name).join('/'))
  }
  return paths
}

/** The importer, pointed at the local instance only: no root .env, no username/password. */
function importerCommand(ctx, state, args, baseEnv = process.env) {
  const env = Object.fromEntries(
    Object.entries(baseEnv).filter(
      ([key, value]) => !key.startsWith('INVENTREE_') && value !== undefined,
    ),
  )
  return {
    command: 'uv',
    args: [
      'run',
      '--project',
      join(ctx.repository, 'backend'),
      'invimport',
      '--env-file',
      '/dev/null',
      ...args,
    ],
    env: { ...env, INVENTREE_URL: ORIGIN, INVENTREE_TOKEN: state.tokens.writer },
  }
}

function checkCommand(ctx, state, baseEnv = process.env) {
  const base = importerCommand(ctx, state, [], baseEnv)
  return {
    ...base,
    args: [
      'run',
      '--project',
      join(ctx.repository, 'backend'),
      'python',
      '-I',
      join(ctx.repository, 'tooling/inventree-dev/scripts/seed_check.py'),
      'check',
    ],
  }
}

/** Finds a seeded record by its seed key, adopts an untagged natural-key match, or creates it. */
async function loadFixtures(api, fixtures) {
  const summary = { created: 0, existing: 0, adopted: 0 }
  const tag = (model, pk, key) =>
    api.patch(`/api/metadata/${model}/${pk}/`, { metadata: { [SEED_KEY]: key } })
  async function ensure(endpoint, model, key, lookup, body, matches = () => true) {
    const candidates = (await api.get(`/api/${endpoint}/?${new URLSearchParams(lookup)}`)).filter(
      matches,
    )
    let untagged
    for (const row of candidates) {
      const seeded = (await api.get(`/api/metadata/${model}/${row.pk}/`)).metadata?.[SEED_KEY]
      if (seeded === key) {
        summary.existing++
        return row.pk
      }
      if (seeded === undefined && untagged === undefined) untagged = row
    }
    if (untagged) {
      // A create whose tag was interrupted; tag it rather than create a duplicate.
      await tag(model, untagged.pk, key)
      summary.adopted++
      return untagged.pk
    }
    const response = await api.post(`/api/${endpoint}/`, body)
    // Stock creates answer with the list of created items.
    const created = Array.isArray(response) ? response[0] : response
    if (!Number.isInteger(created?.pk)) throw refuse('inventree_dev_seed_request_failed')
    await tag(model, created.pk, key)
    summary.created++
    return created.pk
  }

  const categories = await api.get('/api/part/category/')
  const categoryPk = (path) => {
    const found = categories.find((row) => row.pathstring === path)
    if (!found) throw refuse('inventree_dev_seed_unknown_category')
    return found.pk
  }
  // Check every category before anything is created.
  for (const part of fixtures.parts) categoryPk(part.category)

  const ids = new Map()
  for (const location of fixtures.locations) {
    const parent = location.parent ? ids.get(location.parent) : undefined
    ids.set(
      location.key,
      await ensure(
        'stock/location',
        'stocklocation',
        location.key,
        parent ? { name: location.name, parent } : { name: location.name },
        {
          name: location.name,
          description: location.description ?? '',
          ...(parent ? { parent } : {}),
        },
        // A name filter alone also matches nested locations; a top-level fixture needs no parent.
        (row) => (parent ? row.parent === parent : row.parent == null),
      ),
    )
  }
  for (const company of fixtures.companies) {
    ids.set(
      company.key,
      await ensure(
        'company',
        'company',
        company.key,
        { name: company.name },
        {
          name: company.name,
          description: company.description ?? '',
          is_manufacturer: Boolean(company.is_manufacturer),
          is_supplier: Boolean(company.is_supplier),
          is_customer: false,
        },
      ),
    )
  }
  for (const part of fixtures.parts) {
    const pk = await ensure(
      'part',
      'part',
      part.key,
      { IPN: part.IPN },
      {
        name: part.name,
        IPN: part.IPN,
        description: part.description,
        category: categoryPk(part.category),
        component: true,
        purchaseable: true,
        active: true,
      },
    )
    ids.set(part.key, pk)
    let manufacturerPart
    if (part.manufacturer) {
      const manufacturer = ids.get(part.manufacturer)
      manufacturerPart = await ensure(
        'company/part/manufacturer',
        'manufacturerpart',
        `${part.key}:mpn`,
        { part: pk, MPN: part.MPN },
        { part: pk, manufacturer, MPN: part.MPN },
      )
    }
    if (part.supplier) {
      const supplier = ids.get(part.supplier)
      await ensure(
        'company/part',
        'supplierpart',
        `${part.key}:sku`,
        { supplier, SKU: part.SKU },
        {
          part: pk,
          supplier,
          SKU: part.SKU,
          ...(manufacturerPart ? { manufacturer_part: manufacturerPart } : {}),
        },
      )
    }
  }
  for (const item of fixtures.stock) {
    const part = ids.get(item.part)
    const location = ids.get(item.location)
    await ensure(
      'stock',
      'stockitem',
      item.key,
      { part, location },
      { part, location, quantity: item.quantity },
    )
  }
  return summary
}

function restApi(token) {
  async function request(method, path, body) {
    const response = await fetch(`${ORIGIN}${path}`, {
      method,
      headers: {
        Authorization: `Token ${token}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      process.stderr.write(
        `Seed request refused: ${method} ${path.split('?')[0]} -> ${response.status}\n`,
      )
      throw refuse('inventree_dev_seed_request_failed')
    }
    return response.json()
  }
  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    patch: (path, body) => request('PATCH', path, body),
  }
}

function runCommand({ command, args, env }, cwd) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.once('error', reject)
    child.once('close', (status) => done({ status, stdout, stderr }))
  })
}

/** Makes the instance match backend/config, then loads the fixture records exactly once. */
async function seed(ctx, state, deps = {}) {
  const run = deps.run ?? ((command) => runCommand(command, ctx.repository))
  for (const args of [
    ['parameters', '--write'],
    ['categories', '--write'],
  ]) {
    const result = await run(importerCommand(ctx, state, args))
    if (result.status !== 0) throw refuse('inventree_dev_seed_import_failed')
  }
  const check = await run(checkCommand(ctx, state))
  let report
  try {
    report = JSON.parse(check.stdout.trim().split('\n').pop())
  } catch {
    throw refuse('inventree_dev_seed_incomplete')
  }
  if (check.status !== 0 || report.complete !== true) {
    for (const item of [...(report.pending ?? []), ...(report.problems ?? [])].slice(0, 20)) {
      ctx.log?.(`  incomplete: ${item}`)
    }
    throw refuse('inventree_dev_seed_incomplete')
  }
  const fixtures =
    deps.fixtures ??
    JSON.parse(
      await readFile(join(ctx.repository, 'tooling/inventree-dev/seed/fixtures.json'), 'utf8'),
    )
  const summary = await loadFixtures(deps.api ?? restApi(state.tokens.writer), fixtures)
  ctx.log?.(
    `Seeded from backend/config (${report.categories} categories, ${report.templates} templates, ${report.units} units) and fixtures (${summary.created} created, ${summary.existing} existing, ${summary.adopted} adopted).`,
  )
  return { report, summary }
}

module.exports = { SEED_KEY, configuredCategoryPaths, importerCommand, loadFixtures, seed }
