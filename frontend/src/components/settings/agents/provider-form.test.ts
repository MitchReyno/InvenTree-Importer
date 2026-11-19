import { expect, test } from 'vitest'
import { agentSettings } from '#/test/agent-settings'
import { providerFormUpdate, providerFormValues, turnOff, turnOn } from './provider-form'

const both = agentSettings(
  '4',
  { provider: 'claude', authentication: 'subscription', model: 'opus' },
  {
    providers: {
      claude: { enabled: true, authentication: 'subscription', default_model: 'opus' },
      codex: { enabled: true, authentication: 'api_key', default_model: 'gpt-6.1-sol' },
    },
    stage_selections: {
      research: { provider: 'codex', model: 'gpt-6-luna' },
      images: { provider: 'claude', model: 'sonnet' },
    },
  },
)

test('the form round-trips saved providers, the default and step choices', () => {
  const values = providerFormValues(both)
  expect(values.stages.examine).toEqual({ provider: '', model: '' })
  expect(providerFormUpdate(values)).toEqual({
    providers: both.providers,
    default_provider: 'claude',
    stage_selections: both.stage_selections,
  })
})

test('turning a provider off resets its steps and moves the default to the other provider', () => {
  const { values, reset } = turnOff(providerFormValues(both), 'codex')
  expect(reset).toEqual(['research'])
  expect(values.stages.research).toEqual({ provider: '', model: '' })
  expect(values.stages.images).toEqual({ provider: 'claude', model: 'sonnet' })
  expect(values.providers.codex.enabled).toBe(false)
  expect(turnOff(providerFormValues(both), 'claude').values.default_provider).toBe('codex')
})

test('turning the last provider off leaves no default; turning one on makes it the default', () => {
  const off = turnOff(turnOff(providerFormValues(both), 'codex').values, 'claude').values
  expect(off.default_provider).toBe('')
  expect(providerFormUpdate(off).default_provider).toBeNull()
  expect(turnOn(off, 'codex').default_provider).toBe('codex')
})
