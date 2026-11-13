/**
 * The agent VM's side of `pnpm dev`: boots and stops the Lima instance, and launches the credential
 * tunnel and one relay per provider. Commands and `launch` are passed in so tests can substitute them.
 */
const { spawn } = require('node:child_process')
const { join } = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')

/** Names the launcher keeps through source reloads and stops the app for when they exit. */
const VM_CHILD_NAMES = ['vm-tunnel', 'vm-relay-claude', 'vm-relay-codex']

/** A cold Lima boot takes about 36 s on an M1; this allows for a slow first boot or busy host. */
const VM_BOOT_TIMEOUT_MS = 180_000
const VM_STATUS_TIMEOUT_MS = 15_000
const VM_STOP_TIMEOUT_MS = 60_000
/** Healthy tunnels and relays print nothing; a bad port or argument makes them exit within this. */
const CHILD_SETTLE_MS = 1000
/** How long a command gets to exit after SIGTERM before its group is killed. */
const KILL_GRACE_MS = 5000

/** The loopback ports the dev UI proxies to the guest's Claude and Codex credential services. */
const CREDENTIAL_PORTS = [14315, 14317]

/**
 * Runs a command in its own process group and resolves with its standard output, so a terminal
 * Ctrl-C cannot interrupt it. With `discardOutput` it holds no pipe to the launcher either, and
 * finishes even if the launcher quits.
 */
function runCommand(
  command,
  args,
  { timeout, signal, env, stderr, discardOutput = false, killGraceMs = KILL_GRACE_MS } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const child = spawn(command, args, {
      detached: true,
      env,
      stdio: discardOutput ? 'ignore' : ['ignore', 'pipe', stderr ? 'pipe' : 'ignore'],
    })
    let stdout = ''
    let timer
    let killTimer

    const signalGroup = (name) => {
      try {
        process.kill(-child.pid, name)
      } catch {}
    }

    const terminate = () => {
      signalGroup('SIGTERM')
      killTimer ??= setTimeout(() => signalGroup('SIGKILL'), killGraceMs)
    }

    if (timeout) {
      timer = setTimeout(terminate, timeout)
    }
    signal?.addEventListener('abort', terminate, { once: true })
    child.stdout?.on('data', (bytes) => {
      stdout += bytes
    })
    let partial = ''
    child.stderr?.on('data', (bytes) => {
      const lines = (partial + bytes).split('\n')
      partial = lines.pop()
      for (const line of lines) {
        stderr(line)
      }
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (partial) {
        stderr(partial)
      }
      clearTimeout(timer)
      clearTimeout(killTimer)
      signal?.removeEventListener('abort', terminate)
      if (code === 0) {
        resolve(stdout)
      } else {
        reject(new Error('command_failed'))
      }
    })
  })
}

const defaultExec = runCommand

const STANDARD_WRITE = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
}

/** Lima's own messages, so a failed or slow boot shows its cause and progress. */
function limaMessages(write) {
  return (line) => write.err(`[limactl] ${line}\n`)
}

async function vmRunning(plan, { exec = defaultExec, signal, env, write = STANDARD_WRITE } = {}) {
  let status
  try {
    status = await exec('limactl', ['list', '--format', '{{.Status}}', plan.name], {
      timeout: VM_STATUS_TIMEOUT_MS,
      signal,
      env,
      stderr: limaMessages(write),
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

async function startVm(plan, { exec = defaultExec, signal, env, write = STANDARD_WRITE } = {}) {
  try {
    await exec('limactl', ['start', '--tty=false', plan.name], {
      timeout: VM_BOOT_TIMEOUT_MS,
      signal,
      env,
      stderr: limaMessages(write),
    })
  } catch {
    throw new Error('vm_start_failed')
  }
}

/**
 * Boots the VM when it is not running. `onBoot` runs before the boot starts, so a cancelled or failed
 * boot is still treated as this run's; callers record the boot there. Resolves true when it booted.
 */
async function ensureVmRunning(plan, { exec = defaultExec, signal, env, write, onBoot }) {
  const running = await vmRunning(plan, { exec, signal, env, write })
  signal?.throwIfAborted()
  if (running) {
    return false
  }
  onBoot()
  await startVm(plan, { exec, signal, env, write })
  return true
}

/** Only a VM this run booted is stopped: one that was already running may be in use elsewhere. */
function shouldStopVm(plan, booted) {
  return booted && !plan.keepRunning
}

async function stopVm(plan, { exec = defaultExec, env } = {}) {
  try {
    // No pipes back: once signalled, the stop must not die writing to a launcher that has quit.
    await exec('limactl', ['stop', plan.name], {
      timeout: VM_STOP_TIMEOUT_MS,
      env,
      discardOutput: true,
    })
  } catch {
    throw new Error('vm_stop_failed')
  }
}

/**
 * The VM step of shutdown: stops a VM this run booted unless it is kept. Never throws, so the
 * launcher's lock release after it always runs; a failed stop names the command to run.
 */
async function finishVm(plan, booted, { exec = defaultExec, env, write = STANDARD_WRITE } = {}) {
  if (!shouldStopVm(plan, booted)) {
    return
  }
  write.out(`Stopping VM ${plan.name}.\n`)
  try {
    await stopVm(plan, { exec, env })
  } catch {
    write.err(`vm_stop_failed: run limactl stop ${plan.name}\n`)
  }
}

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

/**
 * While shutdown still has a VM to stop, holds the next Ctrl-C (or other stop signal) so the stop is
 * not skipped; the one after that quits at once, so a stop not yet started is skipped. Returns the release.
 */
function guardVmStop(
  plan,
  booted,
  {
    on = (name, handler) => process.on(name, handler),
    off = (name, handler) => process.off(name, handler),
    write = STANDARD_WRITE,
    exit = (code) => process.exit(code),
  } = {},
) {
  if (!shouldStopVm(plan, booted)) {
    return () => {}
  }
  let held = false

  const hold = () => {
    if (held) {
      exit(130)
      return
    }
    held = true
    write.err(
      `Stopping the app and VM ${plan.name} first; press Ctrl-C again to quit without waiting.\n`,
    )
  }

  for (const name of SHUTDOWN_SIGNALS) {
    on(name, hold)
  }
  return () => {
    for (const name of SHUTDOWN_SIGNALS) {
      off(name, hold)
    }
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
  runCommand,
  ensureVmRunning,
  vmRunning,
  startVm,
  stopVm,
  shouldStopVm,
  finishVm,
  guardVmStop,
  startVmChildren,
  confirmVmChildren,
  VM_CHILD_NAMES,
}
