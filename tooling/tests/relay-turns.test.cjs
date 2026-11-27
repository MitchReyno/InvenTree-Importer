const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { chmod, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')

const RELAY = resolve(__dirname, '../deployment/bridge/relay.mjs')
const MARKER = 'bench-turn-claimed'
const OFFER = 'bench-lane/1 claude tools\n'

// Stands in for Lima. A tool turn runs FAKE_LANE; removing a container succeeds; the status and
// catalogue pumps fail, which the relay retries apart from its turns.
const FAKE_LIMACTL = `#!/bin/sh
shift 3
[ "$1" = sudo ] && shift
case "$1" in
  sh) exec node -e "$FAKE_LANE" ;;
  docker) [ "$2" = rm ] && exit 0; exit 1 ;;
esac
exit 2
`

// A guest: "claim" from the coordinator makes it report its claim (unless FAKE_NO_MARKER), "exit"
// ends it, and so does the end of its input.
const FAKE_LANE = `
process.stderr.write('guest says hello\\n')
let text = ''
let claimed = false
process.stdin.on('data', (bytes) => {
  text += bytes
  if (!claimed && text.includes('claim\\n')) {
    claimed = true
    if (!process.env.FAKE_NO_MARKER) process.stderr.write('${MARKER}\\n')
  }
  if (text.includes('long\\n') && !claimed) {
    claimed = true
    // An overlong unfinished line, then the marker text finishing that same line.
    process.stderr.write('x'.repeat(5000))
    setTimeout(() => process.stderr.write('${MARKER}\\n'), 200)
  }
  if (text.includes('exit\\n')) process.exit(0)
})
process.stdin.on('end', () => process.exit(0))
`

/**
 * A coordinator stand-in that records every connection the relay opens; with `autoStart` it asks
 * for each offer's guest at once.
 */
async function coordinator(t, { autoStart = false } = {}) {
  const sockets = []
  const received = new Map()
  const server = createServer((socket) => {
    socket.on('error', () => socket.destroy())
    received.set(socket, '')
    socket.on('data', (bytes) => {
      received.set(socket, received.get(socket) + bytes)
      if (autoStart && received.get(socket) === OFFER) {
        socket.write('go\n')
      }
    })
    sockets.push(socket)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => {
    for (const socket of sockets) {
      socket.destroy()
    }
    server.close()
  })
  const open = () => sockets.filter((socket) => !socket.destroyed)
  /** Waits for the socket's offer, then asks for its guest and sends it `text`. */
  const start = async (socket, text) => {
    await until(() => received.get(socket) === OFFER, 'lane offer')
    socket.write('go\n' + (text ?? ''))
  }
  return {
    port: server.address().port,
    sockets,
    open,
    received: (socket) => received.get(socket),
    start,
  }
}

async function relay(t, port, env = {}) {
  const root = await mkdtemp(join(tmpdir(), 'relay-turns-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, 'limactl'), FAKE_LIMACTL)
  await chmod(join(root, 'limactl'), 0o755)
  const child = spawn(
    process.execPath,
    [RELAY, 'bench-agent-test', String(port), '/guest', 'runner:test'],
    {
      detached: true,
      stdio: ['ignore', 'ignore', 'pipe'],
      env: {
        PATH: env.PATH ?? root + ':' + process.env.PATH,
        INTAKE_VM_CLAUDE_SUBSCRIPTION: '1',
        INTAKE_VM_BUILTIN_TOOLS: '1',
        FAKE_LANE,
        ...env,
      },
    },
  )
  let stderr = ''
  child.stderr.on('data', (bytes) => {
    stderr += bytes
  })
  const exited = once(child, 'exit')
  t.after(() => {
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      /* Already gone. */
    }
  })
  return { child, exited, stderr: () => stderr }
}

async function until(condition, label, boundMs = 10_000) {
  const deadline = Date.now() + boundMs
  while (!condition()) {
    if (Date.now() > deadline) {
      assert.fail(label)
    }
    await delay(25)
  }
}

test('an idle relay offers one lane and starts no guest', async (t) => {
  const server = await coordinator(t)
  const relayed = await relay(t, server.port)
  await until(() => server.open().length === 1, 'first connection')
  await until(() => server.received(server.open()[0]) === OFFER, 'lane offer')
  await delay(1500)
  assert.equal(server.open().length, 1)
  assert.ok(!relayed.stderr().includes('guest says hello'), relayed.stderr())
})

test('a started lane makes the relay offer the next, up to its capacity', async (t) => {
  const server = await coordinator(t)
  await relay(t, server.port, { INTAKE_VM_RELAY_TURNS: '3' })
  for (let lanes = 1; lanes <= 3; lanes++) {
    await until(() => server.open().length === lanes, `connection ${lanes}`)
    await server.start(server.open().at(-1), 'claim\n')
  }
  // Three busy turns: no fourth connection.
  await delay(1500)
  assert.equal(server.open().length, 3)
  // A busy turn that ends frees room for an offer.
  server.open()[0].write('exit\n')
  await until(
    () => server.sockets.length === 4 && server.open().length === 3,
    'replacement after a turn ends',
  )
})

test('a guest that reports no claim still lets the next lane be offered', async (t) => {
  const server = await coordinator(t)
  await relay(t, server.port, { FAKE_NO_MARKER: '1' })
  await until(() => server.open().length === 1, 'first connection')
  await server.start(server.open()[0], 'claim\n')
  await until(() => server.open().length === 2, 'next offer')
})

test('an offer answered with anything but go is dropped and replaced', async (t) => {
  const server = await coordinator(t)
  const relayed = await relay(t, server.port)
  await until(() => server.open().length === 1, 'first connection')
  await until(() => server.received(server.open()[0]) === OFFER, 'lane offer')
  server.open()[0].write('nope\n')
  await until(() => server.sockets.length === 2 && server.open().length === 1, 'replacement')
  assert.ok(!relayed.stderr().includes('guest says hello'), relayed.stderr())
})

test('a ready connection the coordinator drops is replaced', async (t) => {
  const server = await coordinator(t)
  await relay(t, server.port)
  await until(() => server.open().length === 1, 'first connection')
  server.open()[0].destroy()
  await until(() => server.open().length === 1 && server.sockets.length === 2, 'replacement')
})

test('a guest launcher that cannot start is retried at a bounded pace', async (t) => {
  const server = await coordinator(t, { autoStart: true })
  // No limactl on the path, so every guest fails to spawn; one lane, asked at once each time.
  await relay(t, server.port, { PATH: '/nonexistent', INTAKE_VM_RELAY_TURNS: '1' })
  await delay(2000)
  // One connection per lane attempt, each followed by the 500 ms wait.
  assert.ok(server.sockets.length >= 1 && server.sockets.length <= 5, String(server.sockets.length))
})

test('the relay forwards guest messages and keeps claim reports to itself', async (t) => {
  const server = await coordinator(t)
  const relayed = await relay(t, server.port)
  await until(() => server.open().length === 1, 'first connection')
  await server.start(server.open()[0], 'claim\n')
  await until(() => server.open().length === 2, 'second connection')
  await until(() => relayed.stderr().includes('guest says hello'), 'forwarded line')
  assert.ok(!relayed.stderr().includes(MARKER), relayed.stderr())
})

test('the marker text ending an overlong line is forwarded, not taken as a claim', async (t) => {
  const server = await coordinator(t)
  const relayed = await relay(t, server.port)
  await until(() => server.open().length === 1, 'first connection')
  await server.start(server.open()[0], 'long\n')
  await until(() => relayed.stderr().includes(MARKER), 'forwarded marker text')
  // The marker is not taken out of the forwarded text.
  await delay(500)
  assert.ok(relayed.stderr().includes('x'.repeat(100) + MARKER), 'one forwarded line')
})

test('SIGTERM closes every connection and the relay exits', async (t) => {
  const server = await coordinator(t)
  const relayed = await relay(t, server.port, { INTAKE_VM_RELAY_TURNS: '2' })
  await until(() => server.open().length === 1, 'first connection')
  await server.start(server.open()[0], 'claim\n')
  await until(() => server.open().length === 2, 'second connection')
  relayed.child.kill('SIGTERM')
  const [code] = await relayed.exited
  assert.equal(code, 0)
  await until(() => server.open().length === 0, 'connections closed')
  assert.equal(server.sockets.length, 2)
})

test('the default capacity is the most slots a session limit can set', async () => {
  const slots = await readFile(
    resolve(__dirname, '../../intake-server/src/agents/session/slots.ts'),
    'utf8',
  )
  const relaySource = await readFile(RELAY, 'utf8')
  const max = slots.match(/export const MAX_SESSION_SLOTS = (\d+)/)[1]
  assert.match(relaySource, new RegExp(`const DEFAULT_RELAY_TURNS = ${max}\\b`))
})

test("pnpm dev waits for the worker's startup check of every held VM turn", async () => {
  const read = (path) => readFile(resolve(__dirname, '../..', path), 'utf8')
  const slots = await read('intake-server/src/agents/session/slots.ts')
  const held = await read('intake-server/src/agents/held-capacity.ts')
  const dev = await read('tooling/dev.cjs')
  const max = Number(slots.match(/export const MAX_SESSION_SLOTS = (\d+)/)[1])
  const check = Number(
    held.match(/export const STARTUP_REAP_CHECK_MS = ([\d_]+)/)[1].replace(/_/g, ''),
  )
  const [, base, count, each] = dev.match(/const AGENTS_READY_MS = ([\d_]+) \+ (\d+) \* ([\d_]+)/)
  assert.equal(Number(count), max)
  assert.equal(Number(each.replace(/_/g, '')), check)
  assert.ok(Number(base.replace(/_/g, '')) > 0)
})
