const test = require('node:test')
const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { mkdtemp, readFile, readdir, rm, stat, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { setTimeout: delay } = require('node:timers/promises')
const {
  claimSupervisorLock,
  inspectProcess,
  processStartedAt,
} = require('../dev/supervisor-lock.cjs')
const { bindSessionEnd, finishOwnedRun } = require('../dev/session.cjs')

async function directory() {
  return mkdtemp(join(tmpdir(), 'dev-supervisor-'))
}

async function writeJson(file, value) {
  await writeFile(file, JSON.stringify(value), { mode: 0o600 })
}

function live(startedAt, command, ppid) {
  return { startedAt, command, ppid, unreadable: false }
}

test('a new lock records the caller pid, nonce and start time and releases once', async () => {
  const root = await directory()
  const table = new Map([[42, live('Thu Nov 12 00:00:00 2026', 'node tooling/dev.cjs', 1)]])
  const release = await claimSupervisorLock(root, {
    pid: 42,
    inspect: async (pid) => table.get(pid) ?? null,
    log() {},
  })
  const lock = JSON.parse(await readFile(join(root, 'supervisor.lock'), 'utf8'))
  assert.equal(lock.pid, 42)
  assert.equal(lock.startedAt, 'Thu Nov 12 00:00:00 2026')
  assert.equal(typeof lock.nonce, 'string')
  assert.equal((await stat(join(root, 'supervisor.lock'))).mode & 0o777, 0o600)
  await release()
  await release()
  await assert.rejects(readFile(join(root, 'supervisor.lock')), { code: 'ENOENT' })
  await rm(root, { recursive: true })
})

test('a live supervisor keeps the lock and a second start does not signal anyone', async () => {
  const root = await directory()
  const table = new Map([
    [42, live('start', 'node tooling/dev.cjs', 7)],
    [99, live('other', 'node tooling/dev.cjs', 7)],
  ])
  const signals = []
  const first = await claimSupervisorLock(root, {
    pid: 42,
    inspect: async (pid) => table.get(pid) ?? null,
    signal(pid, name) {
      signals.push([pid, name])
    },
    log() {},
  })
  await assert.rejects(
    claimSupervisorLock(root, {
      pid: 99,
      inspect: async (pid) => table.get(pid) ?? null,
      signal(pid, name) {
        signals.push([pid, name])
      },
      log() {},
    }),
    { message: 'development_supervisor_lock_exists_inspect_owned_state' },
  )
  const lock = JSON.parse(await readFile(join(root, 'supervisor.lock'), 'utf8'))
  assert.equal(lock.pid, 42)
  assert.deepEqual(signals, [])
  await first()
  await rm(root, { recursive: true })
})

test('a dead supervisor is replaced without signalling a reused child pid', async () => {
  const root = await directory()
  await writeJson(join(root, 'supervisor.lock'), {
    pid: 42,
    nonce: 'old',
    startedAt: 'old-start',
  })
  await writeJson(join(root, 'running.json'), {
    supervisor: 42,
    origin: 'http://127.0.0.1:4330',
    children: [{ name: 'api', pid: 70, startedAt: 'child-start' }],
  })
  const signals = []
  const release = await claimSupervisorLock(root, {
    pid: 99,
    inspect: async (pid) => {
      if (pid === 42) return null
      if (pid === 70) return live('different-start', 'node src/main.ts', 1)
      if (pid === 99) return live('new-start', 'node tooling/dev.cjs', 1)
      return null
    },
    signal(pid, name) {
      signals.push([pid, name])
    },
    log() {},
  })
  const lock = JSON.parse(await readFile(join(root, 'supervisor.lock'), 'utf8'))
  assert.equal(lock.pid, 99)
  assert.equal(lock.startedAt, 'new-start')
  assert.deepEqual(signals, [])
  assert.equal(
    (await readdir(root)).some((name) => name.endsWith('.stale')),
    false,
  )
  await release()
  await rm(root, { recursive: true })
})

test('an unidentified legacy child keeps the lock and nothing is signalled', async () => {
  const root = await directory()
  await writeJson(join(root, 'supervisor.lock'), { pid: 42, nonce: 'old', startedAt: 'supervisor' })
  await writeJson(join(root, 'running.json'), {
    supervisor: 42,
    children: [
      { name: 'api', pid: 70, startedAt: 'api-start', group: true },
      { name: 'tailscale-serve', pid: 71 },
    ],
  })
  const signals = []
  await assert.rejects(
    claimSupervisorLock(root, {
      pid: 99,
      inspect: async (pid) => {
        if (pid === 42) return null
        if (pid === 70) return live('api-start', 'node src/main.ts', 1)
        if (pid === 71) return live('serve-start', 'tailscale serve', 1)
        return live('new', 'node tooling/dev.cjs', 1)
      },
      signal(pid, name) {
        signals.push([pid, name])
      },
      log() {},
    }),
    { message: 'development_supervisor_lock_exists_inspect_owned_state' },
  )
  assert.deepEqual(signals, [])
  assert.equal(JSON.parse(await readFile(join(root, 'supervisor.lock'), 'utf8')).nonce, 'old')
  await rm(root, { recursive: true })
})

test('a matched orphan is signalled as a group and then forced when it survives', async () => {
  const root = await directory()
  await writeJson(join(root, 'supervisor.lock'), { pid: 42, nonce: 'old', startedAt: 'supervisor' })
  await writeJson(join(root, 'running.json'), {
    children: [{ name: 'api', pid: 70, startedAt: 'api-start', group: true }],
  })
  const signals = []
  let killed = false
  const release = await claimSupervisorLock(root, {
    pid: 99,
    graceMs: 0,
    killGraceMs: 0,
    delay: async () => {},
    inspect: async (pid) => {
      if (pid === 42) return null
      if (pid === 99) return live('new', 'node tooling/dev.cjs', 1)
      if (pid === 70 && !killed) return live('api-start', 'node src/main.ts', 1)
      return null
    },
    signal(pid, name) {
      signals.push([pid, name])
      if (name === 'SIGKILL') killed = true
    },
    log() {},
  })
  assert.deepEqual(signals, [
    [-70, 'SIGTERM'],
    [-70, 'SIGKILL'],
  ])
  await release()
  await rm(root, { recursive: true })
})

test('a legacy orphan is stopped only when its command and parent still match', async () => {
  const root = await directory()
  await writeJson(join(root, 'supervisor.lock'), { pid: 42, nonce: 'legacy' })
  await writeJson(join(root, 'running.json'), {
    children: [{ name: 'api', pid: 70 }],
  })
  const signals = []
  const release = await claimSupervisorLock(root, {
    pid: 99,
    inspect: async (pid) => {
      if (pid === 42) return null
      if (pid === 99) return live('new', 'node tooling/dev.cjs', 1)
      if (signals.length === 0) return live('whatever', 'node src/main.ts', 1)
      return null
    },
    signal(pid, name) {
      signals.push([pid, name])
    },
    log() {},
  })
  assert.deepEqual(signals, [[70, 'SIGTERM']])
  await release()
  await rm(root, { recursive: true })
})

test('an unreadable lock is left in place', async () => {
  const root = await directory()
  await writeFile(join(root, 'supervisor.lock'), '{', { mode: 0o600 })
  await assert.rejects(
    claimSupervisorLock(root, {
      pid: 99,
      inspect: async () => live('new', 'node tooling/dev.cjs', 1),
      log() {},
    }),
    { message: 'development_supervisor_lock_exists_inspect_owned_state' },
  )
  assert.equal(await readFile(join(root, 'supervisor.lock'), 'utf8'), '{')
  await rm(root, { recursive: true })
})

test('release refuses a lock that was replaced', async () => {
  const root = await directory()
  const release = await claimSupervisorLock(root, {
    pid: 42,
    inspect: async (pid) => (pid === 42 ? live('start', 'node tooling/dev.cjs', 1) : null),
    log() {},
  })
  await writeJson(join(root, 'supervisor.lock'), { pid: 5, nonce: 'other', startedAt: 'start' })
  await assert.rejects(release(), { message: 'development_lock_owner_changed' })
  await rm(root, { recursive: true })
})

test('a real orphan sleep is stopped and the stale lock is replaced', async () => {
  const root = await directory()
  const orphan = spawn('sleep', ['30'], { stdio: 'ignore' })
  await once(orphan, 'spawn')
  const startedAt = processStartedAt(orphan.pid)
  assert.equal(typeof startedAt, 'string')
  assert.match(inspectProcess(orphan.pid).command, /sleep/)
  const gone = spawn('sleep', ['30'], { stdio: 'ignore' })
  await once(gone, 'spawn')
  const dead = gone.pid
  gone.kill('SIGKILL')
  await once(gone, 'exit')
  assert.equal(inspectProcess(dead), null)
  await writeJson(join(root, 'supervisor.lock'), { pid: dead, nonce: 'old', startedAt: 'gone' })
  await writeJson(join(root, 'running.json'), {
    children: [{ name: 'ui', pid: orphan.pid, startedAt }],
  })
  try {
    const release = await claimSupervisorLock(root, { log() {} })
    assert.equal(orphan.exitCode !== null || orphan.signalCode !== null, true)
    const lock = JSON.parse(await readFile(join(root, 'supervisor.lock'), 'utf8'))
    assert.equal(lock.pid, process.pid)
    await release()
  } finally {
    if (orphan.exitCode === null && orphan.signalCode === null) orphan.kill('SIGKILL')
    await rm(root, { recursive: true })
  }
})

test('SIGHUP runs the session stop hook', async () => {
  const root = await directory()
  const marker = join(root, 'marker')
  const ready = join(root, 'ready')
  const child = spawn(
    process.execPath,
    [
      '-e',
      `const { bindSessionEnd } = require(${JSON.stringify(join(__dirname, '../dev/session.cjs'))})
       const { writeFileSync } = require('node:fs')
       bindSessionEnd(() => {
         writeFileSync(process.env.MARKER, 'stopped')
         process.exit(0)
       })
       writeFileSync(process.env.READY, 'ready')
       setInterval(() => {}, 1000)`,
    ],
    {
      env: { PATH: process.env.PATH, MARKER: marker, READY: ready },
      stdio: 'ignore',
    },
  )
  try {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline) {
      try {
        assert.equal(await readFile(ready, 'utf8'), 'ready')
        break
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error('session_hook_exited_before_ready')
        }
        await delay(20)
      }
    }
    assert.equal(await readFile(ready, 'utf8'), 'ready')
    child.kill('SIGHUP')
    const [code] = await once(child, 'exit')
    assert.equal(code, 0)
    assert.equal(await readFile(marker, 'utf8'), 'stopped')
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    await rm(root, { recursive: true })
  }
})

