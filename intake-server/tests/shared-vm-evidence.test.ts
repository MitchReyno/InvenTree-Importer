import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { Frames, evidenceReplyLimit } from '#/agents/shared-vm/frames.ts'
import { evidenceRequest } from '#/agents/shared-vm/evidence-request.ts'
import { stageEvidence } from '#/agents/shared-vm/stage-evidence.ts'

test('only fetch_evidence negotiates a larger reply and preserves an 8 MiB original', async (t) => {
  const call = { jsonrpc: '2.0', method: 'tools/call', params: { name: 'fetch_evidence' }, id: 1 }
  assert.deepEqual(evidenceRequest(JSON.stringify(call)), { id: 1 })
  assert.equal(
    evidenceRequest(JSON.stringify({ ...call, params: { name: 'read_batch' } })),
    undefined,
  )
  const bytes = Buffer.alloc(8 * 1024 * 1024, 17)
  const source = {
    kind: 'media_version',
    version_id: 'v1',
    evidence_id: 'e1',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  const result = {
    structuredContent: { ok: true, source },
    content: [{ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') }],
  }
  const body = JSON.stringify({ id: 1, result })
  const wire = new PassThrough()
  const frames = new Frames(wire)
  await assert.rejects(frames.send({ body }), /runner_frame_limit/)
  const [message] = await Promise.all([
    frames.read(evidenceReplyLimit),
    frames.send({ body }, evidenceReplyLimit),
  ])
  const dir = await mkdtemp(join(tmpdir(), 'bench-evidence-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const staged = JSON.parse(await stageEvidence(1, String(message.body), async () => dir)).result
  const { local_file } = staged.structuredContent
  assert.deepEqual(staged.structuredContent.source, source)
  assert.deepEqual(JSON.parse(staged.content[0].text), staged.structuredContent)
  assert.deepEqual(await readFile(local_file.path), bytes)
  assert.equal((await stat(local_file.path)).mode & 0o777, 0o600)
})

test('refusals create no file and crops keep their distinct original citation', async (t) => {
  const source = { kind: 'media_version', sha256: '0'.repeat(64) }
  const result = {
    structuredContent: { ok: true, source },
    content: [{ type: 'image', mimeType: 'image/png', data: 'YQ==' }],
  }
  const reply = JSON.stringify({ id: 2, result })
  const unused = async () => {
    throw Error('unexpected write')
  }
  assert.equal(await stageEvidence(1, reply, unused), reply)
  const refusal = JSON.stringify({ id: 2, result: { isError: true } })
  assert.equal(await stageEvidence(2, refusal, unused), refusal)
  await assert.rejects(stageEvidence(2, reply, unused), /invalid_evidence_file/)
  const dir = await mkdtemp(join(tmpdir(), 'bench-crop-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const crop = JSON.stringify({
    id: 2,
    result: { ...result, structuredContent: { ...result.structuredContent, pages: [{ page: 1 }] } },
  })
  const staged = JSON.parse(await stageEvidence(2, crop, async () => dir)).result.structuredContent
  assert.deepEqual(staged.source, source)
  assert.notEqual(staged.local_file.sha256, source.sha256)
})
