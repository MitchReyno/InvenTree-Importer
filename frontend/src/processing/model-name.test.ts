import { expect, test } from 'vitest'
import { modelName } from './model-name'

test('names a Claude model as people say it, and leaves other IDs as given', () => {
  expect(modelName('claude-opus-5-5')).toBe('Claude Opus 5.5')
  expect(modelName('claude-haiku-5-5')).toBe('Claude Haiku 5.5')
  expect(modelName('gpt-6.2-sol')).toBe('gpt-6.2-sol')
})
