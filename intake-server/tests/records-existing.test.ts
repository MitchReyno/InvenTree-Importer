import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MAX_EXISTING_RECORDS, validate, type BatchRecordDto } from '@invimport/contracts'
import { existingValuesReader } from '../src/records/existing.ts'
import type { ReadOperation } from '../src/inventory/transport.ts'

const context = '00000000-0000-4000-8000-0000000000c1'
const mappedRecord = (key: string, model: string, pk: string) =>
  ({ key, mapped: { model, pk } }) as unknown as BatchRecordDto

function target(rows: Record<string, { status: number; body?: unknown }>) {
  const reads: ReadOperation[] = []
  return {
    reads,
    target: {
      targetContextId: context,
      read: async (operation: ReadOperation) => {
        reads.push(operation)
        const row = rows[`${operation.kind}:${operation.pk}`] ?? { status: 404 }
        return new Response(row.body === undefined ? null : JSON.stringify(row.body), {
          status: row.status,
          headers: { 'content-type': 'application/json' },
        })
      },
    },
  }
}

test('reads each mapped record’s current values, and says which could not be read', async () => {
  const { target: fake, reads } = target({
    'get_part:12': { status: 200, body: { pk: 12, name: 'RES 1k 0603', description: '' } },
    'get_company:7': { status: 200, body: { pk: 7, name: 'Yageo', description: 'Resistors' } },
    'get_parameter_template:3': { status: 200, body: { pk: 3, name: 'Resistance', units: 'Ω' } },
    'get_location:5': { status: 200, body: { pk: 5, name: 'Bin 4', pathstring: 'Shelf/Bin 4' } },
    'get_category:9': { status: 500 },
    'get_category:10': { status: 200, body: { pk: 11, name: 'Wrong record' } },
  })
  const read = existingValuesReader(fake)
  const result = await read([
    mappedRecord('part:a', 'part', '12'),
    mappedRecord('company:manufacturer:7', 'company', '7'),
    mappedRecord('parameter_template:3', 'parameter_template', '3'),
    mappedRecord('location:5', 'location', '5'),
    mappedRecord('category:9', 'category', '9'),
    mappedRecord('category:10', 'category', '10'),
    mappedRecord('category:404', 'category', '404'),
    { key: 'tag:SMD' } as BatchRecordDto,
  ])
  validate('RecordExistingValues', result)
  assert.equal(result.target_context_id, context)
  assert.equal(result.truncated, false)
  assert.deepEqual(result.records, [
    {
      key: 'part:a',
      status: 'found',
      fields: [
        { name: 'name', value: 'RES 1k 0603' },
        { name: 'description', value: null },
      ],
    },
    {
      key: 'company:manufacturer:7',
      status: 'found',
      fields: [
        { name: 'name', value: 'Yageo' },
        { name: 'description', value: 'Resistors' },
      ],
    },
    {
      key: 'parameter_template:3',
      status: 'found',
      fields: [
        { name: 'name', value: 'Resistance' },
        { name: 'description', value: null },
        { name: 'units', value: 'Ω' },
      ],
    },
    {
      key: 'location:5',
      status: 'found',
      fields: [
        { name: 'name', value: 'Bin 4' },
        { name: 'description', value: null },
        { name: 'path', value: 'Shelf/Bin 4' },
      ],
    },
    { key: 'category:9', status: 'unavailable' },
    { key: 'category:10', status: 'unavailable' },
    { key: 'category:404', status: 'not_found' },
  ])
  assert.equal(reads.length, 7)
})

test('reads at most the request limit and says the rest were left', async () => {
  const { target: fake, reads } = target({})
  const records = Array.from({ length: MAX_EXISTING_RECORDS + 3 }, (_, n) =>
    mappedRecord(`category:${n + 1}`, 'category', String(n + 1)),
  )
  const result = await existingValuesReader(fake)(records)
  assert.equal(result.records.length, MAX_EXISTING_RECORDS)
  assert.equal(result.truncated, true)
  assert.equal(reads.length, MAX_EXISTING_RECORDS)
})
