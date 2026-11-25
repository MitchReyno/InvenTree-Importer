#!/usr/bin/env node
// Stands in for the pinned Claude CLI and Codex app-server for catalogue reads. It answers from
// the recorded replies of the pinned versions and logs every frame it receives, so a test can
// check that no read sent a user message or started a turn.
const { appendFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

// Beside the CLI's working directory unless named, since a reader passes only an allowlisted
// environment.
const log = process.env.MODEL_CATALOG_LOG ?? join(process.cwd(), 'model-catalog-cli.log')
const mode = process.env.MODEL_CATALOG_MODE ?? 'answer'
// A read that takes this long to answer, so a test can act while it runs.
const delayMs = Number(process.env.MODEL_CATALOG_DELAY_MS ?? 0)
const fixtures = join(__dirname, 'model-catalog')
const codex = process.argv.includes('app-server')

function record(entry) {
  if (log) {
    appendFileSync(log, JSON.stringify(entry) + '\n')
  }
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

record({ started: codex ? 'codex' : 'claude', pid: process.pid, args: process.argv.slice(2) })
if (mode === 'hang') {
  // Answers nothing and ignores SIGTERM, so only the reader's SIGKILL ends it.
  process.on('SIGTERM', () => {})
}

let buffer = ''
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let newline
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    if (!line.trim()) {
      continue
    }
    const message = JSON.parse(line)
    record({ received: message })
    if (mode === 'hang') {
      continue
    }
    setTimeout(() => (codex ? answerCodex(message) : answerClaude(message)), delayMs)
  }
})
process.stdin.on('end', () => {
  if (mode !== 'hang') {
    process.exit(0)
  }
})
if (mode === 'hang') {
  setInterval(() => {}, 1000)
}

function answerClaude(message) {
  if (message.type !== 'control_request' || message.request?.subtype !== 'initialize') {
    return
  }
  const reply = JSON.parse(readFileSync(join(fixtures, 'claude-initialize-2.1.319.json'), 'utf8'))
  send({ type: 'system', subtype: 'hook_started' })
  send({
    type: 'control_response',
    response: { subtype: 'success', request_id: message.request_id, response: reply },
  })
}

function answerCodex(message) {
  if (message.method === 'initialize') {
    send({ id: message.id, result: { userAgent: 'bench_intake/0.166.0 (fixture)' } })
    return
  }
  if (message.method === 'model/list') {
    const page = JSON.parse(readFileSync(join(fixtures, 'codex-model-list-0.166.0.json'), 'utf8'))
    send({ method: 'account/rateLimits/updated', params: {} })
    send({ id: message.id, result: page })
  }
}
