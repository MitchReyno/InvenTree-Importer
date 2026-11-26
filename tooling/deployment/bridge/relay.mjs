// Byte transport only. The TLS identities and application protocol terminate at the two peers.
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { Duplex } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { connect } from 'node:net'
import { spawn } from 'node:child_process'
import { once, setMaxListeners } from 'node:events'
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
/** How long a stopped pump gets to exit before it is killed. */
const STOP_GRACE_MS = 2000

/** Closes a child's input and signals it, then kills it if it hasn't exited in time. */
async function stopChild(child, exited) {
  child.stdin?.end()
  child.kill()
  const settled = new AbortController()
  const stopped = await Promise.race([
    exited.then(() => true),
    delay(STOP_GRACE_MS, false, { signal: settled.signal }).catch(() => false),
  ])
  settled.abort()
  if (!stopped) {
    child.kill('SIGKILL')
    await exited
  }
}

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
  let abandon
  const abandoned = new Promise((resolve) => {
    abandon = () => resolve(false)
    if (signal?.aborted) {
      resolve(false)
    }
    signal?.addEventListener('abort', abandon, { once: true })
  })
  const ready = await Promise.race([
    once(peer.stderr, 'data').then(
      ([data]) => data.toString().trim() === 'ready',
      () => false,
    ),
    closed,
    abandoned,
  ])
  // Each turn connection passes the relay's lifetime signal, so its listener can't stay behind.
  signal?.removeEventListener('abort', abandon)
  if (!ready) {
    await stopChild(peer, closed)
    throw new Error('coordinator_unavailable')
  }
  const socket = Duplex.from({ readable: peer.stdout, writable: peer.stdin })
  peer.once('close', () => socket.destroy())
  socket.once('close', () => peer.stdin.end())
  return socket
}
const delivery = process.env.INTAKE_VM_EVIDENCE_DELIVERY || 'file'
if (delivery !== 'inline' && delivery !== 'file') throw new Error('invalid_evidence_delivery')
const tools = process.env.INTAKE_VM_BUILTIN_TOOLS === '1'
if (tools && !(codex || subscription)) throw new Error('tool_worker_requires_selected_provider')
const toolScript = tools ? readFileSync(new URL('./tool-turn.sh', import.meta.url), 'utf8') : ''
/** The most slots a session limit can set (MAX_SESSION_SLOTS in agents/session/slots.ts). */
const DEFAULT_RELAY_TURNS = 8
const relayTurnsSetting = process.env.INTAKE_VM_RELAY_TURNS ?? String(DEFAULT_RELAY_TURNS)
if (!/^[1-8]$/.test(relayTurnsSetting)) throw new Error('invalid_relay_turns')
const relayTurns = Number(relayTurnsSetting)

// A subscription relay also carries its provider's status connection and its model catalogue
// connection. The credential service is the TLS client on each (see
// intake-server/src/agents/shared-vm/provider-status.ts and model-catalog.ts, which also name the
// sockets); this end only moves bytes.
const statusContainer = codex
  ? 'bench-codex-management'
  : subscription
    ? 'bench-claude-management'
    : undefined
