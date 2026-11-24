// Byte transport only. The TLS identities and application protocol terminate at the two peers.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { Duplex } from 'node:stream'
import { connect } from 'node:net'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
const codex = process.env.INTAKE_VM_CODEX_SUBSCRIPTION === '1'
const subscription = process.env.INTAKE_VM_CLAUDE_SUBSCRIPTION === '1'
const [vm, port, directory, image, coordinator] = process.argv.slice(2)
if (
  (codex && subscription) ||
  !/^[a-z0-9][a-z0-9-]*$/.test(vm) ||
  !isAbsolute(directory) ||
  !/^\/[a-zA-Z0-9_./-]+$/.test(directory) ||
  !/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$/.test(image) ||
  !/^[0-9]+$/.test(port) ||
  Number(port) < 1 ||
  Number(port) > 65535 ||
  (coordinator && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(coordinator))
) {
  throw new Error('expected VM name, coordinator port, private guest directory and runner image')
}
// Run the other end of the byte pipe in the coordinator's network namespace. The
// coordinator only listens on loopback, even with Docker's network_mode set to none.
const pump = `
  const socket = require('node:net').connect(Number(process.argv[1]), '127.0.0.1')
  socket.once('connect', () => {
    process.stderr.write('ready\\n')
    process.stdin.pipe(socket)
    socket.pipe(process.stdout)
  })
  socket.on('error', () => process.exit(1))
  socket.on('close', () => process.exit())
`
// `signal` abandons the attempt and stops its pump; without one the attempt waits as long as it takes.
async function connectCoordinator(signal) {
  if (!coordinator) {
    const socket = connect(Number(port), '127.0.0.1')
    const abandon = () => socket.destroy()
    signal?.addEventListener('abort', abandon, { once: true })
    try {
      await once(socket, 'connect', { signal })
    } catch (error) {
      socket.destroy()
      throw error
    } finally {
      signal?.removeEventListener('abort', abandon)
    }
    return socket
  }
  const peer = spawn('docker', ['exec', '-i', coordinator, 'node', '-e', pump, port], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const closed = once(peer, 'close').then(
    () => false,
    () => false,
  )
  peer.on('error', () => {})
  const abandoned = new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false)
    }
    signal?.addEventListener('abort', () => resolve(false), { once: true })
  })
  const ready = await Promise.race([
    once(peer.stderr, 'data').then(
      ([data]) => data.toString().trim() === 'ready',
      () => false,
    ),
    closed,
    abandoned,
  ])
  if (!ready) {
    peer.kill()
    await closed
    throw new Error('coordinator_unavailable')
  }
  const socket = Duplex.from({ readable: peer.stdout, writable: peer.stdin })
  peer.once('close', () => socket.destroy())
  socket.once('close', () => peer.stdin.end())
  return socket
}
// A subscription relay also carries its provider's status connection. The credential service is
// the TLS client on it (see intake-server/src/agents/shared-vm/provider-status.ts, which also
// names the socket); this end only moves bytes.
const statusContainer = codex
  ? 'bench-codex-management'
  : subscription
    ? 'bench-claude-management'
    : undefined
const statusSocket = '/tmp/bench-status/status.sock'
const statusPump = `
  const socket = require('node:net').connect(process.argv[1])
  socket.once('connect', () => {
    process.stderr.write('ready\\n')
    process.stdin.pipe(socket)
    socket.pipe(process.stdout)
  })
  socket.on('error', () => process.exit(1))
  socket.on('close', () => process.exit())
`
/** A missing or older credential service is retried less and less often, up to this. */
const STATUS_RETRY_MAX_MS = 30000
/** How long the pump and the coordinator connection may take to come up. */
const STATUS_START_MS = 15000
const stopping = new AbortController()

/** Resolves `value` after `ms`, or as soon as `signal` aborts, leaving no timer behind. */
function waitFor(ms, value, signal) {
  return delay(ms, value, { signal }).catch(() => value)
}

