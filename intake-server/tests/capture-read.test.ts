import { test } from 'node:test'
import assert from 'node:assert/strict'
import { captureRead } from '#/capture/read.ts'

test('capture read accepts only exact identity and bounded complete data; no absence from failed reads', async () => {
  const operations: unknown[] = []
  const read = captureRead(async (op) => {
    operations.push(op)
    return new Response('{"pk":"9007199254740993","name":"100 Ω"}')
  })
  assert.deepEqual(await read({ model: 'part', pk: '9007199254740993' }), { label: '100 Ω' })
  assert.deepEqual(operations, [{ kind: 'get_part', pk: '9007199254740993' }])
  for (const [body, status] of [
    ['{"pk":1,"name":"wrong identity"}', 200],
    ['{"pk":9007199254740993,"name":"unsafe"}', 200],
    ['{"pk":"93","pk":"93","name":"duplicate"}', 200],
    ['x'.repeat(65537), 200],
    ['{"detail":"not authorized"}', 403],
    ['{}', 404],
  ] as const) {
    await assert.rejects(
      captureRead(async () => new Response(body, { status }))({ model: 'part', pk: '93' }),
      /inventory_read_unavailable/,
    )
  }
  assert.deepEqual(
    await captureRead(async () => new Response('{"pk":104,"name":"Drawer 4"}'))({
      model: 'location',
      pk: '104',
    }),
    { label: 'Drawer 4' },
  )
})
