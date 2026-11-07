import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { manualClient } from '../generated/client.ts'
import type { ManualPreviewDto, ManualWorkspaceDto } from '../src/index.ts'

const id = '10000000-0000-4000-8000-000000000001'
const producer = '20000000-0000-4000-8000-000000000002'
const preview: ManualPreviewDto = {
  id,
  batch_id: id,
  selected_lot_ids: [id],
  remaining_lot_ids: [],
  plan_sha256: 'a'.repeat(64),
  review_fingerprint: 'b'.repeat(64),
  target_revision: '9007199254740993',
  capability: 'owned-fake-effects/1',
  effects: [
    {
      lot_id: id,
      lot_label: 'A',
      part_id: null,
      part_operation_key: producer,
      part_label: 'New shared resistor',
      quantity: '17',
      location_id: null,
      location_label: 'No location',
      contribution_key: id,
      barcode: 'bi1:literal',
    },
  ],
}

test('actual serialized manual client keeps required null identity and rejects impossible producer unions', async () => {
  let corrupt = false
  const server = createServer((_request, response) => {
    const effect = corrupt ? { ...preview.effects[0], part_id: '93' } : preview.effects[0]
    const workspace: ManualWorkspaceDto = {
      batch_id: id,
      revision: '1',
      supported: true,
      capability: 'owned-fake-effects/1',
      lots: [],
      runs: [],
      preparations: [{ ...preview, effects: [effect] }],
      preparations_truncated: false,
      cursor: { stream_id: id, sequence: '0' },
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(workspace))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  try {
    const client = manualClient(`http://127.0.0.1:${address.port}`, 'fake-csrf')
    const workspace = await client.workspace(id)
    assert.equal(workspace.preparations[0].effects[0].part_id, null)
    assert.equal(
      'part_operation_key' in workspace.preparations[0].effects[0] &&
        workspace.preparations[0].effects[0].part_operation_key,
      producer,
    )
    corrupt = true
    await assert.rejects(client.workspace(id))
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
})
