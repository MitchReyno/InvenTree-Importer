import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { canonical } from '@invimport/contracts/json'
import { sha256 } from '#/db/authority.ts'
import {
  CAPABILITY,
  EXECUTOR_BUILD,
  decodePlan,
  encodePlan,
  stockBytes,
  type StockPlan,
} from '#/execution/plan.ts'

test('stock plan is exact retained original-source authority, never raw URLs/new Part/general payloads or rounded decimals', () => {
  const original = '10000000-0000-4000-8000-000000000011',
    contribution = '20000000-0000-4000-8000-000000000022'
  const plan: StockPlan = {
    version: 'bench-stock-plan/1',
    deploymentId: randomUUID(),
    targetId: randomUUID(),
    contextId: randomUUID(),
    epoch: randomUUID(),
    build: EXECUTOR_BUILD,
    capability: CAPABILITY,
    continuity: 'fake-instance',
    sourceId: randomUUID(),
    originalSourceKey: original,
    operations: [
      {
        operationKey: randomUUID(),
        contributionKey: contribution,
        part: '29',
        location: '43',
        quantity: '1.000001',
        barcode: 'bi1:10000000-0000-4000-8000-000000000011:20000000-0000-4000-8000-000000000022',
      },
    ],
  }
  assert.equal(
    stockBytes(plan.operations[0]).toString(),
    '{"barcode":"bi1:10000000-0000-4000-8000-000000000011:20000000-0000-4000-8000-000000000022","location":"43","part":"29","quantity":"1.000001"}',
  )
  for (const quantity of ['0.000001', '9999999999999.999999', '1', '3.125']) {
    const { bytes, digest } = encodePlan({
      ...plan,
      operations: [{ ...plan.operations[0], quantity }],
    })
    assert.equal(decodePlan(bytes, digest).operations[0].quantity, quantity)
  }
  for (const quantity of ['0', '-1', '1.0', '1e3', '1.0000001', '10000000000000', ' 2', '1\n', 2]) {
    const bytes = Buffer.from(
      JSON.stringify({ ...plan, operations: [{ ...plan.operations[0], quantity }] }),
    )
    assert.throws(() => decodePlan(bytes, sha256(bytes)))
  }
  for (const changes of [
    { build: 'new-build' },
    { capability: 'inventree-api-530' },
    { origin: 'http://browser.invalid' },
    { originalSourceKey: randomUUID() },
    { operations: [...plan.operations, ...plan.operations] },
  ]) {
    const bytes = Buffer.from(canonical({ ...plan, ...changes }))
    assert.throws(() => decodePlan(bytes, sha256(bytes)))
  }
  const { bytes, digest } = encodePlan(plan)
  const damaged = Buffer.from(bytes)
  damaged[0] = 0
  assert.throws(() => decodePlan(damaged, digest), /retained_bytes_corrupt/)
  assert.deepEqual(decodePlan(bytes, digest), plan)
})
