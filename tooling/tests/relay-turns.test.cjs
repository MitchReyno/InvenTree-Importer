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
  if (text.includes('exit\\n')) process.exit(0)
})
process.stdin.on('end', () => process.exit(0))
`

/** A coordinator stand-in that records every connection the relay opens. */
async function coordinator(t) {
  const sockets = []
  const server = createServer((socket) => {
    socket.on('error', () => socket.destroy())
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
  return { port: server.address().port, sockets, open }
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
        PATH: root + ':' + process.env.PATH,
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

test('an idle relay holds one ready connection', async (t) => {
  const server = await coordinator(t)
  await relay(t, server.port)
  await until(() => server.open().length === 1, 'first connection')
  await delay(1500)
  assert.equal(server.open().length, 1)
})

test('a claimed connection makes the relay open the next, up to its capacity', async (t) => {
  const server = await coordinator(t)
  await relay(t, server.port, { INTAKE_VM_RELAY_TURNS: '3' })
  for (let lanes = 1; lanes <= 3; lanes++) {
    await until(() => server.open().length === lanes, `connection ${lanes}`)
    server.open().at(-1).write('claim\n')
  }
  // Three busy turns: no fourth connection.
  await delay(1500)
  assert.equal(server.open().length, 3)
  // A busy turn that ends frees room for a ready one.
  server.open()[0].write('exit\n')
  await until(
    () => server.sockets.length === 4 && server.open().length === 3,
    'replacement after a turn ends',
  )
})

test('a guest that reports no claim leaves the relay carrying one turn at a time', async (t) => {
  const server = await coordinator(t)
  await relay(t, server.port, { FAKE_NO_MARKER: '1' })
  await until(() => server.open().length === 1, 'first connection')
  server.open()[0].write('claim\n')
  await delay(1500)
  assert.equal(server.sockets.length, 1)
  server.open()[0].write('exit\n')
  await until(() => server.sockets.length === 2, 'next connection after the turn ends')
})

test('a ready connection the coordinator drops is replaced', async (t) => {
  const server = await coordinator(t)
  await relay(t, server.port)
  await until(() => server.open().length === 1, 'first connection')
  server.open()[0].destroy()
  await until(() => server.open().length === 1 && server.sockets.length === 2, 'replacement')
})

test('the relay forwards guest messages and keeps claim reports to itself', async (t) => {
  const server = await coordinator(t)
  const relayed = await relay(t, server.port)
  await until(() => server.open().length === 1, 'first connection')
  server.open()[0].write('claim\n')
  await until(() => server.open().length === 2, 'second connection')
  await until(() => relayed.stderr().includes('guest says hello'), 'forwarded line')
  assert.ok(!relayed.stderr().includes(MARKER), relayed.stderr())
})

test('SIGTERM closes every connection and the relay exits', async (t) => {
  const server = await coordinator(t)
  const relayed = await relay(t, server.port, { INTAKE_VM_RELAY_TURNS: '2' })
  await until(() => server.open().length === 1, 'first connection')
  server.open()[0].write('claim\n')
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
