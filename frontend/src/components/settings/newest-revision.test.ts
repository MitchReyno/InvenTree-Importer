import { expect, test } from 'vitest'
import { newestRevision } from './newest-revision'

const at = (revision: string) => ({ revision })

test('a late answer gives way to the newest known settings, whichever holds them', () => {
  const late = at('7')
  const localSave = at('8')
  const cached = at('9')
  expect(newestRevision(late, localSave, cached)).toBe(cached)
  expect(newestRevision(late, cached, localSave)).toBe(cached)
  expect(newestRevision(late, localSave, undefined)).toBe(localSave)
})

test('a newer answer is adopted, and an equal one keeps the answer', () => {
  const answer = at('10')
  expect(newestRevision(answer, at('9'), undefined)).toBe(answer)
  expect(newestRevision(answer, at('10'))).toBe(answer)
})

test('revisions compare as numbers, past the safe integer range', () => {
  expect(newestRevision(at('9'), at('10')).revision).toBe('10')
  expect(newestRevision(at('9007199254740993'), at('9007199254740992')).revision).toBe(
    '9007199254740993',
  )
})