test('a changed parent requests shutdown and an unknown lookup does not', async () => {
  let polls = 0
  let stopped = 0
  const changed = bindSessionEnd(
    () => {
      stopped += 1
    },
    {
      signals: [],
      parentPid: 100,
      intervalMs: 20,
      lookup() {
        polls += 1
        return polls > 1 ? 1 : 100
      },
    },
  )
  try {
    await delay(150)
    assert.equal(stopped, 1)
  } finally {
    changed.close()
  }
  const steady = bindSessionEnd(
    () => {
      stopped += 1
    },
    {
      signals: [],
      parentPid: 100,
      intervalMs: 20,
      lookup() {
        return null
      },
    },
  )
  try {
    await delay(80)
    assert.equal(stopped, 1)
  } finally {
    steady.close()
  }
})

test('an unreadable orphan keeps the lock and is not killed', async () => {
  const root = await directory()
  await writeJson(join(root, 'supervisor.lock'), { pid: 42, nonce: 'old', startedAt: 'supervisor' })
  await writeJson(join(root, 'running.json'), {
    children: [{ name: 'api', pid: 70, startedAt: 'api-start' }],
  })
  const signals = []
  let identified = false
  await assert.rejects(
    claimSupervisorLock(root, {
      pid: 99,
      graceMs: 0,
      killGraceMs: 0,
      delay: async () => {},
      inspect: async (pid) => {
        if (pid === 42) return null
        if (pid === 99) return live('new', 'node tooling/dev.cjs', 1)
        if (!identified) {
          identified = true
          return live('api-start', 'node src/main.ts', 1)
        }
        return { startedAt: null, command: null, ppid: null, unreadable: true }
      },
      signal(pid, name) {
        signals.push([pid, name])
      },
      log() {},
    }),
    { message: 'development_supervisor_lock_exists_inspect_owned_state' },
  )
  assert.deepEqual(signals, [[70, 'SIGTERM']])
  assert.equal(JSON.parse(await readFile(join(root, 'supervisor.lock'), 'utf8')).nonce, 'old')
  await rm(root, { recursive: true })
})

