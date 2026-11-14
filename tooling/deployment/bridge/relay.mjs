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
async function connectCoordinator() {
  if (!coordinator) {
    const socket = connect(Number(port), '127.0.0.1')
    await once(socket, 'connect')
    return socket
  }
  const peer = spawn('docker', ['exec', '-i', coordinator, 'node', '-e', pump, port], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const ready = await Promise.race([
    once(peer.stderr, 'data').then(([data]) => data.toString().trim() === 'ready'),
    once(peer, 'close').then(() => false),
  ])
  if (!ready) {
    peer.kill()
    throw new Error('coordinator_unavailable')
  }
  const socket = Duplex.from({ readable: peer.stdout, writable: peer.stdin })
  peer.once('close', () => socket.destroy())
  socket.once('close', () => peer.stdin.end())
  return socket
}
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
