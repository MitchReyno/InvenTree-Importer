'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { createInterface } = require('node:readline')

const threadId = `research-child-${process.pid}-${randomUUID()}`
const turnId = randomUUID()
let manifest
let versions
let current = 0
let offset = 0
let chunks = []
let pending
let receipt
let serial = 0

function write(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`)
}

function tool(name, args) {
  pending = name
  serial += 1
  write({
    id: serial,
    method: 'item/tool/call',
    params: {
      threadId,
      turnId,
      callId: `controlled-call-${serial}`,
      namespace: 'bench_intake',
      tool: name,
      arguments: args,
    },
  })
}

function readNext() {
  if (current === versions.length) {
    tool('lookup_inventory', { model: 'part', pk: '7' })
    return
  }
  const version = versions[current]
  tool('read_evidence', {
    version_id: version.versionId,
    sha256: version.digest,
    offset: String(offset),
    length: '98304',
  })
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', (line) => {
  const frame = JSON.parse(line)
  if (frame.method === 'initialize') {
    write({ id: frame.id, result: { userAgent: 'controlled-integrated-fixture' } })
  } else if (frame.method === 'thread/start') {
    write({ id: frame.id, result: { thread: { id: threadId } } })
  } else if (frame.method === 'turn/start') {
    manifest = JSON.parse(frame.params.input[0].text)
    versions = JSON.parse(manifest.media.manifest).versions
    if (
      versions.length !== 2 ||
      !versions.some((v) => v.mediaType === 'image/png') ||
      !versions.some((v) => v.mediaType === 'application/pdf')
    ) {
      process.exit(2)
    }
    write({ id: frame.id, result: { turn: { id: turnId } } })
    readNext()
  } else if ('result' in frame && pending === 'read_evidence') {
    const result = JSON.parse(frame.result.contentItems[0].text)
    const version = versions[current]
    if (
      result.sha256 !== version.digest ||
      result.offset !== String(offset) ||
      result.byte_size !== version.byteSize
    ) {
      process.exit(3)
    }
    const bytes = Buffer.from(result.bytes_base64, 'base64')
    chunks.push(bytes)
    offset += bytes.length
    if (offset === Number(version.byteSize)) {
      if (createHash('sha256').update(Buffer.concat(chunks)).digest('hex') !== version.digest) {
        process.exit(4)
      }
      current += 1
      offset = 0
      chunks = []
    }
    readNext()
  } else if ('result' in frame && pending === 'lookup_inventory') {
    receipt = JSON.parse(frame.result.contentItems[0].text).receipt
    tool('submit_proposal', {
      schema_version: 'bench-intake-proposal/3',
      subject_id: manifest.subject_id,
      summary: `Controlled child verified exact PNG/PDF: ${versions
        .map((v) => v.digest)
        .sort()
        .join(',')}`,
      sources: [
        ...versions.map((v) => ({
          kind: 'media_version',
          evidence_id: v.evidenceId,
          version_id: v.versionId,
          sha256: v.digest,
        })),
        { kind: 'research_receipt', receipt_id: receipt.id, sha256: receipt.sha256 },
      ],
    })
  } else if ('result' in frame && pending === 'submit_proposal') {
    if (manifest.subject.quantity?.mode !== 'set') {
      tool('ask_question', {
        kind: 'quantity',
        subject_id: manifest.subject_id,
        prompt: 'Count the fixture packet.',
        reason: 'Controlled child requires the human count.',
      })
    } else {
      write({
        method: 'turn/completed',
        params: { threadId, turn: { id: turnId, status: 'completed' } },
      })
    }
  }
})
lines.on('close', () => process.exit(0))
