import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:tls'
import { pairedCertificates } from './support/vm-pairing.ts'
import { freePort } from './support/manual-process.ts'
import { evidenceRequest } from '#/agents/shared-vm/evidence-request.ts'
import { evidenceFormatHeader } from '#/agents/shared-vm/evidence-release.ts'
import { stageToolImage } from '#/agents/shared-vm/stage-evidence.ts'
import { startMcpProxy } from '#/agents/shared-vm/mcp-proxy.ts'
import { evidenceReplyLimit, Frames, protocol } from '#/agents/shared-vm/frames.ts'
import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'
import { pairing } from '#/agents/shared-vm/pair.ts'
import type { SessionTurn } from '#/agents/session/session-adapters.ts'
import type { SessionDriverContext } from '#/agents/session/session-runner.ts'

const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

interface ToolImage {
  bytes: Buffer
  mediaType: string
}

/**
 * A trusted reply of an image tool: its result fields, the one image it describes in `images`,
 * and that image as the MCP image item after the text item.
 */
function toolImageReply(
  id: number | string,
  fields: Record<string, unknown>,
  image: ToolImage,
  listed: Record<string, unknown>[] = [
    { width: 640, height: 480, media_type: image.mediaType, sha256: sha(image.bytes), scale: 1 },
  ],
) {
  const structured = { ok: true, images: listed, ...fields }
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    result: {
      content: [
        { type: 'text', text: JSON.stringify(structured) },
        { type: 'image', mimeType: image.mediaType, data: image.bytes.toString('base64') },
      ],
      structuredContent: structured,
      isError: false,
    },
  })
}

function toolCall(id: number | string, name: string, args: Record<string, unknown> = {}) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: args },
  })
}

const grid = { bytes: Buffer.from('grid-png-bytes'), mediaType: 'image/png' }
const gridFields = {
  grid: { region: { x: 0, y: 0, width: 640, height: 480 }, scale: 1, step: 50 },
}
const logoSheet = { bytes: Buffer.from('logo-sheet-jpeg-bytes'), mediaType: 'image/jpeg' }
const logoFields = { candidates: [{ manufacturer: 'Example', score: 0.91 }] }

async function stagingDir(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'bench-tool-image-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

test('the image tools negotiate the evidence frame as their own kind; other tools do not', () => {
  for (const name of ['inspect_region', 'preview_images', 'match_logo']) {
    assert.deepEqual(evidenceRequest(toolCall('t-1', name)), { id: 't-1', kind: 'tool_image' })
  }
  assert.deepEqual(evidenceRequest(toolCall(2, 'fetch_evidence')), { id: 2, kind: 'fetch' })
  for (const name of ['read_guide', 'propose_images', 'read_batch']) {
    assert.equal(evidenceRequest(toolCall(3, name)), undefined, name)
  }
  const notification = JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: 'inspect_region' },
  })
  assert.equal(evidenceRequest(notification), undefined, 'a call without an id is not a request')
})

test('a grid and a logo sheet are staged as files in file delivery', async (t) => {
  const dir = await stagingDir(t)
  const directory = async () => dir
  for (const [id, fields, image] of [
    [1, gridFields, grid],
    [2, logoFields, logoSheet],
  ] as const) {
    const staged = JSON.parse(
      await stageToolImage(id, toolImageReply(id, fields, image), directory, 'file'),
    ).result
    const [file] = staged.structuredContent.local_files
    assert.equal(staged.structuredContent.local_files.length, 1)
    assert.equal(file.sha256, sha(image.bytes))
    assert.equal(file.media_type, image.mediaType)
    assert.equal(file.byte_length, image.bytes.length)
    assert.deepEqual(await readFile(file.path), image.bytes)
    assert.equal((await stat(file.path)).mode & 0o777, 0o600)
    // The tool's own fields and the image description reach the agent unchanged.
    for (const [key, value] of Object.entries(fields)) {
      assert.deepEqual(staged.structuredContent[key], value)
    }
    assert.equal(staged.structuredContent.images[0].sha256, sha(image.bytes))
    assert.equal(staged.structuredContent.source, undefined)
    assert.deepEqual(JSON.parse(staged.content[0].text), staged.structuredContent)
    assert.equal(staged.content.length, 2)
    assert.equal(staged.content[1].type, 'text')
    assert.match(staged.content[1].text, /local_files/)
    assert.match(staged.content[1].text, /no citation/)
  }
})

