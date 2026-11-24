import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { evidenceRequest } from '#/agents/shared-vm/evidence-request.ts'
import { stagePreview } from '#/agents/shared-vm/stage-evidence.ts'
import { startMcpProxy } from '#/agents/shared-vm/mcp-proxy.ts'

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** A trusted `ask` preview reply with the given images, listed as the tool server lists them. */
function previewReply(id: number, images: Buffer[], listed = images.map((bytes) => sha(bytes))) {
  const preview = listed.map((digest, index) => ({
    figure: index + 1,
    width: 4,
    height: 3,
    media_type: 'image/jpeg',
    sha256: digest,
  }))
  const structured = { ok: true, pending_inbox: 0, preview }
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: {
      content: [
        { type: 'text', text: JSON.stringify(structured) },
        ...images.map((bytes) => ({
          type: 'image',
          mimeType: 'image/jpeg',
          data: bytes.toString('base64'),
        })),
      ],
      structuredContent: structured,
      isError: false,
    },
  })
}

const images = (count: number) =>
  Array.from({ length: count }, (_, n) => Buffer.from(`preview-${n}-${'x'.repeat(n * 7)}`))

test('only an ask with preview: true is a preview request', () => {
  const call = (name: string, args: unknown) =>
    JSON.stringify({
      jsonrpc: '2.0',
      id: 'p-9',
      method: 'tools/call',
      params: { name, arguments: args },
    })
  assert.deepEqual(evidenceRequest(call('ask', { preview: true })), { id: 'p-9', kind: 'preview' })
  assert.equal(evidenceRequest(call('ask', { preview: 'true' })), undefined)
  assert.equal(evidenceRequest(call('ask', {})), undefined)
  assert.deepEqual(evidenceRequest(call('fetch_evidence', {})), { id: 'p-9', kind: 'fetch' })
})

test('a staged preview must match the trusted listing, at most five images, with no source', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'bench-preview-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const directory = async () => dir

  const five = images(5)
  const staged = JSON.parse(await stagePreview(3, previewReply(3, five), directory, 'file')).result
  assert.deepEqual(
    staged.structuredContent.local_files.map((file: { figure: number; sha256: string }) => [
      file.figure,
      file.sha256,
    ]),
    five.map((bytes, index) => [index + 1, sha(bytes)]),
  )
  assert.equal(staged.content.length, 2, 'file delivery sends metadata and guidance only')

  const refusals: [string, string][] = [
    ['six images', previewReply(4, images(6))],
    [
      'a swapped digest',
      previewReply(4, images(2), [sha(Buffer.from('other')), sha(images(2)[1]!)]),
    ],
    ['a missing listing', previewReply(4, images(2), [sha(images(2)[0]!)])],
    ['another call', previewReply(5, images(1))],
  ]
  const before = (await readdir(dir)).length
  for (const [name, body] of refusals) {
    await assert.rejects(stagePreview(4, body, directory, 'inline'), /invalid_preview_file/, name)
  }
  const withSource = JSON.parse(previewReply(4, images(1)))
  withSource.result.structuredContent.source = { kind: 'media_version', version_id: 'v' }
  await assert.rejects(
    stagePreview(4, JSON.stringify(withSource), directory, 'inline'),
    /invalid_preview_file/,
  )
  assert.equal((await readdir(dir)).length, before, 'a refusal stages no file before the bad image')
})

test('the guest proxy refuses a preview reply that carries a release receipt', async () => {
  const mcp = JSON.stringify({
    jsonrpc: '2.0',
    id: 8,
    method: 'tools/call',
    params: { name: 'ask', arguments: { preview: true } },
  })
  const requests: Record<string, unknown>[] = []
  const proxy = await startMcpProxy(
    async (message) => {
      requests.push(message)
      return { status: 200, body: previewReply(8, images(1)), releaseId: 'not-for-previews' }
    },
    true,
    'inline',
  )
  try {
    const response = await fetch(proxy.toolUrl, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + proxy.capability },
      body: mcp,
    })
    assert.equal(response.status, 502)
    assert.equal(requests.length, 1)
  } finally {
    await proxy.close()
  }
})
