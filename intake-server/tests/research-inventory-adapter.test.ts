import { test } from 'node:test'
import assert from 'node:assert/strict'
import { researchInventoryReadAdapter } from '../src/research/inventory.ts'
import type { ReadOperation } from '../src/inventory/transport.ts'

test('widened catalogue operations cannot reach the unchanged research transport', async () => {
  const calls: unknown[] = []
  const read = researchInventoryReadAdapter(async (operation) => {
    calls.push(operation)
    return new Response('{}')
  })
  for (const kind of [
    'get_tagged_part',
    'get_company',
    'get_category',
    'get_parameter_template',
    'get_category_parameter',
    'get_stock',
  ] as const) {
    const operation: ReadOperation = { kind, pk: '9007199254740993' }
    assert.throws(() => read(operation))
  }
  assert.deepEqual(calls, [])
  await read({ kind: 'get_part', pk: '9007199254740993' })
  await read({ kind: 'get_location', pk: '104' })
  assert.deepEqual(calls, [
    { kind: 'get_part', pk: '9007199254740993' },
    { kind: 'get_location', pk: '104' },
  ])
})
