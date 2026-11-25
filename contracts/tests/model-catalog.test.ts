import assert from 'node:assert/strict'
import { test } from 'node:test'
import { agentsClient } from '../generated/client.ts'
import { validate, validationIssues } from '../src/index.ts'
import {
  BUILT_IN_MODEL_CATALOG,
  CATALOG_FAILURES,
  MAX_CATALOG_EFFORTS,
  MAX_CATALOG_MODELS,
  type AgentCatalogModelDto,
  type AgentModelCatalogDto,
} from '../src/agent-model-catalog.ts'

const opus: AgentCatalogModelDto = {
  id: 'claude-opus-4-6',
  name: 'Opus 4.6',
  older: true,
  default: false,
  efforts: ['low', 'medium', 'high', 'max'],
  default_effort: null,
  usable: null,
}
const catalog: AgentModelCatalogDto = {
  claude: {
    state: 'current',
    authentication: 'subscription',
    source: 'cli',
    read_in: 'vm',
    cli_version: '2.1.319',
    read_at: '2026-11-25T22:12:00.000Z',
    attempted_at: '2026-11-25T22:12:00.000Z',
    failure: null,
    builtin: false,
    models: [opus],
  },
  codex: {
    state: 'never_read',
    authentication: 'api_key',
    source: null,
    read_in: null,
    cli_version: null,
    read_at: null,
    attempted_at: '2026-11-25T22:12:00.000Z',
    failure: 'guest_outdated',
    builtin: true,
    models: [...BUILT_IN_MODEL_CATALOG.codex],
  },
}

test('a catalogue with each state and failure code validates', () => {
  validate('AgentModelCatalog', catalog)
  for (const state of ['reading', 'failed', 'stale_sign_in']) {
    validate('AgentModelCatalog', { ...catalog, claude: { ...catalog.claude, state } })
  }
  for (const failure of CATALOG_FAILURES) {
    validate('AgentModelCatalog', { ...catalog, codex: { ...catalog.codex, failure } })
  }
})

test('the built-in lists are valid entries with no effort levels', () => {
  for (const models of Object.values(BUILT_IN_MODEL_CATALOG)) {
    assert.ok(models.length > 0)
    for (const model of models) {
      validate('AgentCatalogModel', model)
      assert.deepEqual(model.efforts, [])
    }
  }
})

test('the catalogue limits refuse oversized and malformed entries', () => {
  const issues = (model: unknown) => validationIssues('AgentCatalogModel', model).length
  assert.equal(issues(opus), 0)
  // The model ID check refuses `[`, as a saved model does.
  assert.ok(issues({ ...opus, id: 'opus[1m]' }))
  assert.ok(issues({ ...opus, name: '' }))
  assert.ok(issues({ ...opus, name: 'x'.repeat(81) }))
  assert.ok(
    issues({ ...opus, efforts: Array.from({ length: MAX_CATALOG_EFFORTS + 1 }, () => 'low') }),
  )
  assert.ok(issues({ ...opus, efforts: ['Low'] }))
  assert.ok(issues({ ...opus, extra: true }))
  const many = Array.from({ length: MAX_CATALOG_MODELS + 1 }, () => opus)
  assert.ok(
    validationIssues('AgentModelCatalog', {
      ...catalog,
      claude: { ...catalog.claude, models: many },
    }).length,
  )
  assert.ok(
    validationIssues('AgentModelCatalog', {
      ...catalog,
      claude: { ...catalog.claude, failure: 'provider text' },
    }).length,
  )
})

test('a refresh names its provider and may invalidate', () => {
  validate('AgentModelCatalogRefresh', { provider: 'claude' })
  validate('AgentModelCatalogRefresh', { provider: 'codex', invalidate: true })
  assert.ok(validationIssues('AgentModelCatalogRefresh', { provider: 'other' }).length)
  assert.ok(validationIssues('AgentModelCatalogRefresh', { provider: 'claude', key: 'x' }).length)
})

test('the client reads the catalogue and requests a refresh', async () => {
  const calls: string[] = []
  const client = agentsClient('http://127.0.0.1:1', 'a'.repeat(64), async (url, init) => {
    const request = url instanceof Request ? url : new Request(url, init)
    calls.push(
      `${request.method} ${request.url} ${request.method === 'POST' ? await request.text() : ''}`,
    )
    const body =
      request.method === 'POST'
        ? { provider: 'claude', authentication: 'subscription', stale_sign_in: true }
        : catalog
    return new Response(JSON.stringify(body), {
      status: request.method === 'POST' ? 202 : 200,
      headers: { 'content-type': 'application/json' },
    })
  })
  assert.deepEqual(await client.modelCatalog(), catalog)
  assert.deepEqual(await client.refreshModelCatalog({ provider: 'claude', invalidate: true }), {
    provider: 'claude',
    authentication: 'subscription',
    stale_sign_in: true,
  })
  assert.deepEqual(calls, [
    'GET http://127.0.0.1:1/api/v1/agents/models ',
    'POST http://127.0.0.1:1/api/v1/agents/models/refresh {"provider":"claude","invalidate":true}',
  ])
})
