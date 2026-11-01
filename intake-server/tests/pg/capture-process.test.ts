import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { captureProcess } from '../support/capture-process.ts'

test('actual capture web process restart retains two same-Part lots and rotates command token', async () => {
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening')
  const address = reservation.address(); assert.ok(address && typeof address !== 'string')
  const port = address.port; reservation.close(); await once(reservation, 'close')
  const h = await captureProcess(port)
  try {
    let token = (await h.start()).csrf_token
    const post = async (path: string, input: unknown) => {
      const response = await fetch(h.origin + '/api/v1' + path, { method: 'POST', headers: { origin: h.origin, 'x-intake-csrf': token, 'idempotency-key': randomUUID(), 'content-type': 'application/json' }, body: JSON.stringify(input) })
      assert.ok(response.ok, String(response.status)); return response.json()
    }
    let b = await post('/batches', { title: 'Process retained packets', note: 'Two physical packets' })
    const batchId = b.id
    const edit = async (change: unknown) => { b = await post(`/batches/${batchId}/edits`, { expected_revision: b.revision, change }) }
    await edit({ kind: 'add_part', label: 'Shared Part' })
    const partId = b.parts[0].id
    for (const label of ['A', 'B']) await edit({ kind: 'add_lot', label, note: label, part_subject_id: partId })
    const observation = await post(`/batches/${batchId}/observations`, { model: 'part', pk: '93' })
    await edit({ kind: 'part', id: partId, choice: { mode: 'set', value: { observation_id: observation.id, model: 'part', pk: '93', target_context_id: h.identity.context } } })
    const before = structuredClone(b)
    const oldToken = token
    await h.stop(); token = (await h.start()).csrf_token
    assert.notEqual(token, oldToken)
    const saved = await (await fetch(h.origin + '/api/v1/batches/' + batchId)).json()
    assert.deepEqual(saved, before)
    assert.equal(saved.lots.length, 2); assert.notEqual(saved.lots[0].contribution_key, saved.lots[1].contribution_key)
    assert.deepEqual(h.requests, [{ method: 'GET', path: '/api/part/93/' }])
    const denied = await fetch(h.origin + '/api/v1/batches/' + batchId + '/edits', { method: 'POST', headers: { origin: h.origin, 'x-intake-csrf': oldToken, 'idempotency-key': randomUUID(), 'content-type': 'application/json' }, body: JSON.stringify({ expected_revision: b.revision, change: { kind: 'batch', title: 'stale token' } }) })
    assert.equal(denied.status, 403)
  } finally { await h.dispose() }
})