const statusSocket = '/tmp/bench-status/status.sock'
const catalogSocket = '/tmp/bench-status/catalog.sock'
// Claude's catalogue runs in a container with no network of its own; Codex's in its management one.
const catalogContainer = codex ? statusContainer : subscription ? 'bench-claude-catalog' : undefined
const statusPump = `
  // Before the socket opens, it ends by itself when the relay closes its input or in 10 s.
  const starting = setTimeout(() => process.exit(1), 10000)
  const abandoned = () => process.exit()
  process.stdin.once('end', abandoned)
  const socket = require('node:net').connect(process.argv[1])
  socket.once('connect', () => {
    clearTimeout(starting)
    process.stdin.off('end', abandoned)
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
// Every lane and status carrier listens for the stop.
setMaxListeners(64, stopping.signal)

/** Resolves `value` after `ms`, or as soon as `signal` aborts, leaving no timer behind. */
function waitFor(ms, value, signal) {
  return delay(ms, value, { signal }).catch(() => value)
}

/** Starts the pump in the management container; resolves once it reports its socket open. */
async function openStatusPeer(container, socketPath) {
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
      container,
      'node',
      '-e',
      statusPump,
      socketPath,
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
    await stopChild(peer, exited)
    return undefined
  }
  return { peer, exited }
}

/** Carries one connection until either end closes; false when it couldn't be opened. */
async function carryStatusOnce(container, socketPath) {
  const opened = await openStatusPeer(container, socketPath)
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
    await stopChild(peer, exited)
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
    await stopChild(peer, exited)
  }
  return true
}

/** Keeps one connection from the credential service's socket to the coordinator. */
async function carryStatus(container, socketPath) {
  let retryMs = 500
  while (!stopping.signal.aborted) {
    // A status or catalogue failure never ends the relay: turns keep running while it retries.
    const carried = await carryStatusOnce(container, socketPath).catch(() => false)
    if (carried) {
      retryMs = 500
    } else {
      retryMs = Math.min(retryMs * 2, STATUS_RETRY_MAX_MS)
    }
    await waitFor(retryMs, undefined, stopping.signal)
  }
}
// Each on its own connection, so a catalogue read of many seconds never holds a status read.
const status = statusContainer
  ? Promise.all([
      carryStatus(statusContainer, statusSocket).catch(() => {}),
      // Two, so the worker's sign-in generation check needn't wait for a read in progress.
      carryStatus(catalogContainer, catalogSocket).catch(() => {}),
      carryStatus(catalogContainer, catalogSocket).catch(() => {}),
    ])
  : undefined
/** The guest's claim report: TURN_CLAIMED_MARKER in intake-server/src/agents/shared-vm/turn-claimed.ts. */
const TURN_CLAIMED_MARKER = 'bench-turn-claimed'
/** How long a lane that ended unclaimed waits, so a refusing coordinator can't make it spin. */
const UNCLAIMED_RETRY_MS = 500

/** The guest command for one turn connection: the tool launcher, or one bounded container. */
function guestArgs(runId) {
  if (tools) {
    return [
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
      delivery,
    ]
  }
  return [
    'shell',
    '--workdir=/',
    vm,
    'sudo',
    'docker',
    'run',
    '--rm',
    '-i',
    '--name',
    'bench-turn-' + runId,
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
  ]
}

/** A longer unfinished line can't be the claim report, so it is forwarded instead of kept. */
const MAX_HELD_LINE_CHARS = 4096

/** Forwards the guest's standard error by line, except its claim report, which calls `onClaimed`. */
function watchGuestErrors(stream, onClaimed) {
  const decoder = new StringDecoder('utf8')
  let partial = ''
  // After an overlong fragment was forwarded, the rest of its line is never a claim report.
  let midLine = false

  const forward = (text) => {
    process.stderr.write(text)
  }

  stream.on('data', (bytes) => {
    const lines = (partial + decoder.write(bytes)).split('\n')
    partial = lines.pop()
    for (const line of lines) {
      if (line === TURN_CLAIMED_MARKER && !midLine) {
        onClaimed()
      } else {
        forward(line + '\n')
      }
      midLine = false
    }
    if (partial.length > MAX_HELD_LINE_CHARS) {
      forward(partial)
      partial = ''
      midLine = true
    }
  })
  stream.on('end', () => {
    const rest = partial + decoder.end()
    if (rest) {
      forward(rest + '\n')
    }
  })
}

/** Connects to the coordinator, retrying until it answers; undefined once the relay stops. */
async function connectLane() {
  while (!stopping.signal.aborted) {
    try {
      return await connectCoordinator(stopping.signal)
    } catch {
      await waitFor(500, undefined, stopping.signal)
    }
  }
  return undefined
}

/**
 * How long a guest launcher gets to exit once its connection has closed before it is stopped.
 * It covers the guest's own cleanup, including the paired supervisor's 12 s removal-receipt wait.
 */
const GUEST_EXIT_MS = 60_000

/**
 * Stops a launcher that outlived its connection: removes the turn's containers by name, then the
 * local launcher. Nothing here confirms the provider stopped; the coordinator's slot stays held
 * until the guest's removal receipt does.
 */
async function abandonGuest(child, exited, runId) {
  process.stderr.write(JSON.stringify({ event: 'guest_teardown_overdue', run_id: runId }) + '\n')
  const names = tools
    ? ['bench-tool-' + runId, 'bench-tool-' + runId + '-peer', 'bench-tool-' + runId + '-egress']
    : ['bench-turn-' + runId]
  const remove = spawn(
    'limactl',
    ['shell', '--workdir=/', vm, 'sudo', 'docker', 'rm', '-f', ...names],
    {
      stdio: 'ignore',
      timeout: 10000,
    },
  )
  await new Promise((resolve) => {
    remove.once('close', resolve)
    remove.once('error', resolve)
  })
  await stopChild(child, exited)
}

/** Carries one turn connection until its guest exits; resolves whether the guest was claimed. */
async function carryTurn(socket, onClaimed) {
  const runId = randomUUID()
  let claimed = false
  const child = spawn('limactl', guestArgs(runId), { stdio: ['pipe', 'pipe', 'pipe'] })
  // A launcher that can't be started reports an error, and may not close.
  const exited = new Promise((resolve) => {
    child.once('close', resolve)
    child.once('error', resolve)
  })
  child.stdout.on('error', () => {})
  child.stderr.on('error', () => {})
  watchGuestErrors(child.stderr, () => {
    if (!claimed) {
      claimed = true
      onClaimed()
    }
  })
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
  let exitTimer
  let guestExited = false
  socket.once('close', () => {
    stopGuest()
    // A launcher that outlives its connection by this much is stopped, so the lane comes back.
    if (!guestExited) {
      exitTimer = setTimeout(() => void abandonGuest(child, exited, runId), GUEST_EXIT_MS)
    }
  })
  socket.once('end', () => socket.destroy())
  const terminate = () => socket.destroy()
  stopping.signal.addEventListener('abort', terminate, { once: true })
  try {
    socket.pipe(child.stdin)
    child.stdout.pipe(socket)
    await exited
  } finally {
    guestExited = true
    stopping.signal.removeEventListener('abort', terminate)
    socket.destroy()
    clearTimeout(exitTimer)
  }
  return claimed
}

// Each lane carries one turn connection at a time. One lane is kept ready (not yet claimed), and
// a claim opens the next, so an idle relay holds one guest turn rather than its capacity.
let lanes = 0
let readyLanes = 0
const laneRuns = new Set()

function fillLanes() {
  while (!stopping.signal.aborted && readyLanes === 0 && lanes < relayTurns) {
    startLane()
  }
}

function startLane() {
  lanes++
  readyLanes++
  let ready = true

  const leaveReady = () => {
    if (ready) {
      ready = false
      readyLanes--
    }
  }

  const run = (async () => {
    const socket = await connectLane()
    if (!socket) {
      return
    }
    const claimed = await carryTurn(socket, () => {
      leaveReady()
      fillLanes()
    })
    if (!claimed) {
      await waitFor(UNCLAIMED_RETRY_MS, undefined, stopping.signal)
    }
  })()
    .catch(() => {})
    .finally(() => {
      laneRuns.delete(run)
      leaveReady()
      lanes--
      fillLanes()
    })
  laneRuns.add(run)
}

process.once('SIGTERM', () => stopping.abort())
fillLanes()
await once(stopping.signal, 'abort')
while (laneRuns.size) {
  await Promise.all([...laneRuns])
}
await status
