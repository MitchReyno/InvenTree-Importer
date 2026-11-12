const { spawnSync } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { readFile, open, unlink, rename, link } = require('node:fs/promises')
const { join } = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')

// Shorter than the running session's stop grace so a wedged orphan cannot hold the next start.
const STOP_GRACE_MS = 5000
const KILL_GRACE_MS = 2000

const LEGACY_COMMAND_FRAGMENTS = {
  ui: 'tooling/dev/ui.cjs',
  tailnet: 'tooling/dev/tailnet.cjs',
  api: 'src/main.ts',
  media: 'src/dev/media-main.ts',
  inventory: 'src/dev/fake-main.ts',
  apply: 'src/review/runner-main.ts',
  processing: 'src/dev/processing-main.ts',
  agents: 'src/agents/',
}

function held(cause) {
  const error = new Error('development_supervisor_lock_exists_inspect_owned_state')
  if (cause) error.cause = cause
  return error
}

function readPs(pid, field) {
  const result = spawnSync('ps', ['-p', String(pid), '-o', `${field}=`], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LC_ALL: 'C' },
  })
  if (result.error || result.status !== 0) return null
  const text = result.stdout.trim()
  return text.length > 0 ? text : null
}

/** @returns {null | { startedAt: string | null, command: string | null, ppid: number | null, unreadable: boolean }} */
function inspectProcess(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null
  try {
    process.kill(pid, 0)
  } catch (error) {
    if (error.code === 'ESRCH') return null
    return { startedAt: null, command: null, ppid: null, unreadable: true }
  }
  const startedAt = readPs(pid, 'lstart')
  const command = readPs(pid, 'command')
  const ppidText = readPs(pid, 'ppid')
  const ppid = ppidText === null ? null : Number(ppidText)
  if (!startedAt || command === null || !Number.isInteger(ppid)) {
    return { startedAt, command, ppid: Number.isInteger(ppid) ? ppid : null, unreadable: true }
  }
  return { startedAt, command, ppid, unreadable: false }
}

function processStartedAt(pid) {
  const live = inspectProcess(pid)
  if (!live || live.unreadable || !live.startedAt) return undefined
  return live.startedAt
}

function lockRecord(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || !Number.isInteger(parsed.pid) || parsed.pid <= 0) return null
  if (typeof parsed.nonce !== 'string' || parsed.nonce.length === 0) return null
  const startedAt =
    typeof parsed.startedAt === 'string' && parsed.startedAt.length > 0 ? parsed.startedAt : null
  return { pid: parsed.pid, nonce: parsed.nonce, startedAt }
}

function childRecord(value) {
  if (!value || typeof value !== 'object') return null
  if (!Number.isInteger(value.pid) || value.pid <= 0) return null
  if (typeof value.name !== 'string' || value.name.length === 0) return null
  return {
    name: value.name,
    pid: value.pid,
    startedAt:
      typeof value.startedAt === 'string' && value.startedAt.length > 0 ? value.startedAt : null,
    group: value.group === true,
  }
}

function ownerLive(recorded, live) {
  if (!live) return false
  if (live.unreadable || !live.startedAt) return true
  if (!recorded.startedAt) return true
  return live.startedAt === recorded.startedAt
}

function classifyChild(child, live, supervisorPid) {
  if (!live) return 'gone'
  if (live.unreadable || !live.startedAt || live.command === null || !Number.isInteger(live.ppid)) {
    return 'unknown'
  }
  if (child.startedAt) {
    return live.startedAt === child.startedAt ? 'owned' : 'reused'
  }
  const fragment = LEGACY_COMMAND_FRAGMENTS[child.name] ?? null
  if (!fragment || !live.command.includes(fragment)) return 'unknown'
  if (live.ppid === 1 || live.ppid === supervisorPid) return 'owned'
  return 'unknown'
}

