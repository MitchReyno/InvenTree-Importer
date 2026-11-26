import { describe, expect, test } from 'vitest'
import { agentSettings } from '#/test/agent-settings'
import { fieldValue, sameField, withFields, withUsableProviders } from './settings-fields'

const claude = { provider: 'claude', authentication: 'subscription', model: 'opus' } as const

function fields(revision: string, overrides = {}) {
  const { revision: _revision, ...settings } = agentSettings(revision, claude, overrides)
  return settings
}

describe('withFields', () => {
  test('copies only the named fields, leaving the others and the source untouched', () => {
    const confirmed = fields('3', { session_concurrency: 3, auto_tags_default: false })
    const draft = fields('3', {
      session_concurrency: 6,
      auto_tags_default: true,
      new_batch_instructions: 'half-typed',
      web: { public_pages: false, prefer_datasheets: false },
    })
    const sent = withFields(confirmed, draft, ['session_concurrency', 'web.public_pages'])
    expect(sent.session_concurrency).toBe(6)
    expect(sent.web).toEqual({ public_pages: false, prefer_datasheets: true })
    expect(sent.auto_tags_default).toBe(false)
    expect(sent.new_batch_instructions).toBe('')
    expect(confirmed.web.public_pages).toBe(true)
  })

  test('copies one step’s instructions, or removes them, leaving the other steps’', () => {
    const confirmed = fields('3', {
      stage_instructions: { research: 'Datasheet first.', images: 'Keep the bag.' },
    })
    const draft = fields('3', { stage_instructions: { examine: 'Count reels.' } })
    const sent = withFields(confirmed, draft, [
      'stage_instructions.examine',
      'stage_instructions.research',
    ])
    expect(sent.stage_instructions).toEqual({ examine: 'Count reels.', images: 'Keep the bag.' })
    expect('research' in sent.stage_instructions).toBe(false)
    expect(fieldValue(sent, 'stage_instructions.images')).toBe('Keep the bag.')
    expect(sameField(sent, confirmed, 'stage_instructions.images')).toBe(true)
    expect(confirmed.stage_instructions.research).toBe('Datasheet first.')
  })

  test('copies one provider field and one step, including a step back on Default', () => {
    const confirmed = fields('3', {
      stage_selections: { research: { provider: 'claude', model: 'opus' } },
    })
    const draft = withFields(confirmed, confirmed, [])
    draft.providers.codex = { enabled: true, authentication: 'api_key', default_model: 'typed' }
    draft.stage_selections = { images: { provider: 'codex', model: 'gpt-6.1-sol' } }
    const sent = withFields(confirmed, draft, [
      'providers.codex.enabled',
      'stage_selections.research',
      'stage_selections.images',
    ])
    expect(sent.providers.codex).toEqual({
      ...confirmed.providers.codex,
      enabled: true,
    })
    expect(sent.stage_selections).toEqual({ images: { provider: 'codex', model: 'gpt-6.1-sol' } })
    expect(fieldValue(sent, 'stage_selections.research')).toBeUndefined()
    expect(sameField(sent, draft, 'providers.codex.default_model')).toBe(false)
  })
})

describe('withUsableProviders', () => {
  test('resets steps naming a provider that is off and moves the default to one that is on', () => {
    const settings = fields('3', {
      providers: {
        claude: { enabled: false, authentication: 'subscription', default_model: 'opus' },
        codex: { enabled: true, authentication: 'api_key', default_model: 'gpt-6.1-sol' },
      },
      default_provider: 'claude',
      stage_selections: {
        research: { provider: 'claude', model: 'opus' },
        images: { provider: 'codex', model: 'gpt-6-luna' },
      },
    })
    const usable = withUsableProviders(settings)
    expect(usable.reset).toEqual(['research'])
    expect(usable.settings.default_provider).toBe('codex')
    expect(usable.settings.stage_selections).toEqual({
      images: { provider: 'codex', model: 'gpt-6-luna' },
    })
  })

  test('with no provider on there is no default and no step choice', () => {
    const { revision: _revision, ...none } = agentSettings('0', null, {
      stage_selections: { examine: { provider: 'codex', model: 'gpt-6.1-sol' } },
    })
    const usable = withUsableProviders(none)
    expect(usable.settings.default_provider).toBeNull()
    expect(usable.settings.stage_selections).toEqual({})
    expect(usable.reset).toEqual(['examine'])
  })
})
