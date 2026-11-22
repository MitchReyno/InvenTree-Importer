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

test('only fetch_evidence negotiates a larger reply and stages an 8 MiB delivery', async (t) => {
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
  const delivered = {
    page: 1,
    width: 2048,
    height: 1024,
    scale: 1,
    media_type: 'image/png',
    sha256: source.sha256,
  }
  const result = {
    structuredContent: { ok: true, source, delivered },
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

test('refusals create no file, and a delivery must match its own stated digest', async (t) => {
  const source = { kind: 'media_version', sha256: '0'.repeat(64) }
  const bytes = Buffer.from('a')
  const delivered = {
    page: 1,
    width: 1,
    height: 1,
    scale: 0.5,
    media_type: 'image/jpeg',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  const reply = (metadata: Record<string, unknown>, id = 2) =>
    JSON.stringify({
      id,
      result: {
        structuredContent: { ok: true, source, ...metadata },
        content: [{ type: 'image', mimeType: 'image/jpeg', data: bytes.toString('base64') }],
      },
    })
  const unused = async () => {
    throw Error('unexpected write')
  }
  const otherCall = reply({ delivered }, 2)
  assert.equal(await stageEvidence(1, otherCall, unused), otherCall)
  const refusal = JSON.stringify({ id: 2, result: { isError: true } })
  assert.equal(await stageEvidence(2, refusal, unused), refusal)
  // No description of the delivered image, or one whose digest the bytes don't match.
  await assert.rejects(stageEvidence(2, reply({}), unused), /invalid_evidence_file/)
  await assert.rejects(
    stageEvidence(2, reply({ delivered: { ...delivered, sha256: '1'.repeat(64) } }), unused),
    /invalid_evidence_file/,
  )
  const dir = await mkdtemp(join(tmpdir(), 'bench-crop-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const staged = JSON.parse(await stageEvidence(2, reply({ delivered }), async () => dir)).result
    .structuredContent
  // The scaled delivery is staged as itself and still cites the original version.
  assert.deepEqual(staged.source, source)
  assert.equal(staged.local_file.sha256, delivered.sha256)
  assert.equal(staged.local_file.media_type, 'image/jpeg')
  assert.deepEqual(await readFile(staged.local_file.path), bytes)
})

test('a guest updated before its host still stages an older host’s deliveries', async (t) => {
  const bytes = Buffer.from('a')
  const original = {
    kind: 'media_version',
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
  const reply = (metadata: Record<string, unknown>) =>
    JSON.stringify({
      id: 3,
      result: {
        structuredContent: { ok: true, ...metadata },
        content: [{ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') }],
      },
    })
  const dir = await mkdtemp(join(tmpdir(), 'bench-legacy-evidence-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const at = async () => dir
  // The original upload, checked against its source digest.
  const whole = JSON.parse(await stageEvidence(3, reply({ source: original }), at)).result
  assert.equal(whole.structuredContent.local_file.sha256, original.sha256)
  // A preview cut with page sizes, which carried no digest of its own.
  const other = { kind: 'media_version', sha256: '0'.repeat(64) }
  const crop = JSON.parse(
    await stageEvidence(3, reply({ source: other, pages: [{ page: 1, width: 1, height: 1 }] }), at),
  ).result
  assert.deepEqual(crop.structuredContent.source, other)
  // An older host's original without a digest is still refused.
  await assert.rejects(
    stageEvidence(3, reply({ source: { kind: 'media_version' } }), at),
    /invalid_evidence_file/,
  )
})