/** Starts the pump in the management container; resolves once it reports its socket open. */
async function openStatusPeer() {
  const peer = spawn(
    'limactl',
    [
      'shell',
      '--workdir=/',
      vm,
      'sudo',
      'docker',
      'exec',
      '-i',
      statusContainer,
      'node',
      '-e',
      statusPump,
      statusSocket,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  // Registered at spawn, so an exit at any point is seen.
  const exited = once(peer, 'close').then(
    () => undefined,
    () => undefined,
  )
  peer.on('error', () => {})
  peer.stdin.on('error', () => {})
  const settled = new AbortController()
  const ready = await Promise.race([
    once(peer.stderr, 'data').then(
      ([data]) => data.toString().trim() === 'ready',
      () => false,
    ),
    exited.then(() => false),
    waitFor(STATUS_START_MS, false, AbortSignal.any([settled.signal, stopping.signal])),
  ])
  settled.abort()
  if (!ready) {
    peer.kill()
    await exited
    return undefined
  }
  return { peer, exited }
}

/** Carries one status connection until either end closes; false when it couldn't be opened. */
async function carryStatusOnce() {
  const opened = await openStatusPeer()
  if (!opened) {
    return false
  }
  const { peer, exited } = opened
  // Giving up on the coordinator stops its pump too, so no attempt is left behind.
  const giveUp = new AbortController()
  const timer = setTimeout(() => giveUp.abort(), STATUS_START_MS)
  const abandon = () => giveUp.abort()
  stopping.signal.addEventListener('abort', abandon, { once: true })
  void exited.then(abandon)
  const socket = await connectCoordinator(giveUp.signal).catch(() => undefined)
  clearTimeout(timer)
  stopping.signal.removeEventListener('abort', abandon)
  if (!socket) {
    peer.kill()
    await exited
    return false
  }
  try {
    socket.on('error', () => socket.destroy())
    socket.once('close', () => peer.kill())
    socket.pipe(peer.stdin)
    peer.stdout.pipe(socket)
    const stop = () => socket.destroy()
    stopping.signal.addEventListener('abort', stop, { once: true })
    await exited
    stopping.signal.removeEventListener('abort', stop)
  } finally {
    socket.destroy()
    peer.kill()
    await exited
  }
  return true
}

/** Keeps one status connection from the credential service to the coordinator. */
async function carryStatus() {
  let retryMs = 500
  while (!stopping.signal.aborted) {
    // A status failure never ends the relay: turns keep running while it retries.
    const carried = await carryStatusOnce().catch(() => false)
    if (carried) {
      retryMs = 500
    } else {
      retryMs = Math.min(retryMs * 2, STATUS_RETRY_MAX_MS)
    }
    await waitFor(retryMs, undefined, stopping.signal)
  }
}
const status = statusContainer ? carryStatus().catch(() => {}) : undefined

const tools = process.env.INTAKE_VM_BUILTIN_TOOLS === '1'
if (tools && !(codex || subscription)) throw new Error('tool_worker_requires_selected_provider')
const toolScript = tools ? readFileSync(new URL('./tool-turn.sh', import.meta.url), 'utf8') : ''
for (;;) {
  let socket
  try {
    socket = await connectCoordinator()
  } catch {
    await delay(500)
    continue
  }
  const runId = randomUUID()
  const child = spawn(
    'limactl',
    tools
      ? [
          'shell',
          '--workdir=/',
          vm,
          'sudo',
          'sh',
          '-c',
          toolScript,
          'tool-turn',
          directory,
          image,
          codex ? 'codex' : 'claude',
          runId,
        ]
      : [
          'shell',
          '--workdir=/',
          vm,
          'sudo',
          'docker',
          'run',
          '--rm',
          '-i',
          '--network=none',
          '--read-only',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges',
          '--pids-limit=64',
          '--memory=384m',
          '--tmpfs=/tmp:rw,nosuid,nodev,size=32m',
          '--mount',
          'type=bind,src=' + directory + '/guest,dst=/run/bench-pair,readonly',
          '--mount',
          'type=bind,src=' + directory + '/sessions,dst=/home/node/sessions',
          ...(codex
            ? [
                '-e',
                'INTAKE_VM_CODEX_SUBSCRIPTION=1',
                '--mount',
                'type=bind,src=' + directory + '/codex-state,dst=/run/codex-state',
                '--mount',
                'type=bind,src=' + directory + '/codex-egress,dst=/run/egress,readonly',
              ]
            : []),
          ...(subscription
            ? [
                '-e',
                'INTAKE_VM_CLAUDE_SUBSCRIPTION=1',
                '--mount',
                'type=bind,src=' + directory + '/claude-store,dst=/run/claude-store,readonly',
                '--mount',
                'type=bind,src=' + directory + '/egress,dst=/run/egress,readonly',
                '--tmpfs=/home/node/.claude:rw,nosuid,nodev,uid=1000,gid=1000,mode=700,size=32m',
                '--tmpfs=/home/node/.config:rw,nosuid,nodev,uid=1000,gid=1000,mode=700,size=4m',
              ]
            : []),
          image,
          'node',
          '--import',
          'tsx',
          'src/agents/shared-vm/guest-main.ts',
        ],
    { stdio: ['pipe', 'pipe', 'inherit'] },
  )
  child.stdin.on('error', () => socket.destroy())
  socket.on('error', () => socket.destroy())
  const stopGuest = () => {
    child.stdin.end()
    if (tools) {
      // The provider may intentionally ignore EOF. Removing this connection's trusted
      // supervisor wakes its VM-side launcher, which removes the exact worker cgroup.
      const stop = spawn(
        'limactl',
        ['shell', '--workdir=/', vm, 'sudo', 'docker', 'rm', '-f', 'bench-tool-' + runId + '-peer'],
        { stdio: 'ignore', timeout: 10000 },
      )
      stop.on('error', () => {})
    }
  }
  socket.once('close', stopGuest)
  socket.once('end', () => socket.destroy())
  let terminating = false
  const terminate = () => {
    terminating = true
    socket.destroy()
  }
  process.once('SIGTERM', terminate)
  socket.pipe(child.stdin)
  child.stdout.pipe(socket)
  await once(child, 'close')
  process.off('SIGTERM', terminate)
  socket.destroy()
  if (terminating) break
}
stopping.abort()
await status
