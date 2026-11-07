import { test } from 'node:test'
import assert from 'node:assert/strict'
import { strictJson } from '../src/json.ts'
import { validate, LIVE_PROTOCOL } from '../src/index.ts'

const stream = '10000000-0000-4000-8000-000000000001'
test('live schemas preserve exact cursors and reject command payloads, overflow and extra data', () => {
  const subscription = {
    type: 'subscribe',
    protocol: LIVE_PROTOCOL,
    csrf_token: 'a'.repeat(64),
    batch_id: null,
    cursors: [{ stream_id: stream, sequence: '9007199254740993' }],
  }
  validate('LiveSubscribe', subscription)
  validate('LiveFrame', {
    type: 'changed',
    protocol: LIVE_PROTOCOL,
    batch_id: stream,
    stream_id: stream,
    sequence: '9007199254740993',
    reset: true,
  })
  for (const invalid of [
    { ...subscription, protocol: 'bench-intake-live/0' },
    { ...subscription, command: { action: 'cancel' } },
    { ...subscription, cursors: [{ stream_id: stream, sequence: 9007199254740992 }] },
    { ...subscription, cursors: [{ stream_id: stream, sequence: '9223372036854775808' }] },
    { ...subscription, cursors: Array.from({ length: 101 }, () => subscription.cursors[0]) },
    { ...subscription, csrf_token: 'invalid' },
  ])
    assert.throws(() => validate('LiveSubscribe', invalid))
  assert.throws(() =>
    validate('LiveFrame', {
      type: 'changed',
      protocol: LIVE_PROTOCOL,
      batch_id: stream,
      stream_id: stream,
      sequence: '1',
      reset: false,
      private_bytes: 'hidden',
    }),
  )
})

test('strict JSON limits UTF-8 bytes consistently for non-ASCII browser input', () => {
  assert.equal(strictJson(JSON.stringify('é'.repeat(100))), 'é'.repeat(100))
  assert.throws(() => strictJson(JSON.stringify('é'.repeat(131072))), /json_too_large/)
})

test('explicit larger JSON budgets keep the default HTTP limit and every structural refusal', () => {
  const large = JSON.stringify('x'.repeat(300000))
  assert.throws(() => strictJson(large), /json_too_large/)
  assert.equal(strictJson(large, 2 * 1024 * 1024), 'x'.repeat(300000))
  assert.throws(() => strictJson('{"same":1,"same":2}', 2 * 1024 * 1024), /duplicate_json_key/)
  assert.throws(() => strictJson('{"id":9007199254740993}', 2 * 1024 * 1024), /unsafe_json_number/)
  assert.throws(() => strictJson('{}', 3 * 1024 * 1024), /invalid_json_limit/)
})
