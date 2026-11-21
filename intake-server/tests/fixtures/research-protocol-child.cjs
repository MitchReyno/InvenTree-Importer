'use strict'

const { createHash, randomUUID } = require('node:crypto')
const { createInterface } = require('node:readline')

const mode = process.argv[2] || 'proposal'
const threadId = `controlled-thread-${randomUUID()}`
const turnId = randomUUID()
let manifest
let pending
let artifact
let artifactOffset = 0
const artifactBytes = []

function write(frame) {
  process.stdout.write(`${JSON.stringify(frame)}\n`)
}

function tool(name, args) {
  pending = name
  write({
    id: `wire-${name}-${artifactOffset}`,
    method: 'item/tool/call',
    params: {
      threadId,
      turnId,
      callId: `opaque-${name}-${artifactOffset}`,
      namespace: 'bench_intake',
      tool: name,
      arguments: args,
    },
  })
}

function resultSource() {
  if (artifact) {
    return {
      kind: 'media_version',
      evidence_id: artifact.evidenceId,
      version_id: artifact.versionId,
      sha256: artifact.digest,
    }
  }
  // Mirrors automationNoteId (capture/context-input.ts): requested automation is never evidence.
  const hex = createHash('sha256').update(`automation-intent:${manifest.batch_id}`).digest('hex')
  const intentId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
  const note = manifest.notes.find((value) => value.id !== intentId)
  if (!note) {
    const version = JSON.parse(manifest.media.manifest).versions[0]
    return {
      kind: 'media_version',
      evidence_id: version.evidenceId,
      version_id: version.versionId,
      sha256: version.digest,
    }
  }
  return {
    kind: 'note',
    note_id: note.id,
    text_sha256: createHash('sha256').update(note.text).digest('hex'),
  }
}

function finishResearch() {
  if (mode.includes('question')) {
    tool('ask_question', {
      kind: 'quantity',
      subject_id: manifest.subject_id,
      prompt: 'Count this synthetic packet.',
      reason: 'Controlled child requests human confirmation.',
    })
    return
  }
  tool('submit_proposal', {
    schema_version: 'bench-intake-proposal/3',
    subject_id: manifest.subject_id,
    summary: 'SYNTHETIC controlled child byte receipt; no inference.',
    sources: [resultSource()],
  })
}

function readArtifact() {
  tool('read_evidence', {
    version_id: artifact.versionId,
    sha256: artifact.digest,
    offset: String(artifactOffset),
    length: '98304',
  })
}

if (mode === 'ignore-term') {
  process.on('SIGTERM', () => {})
  process.stdin.resume()
  setInterval(() => {}, 1000)
  write({ pid: process.pid, ready: true })
} else if (mode === 'environment') {
  write({
    pid: process.pid,
    keys: Object.keys(process.env).sort(),
    canary: process.env.BENCH_RESEARCH_TEST_CANARY || null,
  })
  process.stdin.resume()
} else if (mode === 'malformed') {
  process.stdout.write('{"duplicate":1,"duplicate":2}\n')
  process.stdin.resume()
} else if (mode === 'invalid-utf8') {
  process.stdout.write(Buffer.from([0xc3, 0x28, 10]))
  process.stdin.resume()
} else if (mode === 'partial') {
  process.stdout.write('{"incomplete":', () => process.exit(0))
} else if (mode === 'oversized-frame') {
  process.stdout.write(Buffer.alloc(256 * 1024 + 1, 97))
  process.stdin.resume()
} else if (mode === 'oversized-stderr') {
  process.stderr.write(Buffer.alloc(2 * 1024 * 1024 + 1, 97))
  process.stdin.resume()
} else if (mode === 'frame-flood') {
  process.stdout.write('{}\n'.repeat(300))
  process.stdin.resume()
} else {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  lines.on('line', (line) => {
    const frame = JSON.parse(line)
    if (frame.method === 'initialize') {
      write({ id: frame.id, result: { userAgent: 'controlled-node-stub' } })
    } else if (frame.method === 'thread/start') {
      write({ id: frame.id, result: { thread: { id: threadId } } })
    } else if (frame.method === 'turn/start') {
      manifest = JSON.parse(frame.params.input[0].text)
      write({ id: frame.id, result: { turn: { id: turnId } } })
      if (mode.startsWith('evidence')) {
        artifact = JSON.parse(manifest.media.manifest).versions[Number(process.argv[3] || '0')]
        readArtifact()
      } else {
        finishResearch()
      }
    } else if ('result' in frame && pending === 'read_evidence') {
      const chunk = JSON.parse(frame.result.contentItems[0].text)
      if (chunk.sha256 !== artifact.digest || chunk.offset !== String(artifactOffset)) {
        process.exit(2)
      }
      const bytes = Buffer.from(chunk.bytes_base64, 'base64')
      artifactBytes.push(bytes)
      artifactOffset += bytes.length
      if (artifactOffset < Number(chunk.byte_size)) {
        readArtifact()
      } else {
        const digest = createHash('sha256').update(Buffer.concat(artifactBytes)).digest('hex')
        if (digest !== artifact.digest) {
          process.exit(3)
        }
        finishResearch()
      }
    } else if ('result' in frame && pending === 'submit_proposal') {
      write({
        method: 'turn/completed',
        params: { threadId, turn: { id: turnId, status: 'completed' } },
      })
    }
  })
  lines.on('close', () => process.exit(0))
}
