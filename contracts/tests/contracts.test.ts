import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonical, strictJson } from '../src/json.ts'
import { validate } from '../src/index.ts'

test('strict JSON rejects duplicate escaped keys, unsafe numbers, nonfinite, trailing syntax and prototype keys', () => {
  for (const input of [
    '{"x":1,"x":2}',
    '{"x":1,"x":1}',
    '{"x":{},"x":{}}',
    '{"x":1,"\\u0078":2}',
    '{"x":1e9999}',
    '{"x":9007199254740993}',
    '{"x":NaN}',
    '{} trailing',
    '{"__proto__":{}}',
    '//comment\n{}',
    '{"x":1,}',
  ])
    assert.throws(() => strictJson(input), input)
  assert.deepEqual(strictJson('{"value":"9007199254740993"}'), { value: '9007199254740993' })
})
test('scalars preserve exactness and missing, inherited, cleared selections', () => {
  for (const value of [
    '0',
    '-1',
    '01',
    '1e2',
    '1.0000001',
    '10000000000000',
    '1.0',
    '1\n',
    '1\r\n',
    1,
    null,
  ])
    assert.throws(() =>
      validate('LotSelection', { expected_revision: '1', quantity: { mode: 'set', value } }),
    )
  for (const value of ['0.000001', '9999999999999.999999', '1', '9007199254740.123456'])
    validate('LotSelection', {
      expected_revision: '9007199254740993',
      quantity: { mode: 'set', value },
    })
  for (const quantity of [undefined, { mode: 'clear' }, { mode: 'inherit' }])
    validate('LotSelection', { expected_revision: '1', ...(quantity ? { quantity } : {}) })
  assert.throws(() => validate('Cancellation', { expected_run_revision: '9223372036854775808' }))
  assert.throws(() => validate('Cancellation', { expected_run_revision: 1 }))
  assert.throws(() => validate('BatchCreate', { title: 'manual', note: '', actor_id: 'injected' }))
  validate('BatchCreate', { title: 'manual', note: '9999999999999999999' })
})
test('canonical encoding sorts keys, preserves human text and arrays; rejects number coercion', () => {
  assert.equal(canonical({ z: 'é', a: ['2', '1'] }), '{"a":["2","1"],"z":"é"}')
  assert.throws(() => canonical({ quantity: 1 }))
  assert.notEqual(canonical({ note: 'é' }), canonical({ note: 'é' }))
})