test('inline delivery keeps the image and still stages its file', async (t) => {
  const dir = await stagingDir(t)
  const body = toolImageReply(4, logoFields, logoSheet)
  const staged = JSON.parse(await stageToolImage(4, body, async () => dir, 'inline')).result
  assert.deepEqual(staged.content[1], JSON.parse(body).result.content[1])
  assert.deepEqual(await readFile(staged.structuredContent.local_files[0].path), logoSheet.bytes)
})

test('a tool image must match its listing, be alone, and grant no citation', async (t) => {
  const dir = await stagingDir(t)
  const directory = async () => dir
  const listing = {
    width: 640,
    height: 480,
    media_type: 'image/png',
    sha256: sha(grid.bytes),
    scale: 1,
  }
  const withSource = JSON.parse(toolImageReply(5, gridFields, grid))
  withSource.result.structuredContent.source = { kind: 'media_version', version_id: 'v' }
  const twoImages = JSON.parse(toolImageReply(5, gridFields, grid, [listing, listing]))
  twoImages.result.content.push(twoImages.result.content[1])
  const failed = JSON.parse(toolImageReply(5, gridFields, grid))
  failed.result.isError = true
  const refusals: [string, string][] = [
    [
      'a digest the bytes do not have',
      toolImageReply(5, gridFields, grid, [{ ...listing, sha256: sha(Buffer.from('other')) }]),
    ],
    [
      'another media type',
      toolImageReply(5, gridFields, grid, [{ ...listing, media_type: 'image/jpeg' }]),
    ],
    ['no listing', toolImageReply(5, gridFields, grid, [])],
    ['a source', JSON.stringify(withSource)],
    ['two images', JSON.stringify(twoImages)],
    ['an error result with an image', JSON.stringify(failed)],
    ['another call', toolImageReply(6, gridFields, grid)],
  ]
  for (const [name, body] of refusals) {
    await assert.rejects(
      stageToolImage(5, body, directory, 'inline'),
      /invalid_tool_image_file/,
      name,
    )
  }
  assert.deepEqual(await readdir(dir), [], 'a refusal stages no file')
})

test('a tool reply without an image is passed through', async () => {
  const unused = async () => {
    throw new Error('unexpected write')
  }
  const refusal = JSON.stringify({
    jsonrpc: '2.0',
    id: 7,
    result: {
      content: [{ type: 'text', text: '{"ok":false,"error":"image_budget_exhausted"}' }],
      structuredContent: { ok: false, error: 'image_budget_exhausted' },
      isError: true,
    },
  })
  assert.equal(await stageToolImage(7, refusal, unused, 'file'), refusal)
})

/** One guest-proxy request for `mcp`, answered by `reply`; returns the response and every relay request. */
async function proxied(mcp: string, reply: Record<string, unknown>) {
  const requests: Record<string, unknown>[] = []
  const proxy = await startMcpProxy(
    async (message) => {
      requests.push(message)
      return 'releaseId' in message ? { ok: true } : reply
    },
    true,
    'file',
  )
  try {
    const response = await fetch(proxy.toolUrl, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + proxy.capability },
      body: mcp,
    })
    const text = await response.text()
    return { status: response.status, text, requests }
  } finally {
    await proxy.close()
  }
}

test('the guest proxy stages a tool image without confirming any release', async () => {
  const { status, text, requests } = await proxied(toolCall(8, 'inspect_region'), {
    status: 200,
    body: toolImageReply(8, gridFields, grid),
  })
  assert.equal(status, 200)
  const result = JSON.parse(text).result
  assert.equal(result.structuredContent.local_files[0].sha256, sha(grid.bytes))
  assert.ok(!text.includes(grid.bytes.toString('base64')))
  assert.equal(requests.length, 1, 'no release acknowledgement follows a tool image')
})

test('the guest proxy refuses a tool image reply that carries a release receipt', async () => {
  const { status, requests } = await proxied(toolCall(9, 'match_logo'), {
    status: 200,
    body: toolImageReply(9, logoFields, logoSheet),
    releaseId: 'not-for-tool-images',
  })
  assert.equal(status, 502)
  assert.equal(requests.length, 1)
})

