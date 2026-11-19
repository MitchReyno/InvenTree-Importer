import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentSettingsDto } from '@invimport/contracts'
import { resolveSelection } from '#/agents/resolve-selection.ts'

const settings = (
  overrides: Partial<Pick<AgentSettingsDto, 'default_provider' | 'stage_selections'>> & {
    codexOn?: boolean
    claudeOn?: boolean
  } = {},
) => ({
  providers: {
    claude: {
      enabled: overrides.claudeOn ?? true,
      authentication: 'subscription' as const,
      default_model: 'sonnet',
    },
    codex: {
      enabled: overrides.codexOn ?? true,
      authentication: 'api_key' as const,
      default_model: 'gpt-6.1-sol',
    },
  },
  default_provider:
    overrides.default_provider === undefined ? 'claude' : overrides.default_provider,
  stage_selections: overrides.stage_selections ?? {},
})

test("a step's own choice uses that provider's sign-in and the step's model", () => {
  const resolved = resolveSelection(
    settings({ stage_selections: { research: { provider: 'codex', model: 'gpt-6-luna' } } }),
    'research',
  )
  assert.deepEqual(resolved, { provider: 'codex', authentication: 'api_key', model: 'gpt-6-luna' })
})

test('a step on Default uses the default provider and its default model', () => {
  const resolved = resolveSelection(
    settings({ stage_selections: { research: { provider: 'codex', model: 'gpt-6-luna' } } }),
    'images',
  )
  assert.deepEqual(resolved, {
    provider: 'claude',
    authentication: 'subscription',
    model: 'sonnet',
  })
})

test('a step on a provider that is off falls back to the default', () => {
  const resolved = resolveSelection(
    settings({
      codexOn: false,
      stage_selections: { examine: { provider: 'codex', model: 'gpt-6-luna' } },
    }),
    'examine',
  )
  assert.deepEqual(resolved, {
    provider: 'claude',
    authentication: 'subscription',
    model: 'sonnet',
  })
})

test('nothing resolves when the default provider is off or missing', () => {
  assert.equal(resolveSelection(settings({ claudeOn: false }), 'research'), undefined)
  assert.equal(
    resolveSelection(
      settings({ claudeOn: false, codexOn: false, default_provider: null }),
      'images',
    ),
    undefined,
  )
})

test('steps without their own choice, such as the older reading stage, use the default', () => {
  const resolved = resolveSelection(settings({ default_provider: 'codex' }), 'reading')
  assert.deepEqual(resolved, {
    provider: 'codex',
    authentication: 'api_key',
    model: 'gpt-6.1-sol',
  })
})
