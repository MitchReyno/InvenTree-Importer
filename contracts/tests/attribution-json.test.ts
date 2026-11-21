import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strictJson, attributionJson, canonical } from '../src/json.ts'

test('evidence parser shares structural guards while strict scalar and canonical authority remain unchanged', () => {
  const input = '[{"pk":"9007199254740993"},{"pk":9007199254740993},{"invalid":1e999},{"pk":17}]'
  assert.throws(() => strictJson(input), /unsafe_json_number/)
  const evidence = attributionJson(input)
  assert.ok(Array.isArray(evidence))
  assert.equal(evidence[0].pk, '9007199254740993')
  assert.equal(evidence[3].pk, 17)
  assert.throws(() => canonical(evidence), /exact_string_scalars/)
  for (const malformed of [
    '{"pk":"17","p\\u006b":"18"}',
    '{"constructor":{}}',
    '[1,]',
    '/*comment*/ {}',
    '{"pk":',
  ]) {
    assert.throws(() => attributionJson(malformed))
    assert.throws(() => strictJson(malformed))
  }
  assert.deepEqual(attributionJson('{"pk":"17"}'), strictJson('{"pk":"17"}'))
  assert.throws(() => attributionJson('['.repeat(65) + '0' + ']'.repeat(65)), /json_depth_exceeded/)
  assert.throws(() => attributionJson(' '.repeat(262145)), /json_too_large/)
})