test("the guest proxy leaves an unrelated tool's reply untouched", async () => {
  const body = toolImageReply(10, {}, grid)
  const { status, text, requests } = await proxied(toolCall(10, 'read_guide'), {
    status: 200,
    body,
  })
  assert.equal(status, 200)
  assert.equal(text, body)
  assert.equal(requests.length, 1)
})

/** A tool-capable Claude guest's greeting, as the paired supervisor sends it. */
const CLAUDE_TOOL_GUEST = {
  ready: protocol,
  reapProof: true,
  terminalProbe: true,
  builtinTools: true,
  evidenceFiles: true,
  evidenceRelease: 1,
  turnPolicy: true,
  claudeSubscription: true,
  codexSubscription: false,
  providerStatus: true,
  modelCatalog: true,
}

test('the coordinator carries a montage over the normal frame limit and prepares no release for it', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'bench-tool-image-bridge-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await pairedCertificates(root)

  // A montage whose base64 is larger than an ordinary 4 MiB frame.
  const montage = { bytes: Buffer.alloc(3_600_000, 23), mediaType: 'image/png' }
  const montageBody = toolImageReply(11, { crops: [{ name: 'front' }] }, montage)
  assert.ok(Buffer.byteLength(montageBody) > 4 * 1024 * 1024)
  assert.ok(Buffer.byteLength(montageBody) < evidenceReplyLimit)
  const fetched = Buffer.from('fetched')
  const fetchBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 12,
    result: {
      content: [{ type: 'image', mimeType: 'image/png', data: fetched.toString('base64') }],
      structuredContent: {
        ok: true,
        source: { kind: 'media_version', version_id: 'v1', sha256: sha(fetched) },
      },
    },
  })
  const tools = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const name = JSON.parse(Buffer.concat(chunks).toString()).params.name
      if (name === 'fetch_evidence') {
        res.writeHead(200, { [evidenceFormatHeader]: 'current' }).end(fetchBody)
        return
      }
      res.writeHead(200).end(montageBody)
    })
  })
  tools.listen(0, '127.0.0.1')
  await once(tools, 'listening')
  t.after(() => tools.close())
  const address = tools.address()
  assert.ok(address && typeof address === 'object')

  const confirmed: string[] = []
  const port = await freePort()
  const bridge = await startSessionBridge(join(root, 'bench-coordinator'), port, {
    protectedHosts: [],
    confirmEvidence: (_job, version) => confirmed.push(version),
  })
  t.after(() => bridge.close())
  const socket = connect({
    ...(await pairing(join(root, 'bench-guest'))),
    port,
    host: '127.0.0.1',
    servername: 'bench-coordinator',
  })
  t.after(() => socket.destroy())
  await once(socket, 'secureConnect')
  const frames = new Frames(socket)
  await frames.send(CLAUDE_TOOL_GUEST)

  const manifest = {
    profile_id: 'shared-vm-agent/3',
    agent: { provider: 'claude', authentication: 'subscription', model: 'haiku' },
  } as unknown as SessionDriverContext['manifest']
  const turn = {
    instructions: 'i',
    text: 't',
    tools: [],
    toolUrl: 'http://127.0.0.1:' + address.port + '/mcp',
    capability: 'c',
  } as unknown as SessionTurn
  const context: SessionDriverContext = {
    identity: {
      attemptId: '00000000-0000-4000-8000-000000000001',
      turn: '1',
      lineage: '00000000-0000-4000-8000-000000000002',
    },
    manifest,
    cwd: '/unused',
    signal: AbortSignal.timeout(10_000),
    recordChild: async () => {},
  }
  const running = bridge.driver(turn, context)

  await frames.read()
  await frames.send({ mcp: toolCall(11, 'preview_images') })
  const montageReply = await frames.read(evidenceReplyLimit)
  assert.equal(montageReply.status, 200)
  assert.equal(montageReply.body, montageBody)
  assert.equal(montageReply.releaseId, undefined)
  assert.equal(montageReply.evidenceFormat, undefined)
  // A fetched image in the same turn still gets its release envelope.
  await frames.send({ mcp: toolCall(12, 'fetch_evidence') })
  const fetchReply = await frames.read(evidenceReplyLimit)
  assert.equal(typeof fetchReply.releaseId, 'string')
  await frames.send({ done: true })
  await running
  assert.deepEqual(confirmed, [])
})
