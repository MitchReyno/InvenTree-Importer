import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { PassThrough } from 'node:stream'
import { Frames, evidenceReplyLimit } from '#/agents/shared-vm/frames.ts'
import { evidenceRequest } from '#/agents/shared-vm/evidence-request.ts'
import { AgentChild } from '#/agents/child.ts'
import { stageEvidence, evidenceDelivery } from '#/agents/shared-vm/stage-evidence.ts'

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
  const staged = JSON.parse(
    await stageEvidence(1, String(message.body), async () => dir, 'inline', 'current'),
  ).result
  const { local_file } = staged.structuredContent
  assert.deepEqual(staged.content[1], result.content[0])
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
  await assert.rejects(stageEvidence(1, otherCall, unused), /invalid_evidence_file/)
  const refusal = JSON.stringify({ id: 2, result: { isError: true } })
  assert.equal(await stageEvidence(2, refusal, unused), refusal)
  // No description of the delivered image, or one whose digest the bytes don't match.
  await assert.rejects(
    stageEvidence(2, reply({}), unused, 'file', 'current'),
    /invalid_evidence_file/,
  )
  await assert.rejects(
    stageEvidence(
      2,
      reply({ delivered: { ...delivered, sha256: '1'.repeat(64) } }),
      unused,
      'file',
      'current',
    ),
    /invalid_evidence_file/,
  )
  const dir = await mkdtemp(join(tmpdir(), 'bench-crop-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const staged = JSON.parse(
    await stageEvidence(2, reply({ delivered }), async () => dir, undefined, 'current'),
  ).result.structuredContent
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
  const whole = JSON.parse(
    await stageEvidence(3, reply({ source: original }), at, undefined, 'legacy'),
  ).result
  assert.equal(whole.structuredContent.local_file.sha256, original.sha256)
  // A preview cut with page sizes, which carried no digest of its own.
  const other = { kind: 'media_version', sha256: '0'.repeat(64) }
  const crop = JSON.parse(
    await stageEvidence(
      3,
      reply({ source: other, pages: [{ page: 1, width: 1, height: 1 }] }),
      at,
      undefined,
      'legacy',
    ),
  ).result
  assert.deepEqual(crop.structuredContent.source, other)
  for (const format of ['current', undefined, 'unknown']) {
    await assert.rejects(
      stageEvidence(3, reply({ source: other, pages: [] }), at, 'file', format),
      /invalid_evidence_/,
    )
  }
  // An older host's original without a digest is still refused.
  await assert.rejects(
    stageEvidence(3, reply({ source: { kind: 'media_version' } }), at, undefined, 'legacy'),
    /invalid_evidence_file/,
  )
})

test('file delivery keeps repeated large images out of the bounded provider transport', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bench-file-evidence-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const bytes = Buffer.alloc(396095, 19)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const source = { kind: 'media_version', evidence_id: 'e1', version_id: 'v1', sha256 }
  const body = JSON.stringify({
    id: 4,
    result: {
      structuredContent: { ok: true, source },
      content: [{ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') }],
    },
  })
  assert.ok(Buffer.byteLength(body) > 256 * 1024)
  const replies = []
  for (let i = 0; i < 3; i++) {
    const reply = await stageEvidence(4, body, async () => dir, 'file', 'legacy')
    const result = JSON.parse(reply).result
    assert.deepEqual(result.structuredContent.source, source)
    assert.deepEqual(await readFile(result.structuredContent.local_file.path), bytes)
    assert.equal((await stat(result.structuredContent.local_file.path)).mode & 0o777, 0o600)
    assert.ok(result.content.every((item: { type: string }) => item.type === 'text'))
    assert.match(result.content[1].text, /image.*tool/)
    assert.match(result.content[1].text, /fetch.*again/i)
    assert.ok(!reply.includes(bytes.toString('base64')))
    assert.ok(Buffer.byteLength(reply) < 8192)
    replies.push({ method: 'item/completed', params: { result } })
  }
  const input = join(dir, 'replies.json')
  await writeFile(input, JSON.stringify(replies))
  const child = new AgentChild(
    process.execPath,
    [
      '-e',
      "for (const frame of JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))) process.stdout.write(JSON.stringify(frame)+'\\n')",
      input,
    ],
    dir,
    { PATH: process.env.PATH },
    new AbortController().signal,
  )
  try {
    for (const reply of replies) {
      assert.deepEqual(await child.next(), reply)
    }
    assert.equal(await child.next(), undefined)
  } finally {
    await child.close()
  }
})

test('file delivery preserves refusals and refuses failed writes', async () => {
  const unused = async () => {
    throw new Error('write_failed')
  }
  for (const result of [{ isError: true }, { structuredContent: { ok: true }, content: [] }]) {
    const body = JSON.stringify({ id: 1, result })
    assert.equal(await stageEvidence(1, body, unused, 'file'), body)
  }
  const bytes = Buffer.from('file')
  const body = JSON.stringify({
    id: 1,
    result: {
      structuredContent: {
        ok: true,
        source: {
          kind: 'media_version',
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      },
      content: [{ type: 'image', mimeType: 'image/png', data: bytes.toString('base64') }],
    },
  })
  await assert.rejects(stageEvidence(1, body, unused, 'file', 'legacy'), /write_failed/)
  await assert.rejects(
    stageEvidence(
      1,
      body.replace(createHash('sha256').update(bytes).digest('hex'), '0'.repeat(64)),
      unused,
      'file',
      'legacy',
    ),
    /invalid_evidence_file/,
  )
})

test('guest evidence delivery accepts only its documented modes', () => {
  for (const value of [undefined, '', 'file']) {
    assert.equal(evidenceDelivery(value), 'file')
  }
  assert.equal(evidenceDelivery('inline'), 'inline')
  for (const value of ['File', 'false', ' typo ']) {
    assert.throws(() => evidenceDelivery(value), /^Error: invalid_evidence_delivery$/)
  }
})