test('restoring a moved lock does not replace one created in the gap', async () => {
  const root = await directory()
  const lock = join(root, 'supervisor.lock')
  await writeJson(lock, { pid: 42, nonce: 'old', startedAt: 'gone' })
  await assert.rejects(
    claimSupervisorLock(root, {
      pid: 99,
      inspect: async (pid) => {
        if (pid === 42) return null
        if (pid === 7) return live('winner', 'node tooling/dev.cjs', 8)
        if (pid === 99) return live('new', 'node tooling/dev.cjs', 1)
        return null
      },
      beforeMove: async () => {
        await writeJson(lock, { pid: 7, nonce: 'moved', startedAt: 'winner' })
      },
      beforeRestore: async () => {
        await writeJson(lock, { pid: 7, nonce: 'winner', startedAt: 'winner' })
      },
      log() {},
    }),
    { message: 'development_supervisor_lock_exists_inspect_owned_state' },
  )
  assert.equal(JSON.parse(await readFile(lock, 'utf8')).nonce, 'winner')
  const graves = (await readdir(root)).filter((name) => name.endsWith('.stale'))
  assert.equal(graves.length, 1)
  assert.equal(JSON.parse(await readFile(join(root, graves[0]), 'utf8')).nonce, 'moved')
  await rm(root, { recursive: true })
})

test('a failed stop forces children down and still lets the caller release the lock', async () => {
  const signals = []
  let released = false
  await assert.rejects(
    async () => {
      try {
        await finishOwnedRun([{ terminate: (name) => signals.push(name) }], async () => {
          throw new Error('owned_app_shutdown_unconfirmed')
        })
      } finally {
        released = true
      }
    },
    { message: 'owned_app_shutdown_unconfirmed' },
  )
  assert.deepEqual(signals, ['SIGKILL'])
  assert.equal(released, true)
})
