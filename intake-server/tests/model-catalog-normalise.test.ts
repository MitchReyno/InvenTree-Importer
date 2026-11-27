import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  CatalogReadError,
  checkedCatalog,
  claudeApiModels,
  claudeCliModels,
  codexModels,
  openAiModelIds,
} from '#/agents/model-catalog/normalise.ts'
import { guestReader } from '#/agents/model-catalog/readers.ts'
import { guestCatalogAnswer } from '#/agents/shared-vm/model-catalog.ts'

function fixture(name: string) {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/model-catalog/${name}`, import.meta.url), 'utf8'),
  ) as Record<string, unknown>
}

const claudeLive = fixture('claude-initialize-2.1.319.json')
const claudeOffline = fixture('claude-initialize-offline-2.1.319.json')
const codexLive = fixture('codex-model-list-0.166.0.json')

function refusedAs(run: () => unknown, code: string) {
  assert.throws(run, (error) => error instanceof CatalogReadError && error.code === code)
}

test('Claude Code 2.1.319: aliases fold into the exact models, 4.x sit in Older', () => {
  const models = claudeCliModels(claudeLive.models)
  // 14 entries, of which `default` and the four short aliases name models listed once.
  assert.equal(models.length, 13)
  const byId = new Map(models.map((model) => [model.id, model]))
  assert.equal(new Set(models.map((model) => model.id)).size, 13)
  // The exact entry's name wins over the alias's "Default (recommended)".
  assert.equal(byId.get('claude-fable-5-2')?.name, 'Fable 5.2')
  assert.equal(byId.get('claude-fable-5-2')?.default, true)
  assert.equal(models.filter((model) => model.default).length, 1)
  // An alias with no exact entry keeps its own versioned name.
  assert.equal(byId.get('claude-opus-5-5')?.name, 'Opus 5.5')
  assert.equal(byId.get('claude-sonnet-5-5')?.name, 'Sonnet 5.5')
  assert.deepEqual(byId.get('claude-sonnet-4-6')?.efforts, ['low', 'medium', 'high', 'max'])
  assert.equal(byId.get('claude-sonnet-4-6')?.older, true)
  // Haiku 4.5 takes no effort.
  assert.deepEqual(byId.get('claude-haiku-4-5-20251001')?.efforts, [])
  assert.equal(byId.get('claude-haiku-4-5-20251001')?.older, true)
  assert.equal(byId.get('claude-sonnet-5')?.older, false)
  for (const model of models) {
    assert.equal(model.default_effort, null)
    assert.equal(model.usable, null)
  }
  assert.deepEqual(
    models.filter((model) => model.older).map((model) => model.id),
    [
      'claude-haiku-4-5-20251001',
      'claude-opus-4-8',
      'claude-opus-4-7',
      'claude-opus-4-6',
      'claude-sonnet-4-6',
    ],
  )
})

test("the CLI's offline alias list is refused, so the last good list stays", () => {
  // With the network refused, 2.1.319 answers only its built-in aliases, none by exact ID.
  refusedAs(() => claudeCliModels(claudeOffline.models), 'unavailable')
})

function guestClaude(raw: unknown) {
  return guestReader(async (_provider, kind) => {
    if (kind === 'generation') {
      return { kind: 'generation', generation: 'rev-a' }
    }
    return { kind: 'read', read: { generation: 'rev-a', cliVersion: '2.1.319', raw } }
  }, 'claude')
}

test('an invalid alias folded behind a valid one still makes the reply malformed', async () => {
  const models = (claudeOffline.models as Record<string, unknown>[]).map((entry) =>
    entry.value === 'default' ? { ...entry, displayName: 'x'.repeat(81) } : entry,
  )
  await assert.rejects(
    guestClaude(models).read(AbortSignal.timeout(5_000)),
    (error) => error instanceof CatalogReadError && error.code === 'malformed',
  )
})

test('an alias list with an entry left out is malformed on the guest route', async () => {
  const models = (claudeOffline.models as Record<string, unknown>[]).map((entry) =>
    entry.value === 'opus' ? { ...entry, resolvedModel: 'opus[1m]' } : entry,
  )
  await assert.rejects(
    guestClaude(models).read(AbortSignal.timeout(5_000)),
    (error) => error instanceof CatalogReadError && error.code === 'malformed',
  )
})

test('an alias list whose folded entry is invalid is malformed on the guest route', async () => {
  // A lone `default` alias is named by its ID once folded, here past the name limit.
  const id = `claude-${'x'.repeat(86)}`
  const models = [{ value: 'default', resolvedModel: id, displayName: 'Default' }]
  await assert.rejects(
    guestClaude(models).read(AbortSignal.timeout(5_000)),
    (error) => error instanceof CatalogReadError && error.code === 'malformed',
  )
})

test('on the host an alias-only reply stays unavailable, however its aliases read', () => {
  const invalid = (claudeOffline.models as Record<string, unknown>[]).map((entry) =>
    entry.value === 'default' ? { ...entry, displayName: 'x'.repeat(81) } : entry,
  )
  const leftOut = (claudeOffline.models as Record<string, unknown>[]).map((entry) =>
    entry.value === 'opus' ? { ...entry, resolvedModel: 'opus[1m]' } : entry,
  )
  refusedAs(() => claudeCliModels(invalid), 'unavailable')
  refusedAs(() => claudeCliModels(leftOut), 'unavailable')
})

test('only the worker finds a list not listed: a guest failure saying so is refused', async () => {
  assert.throws(() => guestCatalogAnswer({ model_catalog_failure: 'not_listed' }), {
    message: 'invalid_model_catalog',
  })
  const reader = guestReader(async () => ({ kind: 'failure', failure: 'not_listed' }), 'codex')
  const malformed = (error: unknown) =>
    error instanceof CatalogReadError && error.code === 'malformed'
  await assert.rejects(reader.read(AbortSignal.timeout(5_000)), malformed)
  await assert.rejects(reader.generation(AbortSignal.timeout(5_000)), malformed)
})

test('an invalid alias-only reply is malformed, not the setup-token state', async () => {
  const long = (claudeOffline.models as Record<string, unknown>[]).map((entry) => ({
    ...entry,
    displayName: 'x'.repeat(81),
  }))
  await assert.rejects(
    guestClaude(long).read(AbortSignal.timeout(5_000)),
    (error) => error instanceof CatalogReadError && error.code === 'malformed',
  )
})

test('a guest Claude reply with no usable entry stays unavailable, not the setup-token state', async () => {
  const discarded = [{ value: 'opus[1m]', displayName: 'Opus (1M context)' }]
  for (const raw of [[], discarded]) {
    await assert.rejects(
      guestClaude(raw).read(AbortSignal.timeout(5_000)),
      (error) => error instanceof CatalogReadError && error.code === 'unavailable',
    )
  }
})

test('a guest Claude read answering only aliases lists no models for its setup token', async () => {
  // The guest signs Claude in with a setup token, which 2.1.319 answers with its aliases only.
  const reader = guestReader(async (_provider, kind) => {
    if (kind === 'generation') {
      return { kind: 'generation', generation: 'rev-a' }
    }
    return {
      kind: 'read',
      read: { generation: 'rev-a', cliVersion: '2.1.319', raw: claudeOffline.models },
    }
  }, 'claude')
  const read = await reader.read(AbortSignal.timeout(5_000))
  assert.deepEqual(read, {
    generation: 'rev-a',
    cliVersion: '2.1.319',
    models: [],
    notListed: true,
  })
})

test('IDs the model ID check refuses fold into their resolved model or are left out', () => {
  const entry = (value: string, resolvedModel: string | undefined, displayName: string) => ({
    value,
    resolvedModel,
    displayName,
    supportsEffort: true,
    supportedEffortLevels: ['low', 'high'],
  })
  const models = claudeCliModels([
    entry('opus[1m]', 'claude-opus-5-5', 'Opus (1M)'),
    entry('claude-opus-5-5', 'claude-opus-5-5', 'Opus 5.5'),
    entry('sonnet[1m]', 'claude-sonnet-5-5[1m]', 'Sonnet (1M)'),
    entry('weird[1m]', undefined, 'Weird'),
  ])
  assert.deepEqual(
    models.map((model) => [model.id, model.name]),
    [['claude-opus-5-5', 'Opus 5.5']],
  )
})

test('only 4.x models all sit in Older, and a newer major makes the rest older', () => {
  const entry = (id: string) => ({ value: id, resolvedModel: id, displayName: id })
  assert.ok(
    claudeCliModels([entry('claude-opus-4-8'), entry('claude-sonnet-4-6')]).every(
      (model) => model.older,
    ),
  )
  const mixed = claudeCliModels([entry('claude-opus-7'), entry('claude-opus-6-1')])
  assert.deepEqual(
    mixed.map((model) => model.older),
    [false, true],
  )
})

test('malformed Claude replies are refused', () => {
  refusedAs(() => claudeCliModels(undefined), 'malformed')
  refusedAs(() => claudeCliModels([{ value: 'x' }]), 'malformed')
  refusedAs(
    () =>
      claudeCliModels([
        {
          value: 'opus',
          resolvedModel: 'claude-opus-5-5',
          displayName: 'Opus',
          supportsEffort: true,
          supportedEffortLevels: ['HIGH'],
        },
      ]),
    'malformed',
  )
  refusedAs(
    () =>
      claudeCliModels([
        { value: 'claude-x-5', resolvedModel: 'claude-x-5', displayName: 'n'.repeat(81) },
      ]),
    'malformed',
  )
})

test('Codex 0.166.0: hidden models are left out, the default and its effort kept', () => {
  const hidden = { ...(codexLive.data as Record<string, unknown>[])[1], hidden: true }
  const data = [...(codexLive.data as unknown[])]
  data[1] = hidden
  const models = codexModels([{ data, nextCursor: null }])
  assert.equal(models.length, 9)
  assert.ok(!models.some((model) => model.id === 'gpt-6.2-astra'))
  const sol = models[0]
  assert.deepEqual(sol, {
    id: 'gpt-6.2-sol',
    name: 'GPT-6.2-Sol',
    older: false,
    default: true,
    efforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
    default_effort: 'low',
    usable: null,
  })
  assert.deepEqual(models.find((model) => model.id === 'gpt-6-luna')?.efforts, [
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
  ])
  assert.ok(models.every((model) => !model.older))
})

test('Codex pages are joined in order', () => {
  const data = codexLive.data as unknown[]
  const models = codexModels([
    { data: data.slice(0, 4), nextCursor: 'next' },
    { data: data.slice(4), nextCursor: null },
  ])
  assert.equal(models.length, 10)
  assert.equal(models[4].id, 'gpt-6-astra')
})

test('with an API key, each Codex model says whether the key may use it', () => {
  const usable = openAiModelIds({
    object: 'list',
    data: [
      { id: 'gpt-6.2-sol', object: 'model' },
      { id: 'gpt-6-luna', object: 'model' },
    ],
  })
  const models = codexModels([codexLive], usable)
  assert.equal(models.find((model) => model.id === 'gpt-6.2-sol')?.usable, true)
  assert.equal(models.find((model) => model.id === 'gpt-6-luna')?.usable, true)
  assert.equal(models.find((model) => model.id === 'gpt-6.1-terra')?.usable, false)
  refusedAs(() => openAiModelIds({ data: 'x' }), 'malformed')
})

test("Anthropic's models API names and efforts", () => {
  const models = claudeApiModels([
    {
      data: [
        {
          id: 'claude-opus-5-5',
          display_name: 'Claude Opus 5.5',
          capabilities: {
            effort: {
              supported: true,
              low: { supported: true },
              medium: { supported: true },
              xhigh: { supported: false },
              max: { supported: true },
            },
          },
        },
        {
          id: 'claude-haiku-4-5-20251001',
          display_name: 'Claude Haiku 4.5',
          capabilities: { effort: { supported: false } },
        },
      ],
      has_more: false,
    },
  ])
  assert.deepEqual(
    models.map((model) => [model.id, model.name, model.efforts, model.older]),
    [
      ['claude-opus-5-5', 'Opus 5.5', ['low', 'medium', 'max'], false],
      ['claude-haiku-4-5-20251001', 'Haiku 4.5', [], true],
    ],
  )
  refusedAs(() => claudeApiModels([{ data: [{ id: 5 }] }]), 'malformed')
})

test('a list over the row limit or the model count is refused', () => {
  const many = Array.from({ length: 201 }, (_unused, index) => ({
    id: `gpt-${index}`,
    model: `gpt-${index}`,
    displayName: `GPT ${index}`,
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: 'low',
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }],
  }))
  refusedAs(() => codexModels([{ data: many, nextCursor: null }]), 'malformed')
  const long = Array.from({ length: 200 }, (_unused, index) => ({
    id: `m${index}-${'x'.repeat(120)}`,
    name: 'n'.repeat(80),
    older: false,
    default: false,
    efforts: Array.from({ length: 12 }, () => 'a'.repeat(32)),
    default_effort: null,
    usable: null,
  }))
  refusedAs(() => checkedCatalog(long), 'malformed')
})
