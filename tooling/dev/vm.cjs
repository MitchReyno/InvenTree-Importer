/**
 * The agent VM's side of `pnpm dev`: boots and stops the Lima instance, and launches the credential
 * tunnel and one relay per provider. Commands and `launch` are passed in so tests can substitute them.
 */
const { execFile } = require('node:child_process')
const { join } = require('node:path')
const { promisify } = require('node:util')
const { setTimeout: delay } = require('node:timers/promises')

const run = promisify(execFile)

/** Names the launcher keeps through source reloads and stops the app for when they exit. */
const VM_CHILD_NAMES = ['vm-tunnel', 'vm-relay-claude', 'vm-relay-codex']

/** A cold Lima boot takes about 36 s on an M1; this allows for a slow first boot or busy host. */
const VM_BOOT_TIMEOUT_MS = 180_000
const VM_STATUS_TIMEOUT_MS = 15_000
const VM_STOP_TIMEOUT_MS = 60_000
/** Healthy tunnels and relays print nothing; a bad port or argument makes them exit within this. */
const CHILD_SETTLE_MS = 1000

/** The loopback ports the dev UI proxies to the guest's Claude and Codex credential services. */
const CREDENTIAL_PORTS = [14315, 14317]

async function defaultExec(command, args, options) {
  const { stdout } = await run(command, args, options)
  return stdout
}

async function vmRunning(plan, { exec = defaultExec } = {}) {
  let status
  try {
    status = await exec('limactl', ['list', '--format', '{{.Status}}', plan.name], {
      timeout: VM_STATUS_TIMEOUT_MS,
    })
  } catch {
    throw new Error('vm_start_failed')
  }
  const value = status.trim()
  if (value === '') {
    throw new Error('vm_start_failed')
  }
  return value === 'Running'
}

async function startVm(plan, { exec = defaultExec, signal } = {}) {
  try {
    await exec('limactl', ['start', '--tty=false', plan.name], {
      timeout: VM_BOOT_TIMEOUT_MS,
      signal,
    })
  } catch {
    throw new Error('vm_start_failed')
  }
}

/** Only a VM this run booted is stopped: one that was already running may be in use elsewhere. */
function shouldStopVm(plan, booted) {
  return booted && !plan.keepRunning
}

async function stopVm(plan, { exec = defaultExec } = {}) {
  try {
    await exec('limactl', ['stop', plan.name], { timeout: VM_STOP_TIMEOUT_MS })
  } catch {
    throw new Error('vm_stop_failed')
  }
}

function tunnelArgs(plan, baseEnv) {
  const limaHome = baseEnv.LIMA_HOME ?? join(baseEnv.HOME, '.lima')
  const forwards = CREDENTIAL_PORTS.flatMap((port) => ['-L', `127.0.0.1:${port}:127.0.0.1:${port}`])
  // Lima's ssh.config shares one connection; through it, ssh would hand the forwards over and exit.
  return [
    '-NT',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ControlPath=none',
    '-F',
    join(limaHome, plan.name, 'ssh.config'),
    ...forwards,
    `lima-${plan.name}`,
  ]
}

function relayEnv(plan, baseEnv, providerFlag) {
  return {
    ...baseEnv,
    [providerFlag]: '1',
    ...(plan.tools ? { INTAKE_VM_BUILTIN_TOOLS: '1' } : {}),
  }
}

/** Launches the tunnel and relays and returns them at once, so the caller owns them before waiting. */
function startVmChildren(plan, { launch, execPath, repository, baseEnv }) {
  const relay = join(repository, 'tooling/deployment/bridge/relay.mjs')
  const relayArgs = [relay, plan.name, plan.port, plan.guestDir, plan.image]
  const neverReady = () => false
  const [tunnelName, claudeName, codexName] = VM_CHILD_NAMES
  return [
    launch(
      tunnelName,
      'ssh',
      tunnelArgs(plan, baseEnv),
      { cwd: repository, env: baseEnv },
      neverReady,
    ),
    launch(
      claudeName,
      execPath,
      relayArgs,
      { cwd: repository, env: relayEnv(plan, baseEnv, 'INTAKE_VM_CLAUDE_SUBSCRIPTION') },
      neverReady,
    ),
    launch(
      codexName,
      execPath,
      relayArgs,
      { cwd: repository, env: relayEnv(plan, baseEnv, 'INTAKE_VM_CODEX_SUBSCRIPTION') },
      neverReady,
    ),
  ]
}

/** Fails startup, by name, when a tunnel or relay exits within the settle window. */
async function confirmVmChildren(items, { settleMs = CHILD_SETTLE_MS, signal } = {}) {
  const settleTimer = new AbortController()
  const settleSignal = signal ? AbortSignal.any([signal, settleTimer.signal]) : settleTimer.signal
  const firstExit = Promise.race(items.map((item) => item.exited.then(() => item)))
  const settled = delay(settleMs, null, { signal: settleSignal })
  let stopped
  try {
    stopped = await Promise.race([firstExit, settled])
  } finally {
    settleTimer.abort()
    settled.catch(() => {})
  }
  if (stopped) {
    throw new Error(`${stopped.name}_stopped_during_startup`)
  }
}

module.exports = {
  vmRunning,
  startVm,
  stopVm,
  shouldStopVm,
  startVmChildren,
  confirmVmChildren,
  VM_CHILD_NAMES,
}
