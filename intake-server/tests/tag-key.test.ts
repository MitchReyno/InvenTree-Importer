import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tagKey } from '@invimport/contracts'
import { approvedTagNamesValid } from '../src/inventory/tags.ts'

test('the shared Review tag key matches the inventory adapter duplicate policy', () => {
  const pairs: [string, string][] = [
    ['SMD', 'smd'],
    ['Bench A', 'bench a'],
    ['É', 'é'],
    ['Résistance', 'résistance'],
    ['0603', '0603'],
    ['reel', 'reels'],
  ]
  for (const [a, b] of pairs) {
    assert.equal(approvedTagNamesValid([a, b]), tagKey(a) !== tagKey(b), `${a} / ${b}`)
  }
})