async function readChildren(root) {
  let text
  try {
    text = await readFile(join(root, 'running.json'), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw held(error)
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw held(error)
  }
  if (!parsed || !Array.isArray(parsed.children)) throw held()
  const children = []
  for (const entry of parsed.children) {
    const child = childRecord(entry)
    if (!child) throw held()
    children.push(child)
  }
  return children
}

function signalOwned(children, signal, name) {
  for (const child of children) {
    try {
      signal(child.group ? -child.pid : child.pid, name)
    } catch (error) {
      if (error.code !== 'ESRCH') throw held(error)
    }
  }
}

async function waitUntilGone(children, inspect, supervisorPid, graceMs, wait) {
  const deadline = Date.now() + graceMs
  while (true) {
    const remaining = []
    for (const child of children) {
      const kind = classifyChild(child, await inspect(child.pid), supervisorPid)
      // An unreadable pid is not proof that the process exited.
      if (kind === 'owned' || kind === 'unknown') remaining.push({ child, kind })
    }
    if (remaining.length === 0) return []
    if (Date.now() >= deadline) return remaining
    await wait(50)
  }
}

async function stopOwned(children, inspect, supervisorPid, signal, wait, graceMs, killGraceMs) {
  signalOwned(children, signal, 'SIGTERM')
  let remaining = await waitUntilGone(children, inspect, supervisorPid, graceMs, wait)
  if (remaining.length === 0) return
  const killable = remaining.filter((item) => item.kind === 'owned').map((item) => item.child)
  if (killable.length > 0) signalOwned(killable, signal, 'SIGKILL')
  remaining = await waitUntilGone(
    remaining.map((item) => item.child),
    inspect,
    supervisorPid,
    killGraceMs,
    wait,
  )
  if (remaining.length > 0) throw held()
}

async function readLock(lockPath) {
  try {
    return lockRecord(await readFile(lockPath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return undefined
    throw held(error)
  }
}

async function takeStaleLock(lockPath, recorded, inspect, hooks) {
  const grave = `${lockPath}.${randomUUID()}.stale`
  if (hooks.beforeMove) await hooks.beforeMove()
  try {
    await rename(lockPath, grave)
  } catch (error) {
    if (error.code === 'ENOENT') return
    throw held(error)
  }
  let moved = null
  try {
    moved = lockRecord(await readFile(grave, 'utf8'))
  } catch {
    moved = null
  }
  const live = moved ? await inspect(moved.pid) : null
  const stillStale = moved && moved.nonce === recorded.nonce && !ownerLive(moved, live)
  if (!stillStale) {
    // link fails with EEXIST instead of replacing a lock created while this one was aside.
    if (hooks.beforeRestore) await hooks.beforeRestore()
    try {
      await link(grave, lockPath)
    } catch (error) {
      throw held(error)
    }
    await unlink(grave)
    throw held()
  }
  await unlink(grave)
}

async function reclaim(lockPath, root, inspect, signal, wait, graceMs, killGraceMs, log, hooks) {
  const recorded = await readLock(lockPath)
  if (recorded === undefined) return
  if (!recorded) throw held()
  const supervisor = await inspect(recorded.pid)
  if (ownerLive(recorded, supervisor)) {
    log(`A development supervisor is still running (pid ${recorded.pid}).`)
    throw held()
  }
  const children = await readChildren(root)
  const owned = []
  for (const child of children) {
    const kind = classifyChild(child, await inspect(child.pid), recorded.pid)
    if (kind === 'unknown') {
      log(
        `A stale development supervisor lock names a live process that could not be identified (pid ${child.pid}).`,
      )
      throw held()
    }
    if (kind === 'owned') owned.push(child)
  }
  if (owned.length > 0) {
    log(`Stopping orphaned development processes: ${owned.map((child) => child.pid).join(', ')}.`)
    await stopOwned(owned, inspect, recorded.pid, signal, wait, graceMs, killGraceMs)
  }
  const current = await readLock(lockPath)
  if (current === undefined) return
  if (
    !current ||
    current.nonce !== recorded.nonce ||
    ownerLive(current, await inspect(current.pid))
  ) {
    throw held()
  }
  await takeStaleLock(lockPath, recorded, inspect, hooks)
  log('Removed a stale development supervisor lock.')
}

async function createLock(lockPath, pid, inspect) {
  const self = await inspect(pid)
  if (!self || self.unreadable || !self.startedAt) {
    throw new Error('development_supervisor_identity_unreadable')
  }
  const nonce = randomUUID()
  const handle = await open(lockPath, 'wx', 0o600)
  try {
    await handle.writeFile(JSON.stringify({ pid, nonce, startedAt: self.startedAt }))
  } catch (error) {
    await handle.close()
    await unlink(lockPath).catch(() => {})
    throw error
  }
  await handle.close()
  let released = false
  return async function releaseSupervisorLock() {
    if (released) return
    let text
    try {
      text = await readFile(lockPath, 'utf8')
    } catch (error) {
      if (error.code === 'ENOENT') {
        released = true
        return
      }
      throw error
    }
    const owned = lockRecord(text)
    if (!owned || owned.pid !== pid || owned.nonce !== nonce) {
      throw new Error('development_lock_owner_changed')
    }
    await unlink(lockPath)
    released = true
  }
}

async function claimSupervisorLock(root, options = {}) {
  const lockPath = join(root, 'supervisor.lock')
  const pid = options.pid ?? process.pid
  const inspect = options.inspect ?? inspectProcess
  const signal = options.signal ?? ((target, name) => process.kill(target, name))
  const wait = options.delay ?? delay
  const graceMs = options.graceMs ?? STOP_GRACE_MS
  const killGraceMs = options.killGraceMs ?? KILL_GRACE_MS
  const log = options.log ?? ((line) => process.stderr.write(`${line}\n`))
  const hooks = {
    beforeMove: options.beforeMove,
    beforeRestore: options.beforeRestore,
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await createLock(lockPath, pid, inspect)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      await reclaim(lockPath, root, inspect, signal, wait, graceMs, killGraceMs, log, hooks)
    }
  }
  throw held()
}

module.exports = {
  claimSupervisorLock,
  inspectProcess,
  processStartedAt,
}
