const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const {
  guardVmStop,
  finishVm,
  ensureVmRunning,
  runCommand,
  vmRunning,
  startVm,
  stopVm,
  shouldStopVm,
  startVmChildren,
  confirmVmChildren,
  VM_CHILD_NAMES,
} = require('../dev/vm.cjs')

const PLAN = {
  name: 'bench-agent-test',
  guestDir: '/var/tmp/bench-paired',
  image: 'bench-intake-runner:personal-test',
  port: '14313',
  tools: true,
  keepRunning: false,
}
const CONTEXT = {
  execPath: '/opt/node/bin/node',
  repository: '/checkout',
  baseEnv: { PATH: '/usr/bin', HOME: '/home/dev' },
}

function recordingExec(results = {}) {
  const calls = []
  const exec = async (command, args, options) => {
    calls.push({ command, args, options })
    const key = `${command} ${args[0]}`
    const result = results[key]
    if (result instanceof Error) {
      throw result
    }
    return result ?? ''
  }
  return { exec, calls }
}

function fakeLaunch() {
  const launched = []
  const launch = (name, command, args, options) => {
    let finish
    const exited = new Promise((resolve) => {
      finish = resolve
    })
    const item = {
      name,
      command,
      args,
      options,
      exited,
      terminated: [],
      finish,
      terminate(signal = 'SIGTERM') {
        item.terminated.push(signal)
      },
    }
    launched.push(item)
    return item
  }
  return { launch, launched }
}

test('the VM status comes from limactl list for the named instance', async () => {
  const running = recordingExec({ 'limactl list': 'Running\n' })
  assert.equal(await vmRunning(PLAN, { exec: running.exec }), true)
  assert.deepEqual(running.calls[0].args, ['list', '--format', '{{.Status}}', 'bench-agent-test'])
  const stopped = recordingExec({ 'limactl list': 'Stopped\n' })
  assert.equal(await vmRunning(PLAN, { exec: stopped.exec }), false)
})

test('an unknown or unreadable instance fails before anything starts', async () => {
  const missing = recordingExec({ 'limactl list': '' })
  await assert.rejects(vmRunning(PLAN, { exec: missing.exec }), { message: 'vm_start_failed' })
  const broken = recordingExec({ 'limactl list': new Error('spawn limactl ENOENT') })
  await assert.rejects(vmRunning(PLAN, { exec: broken.exec }), { message: 'vm_start_failed' })
})

test('booting starts the named instance without a TTY, bounded and cancellable', async () => {
  const { exec, calls } = recordingExec()
  const controller = new AbortController()
  await startVm(PLAN, { exec, signal: controller.signal })
  assert.equal(calls[0].command, 'limactl')
  assert.deepEqual(calls[0].args, ['start', '--tty=false', 'bench-agent-test'])
  assert.equal(calls[0].options.signal, controller.signal)
  assert.ok(calls[0].options.timeout >= 60000)
})

test('a failed boot reports vm_start_failed', async () => {
  const { exec } = recordingExec({ 'limactl start': new Error('exit 1') })
  await assert.rejects(startVm(PLAN, { exec }), { message: 'vm_start_failed' })
})

test('the VM is stopped only when this run booted it and it is not kept', () => {
  assert.equal(shouldStopVm(PLAN, true), true)
  assert.equal(shouldStopVm(PLAN, false), false)
  assert.equal(shouldStopVm({ ...PLAN, keepRunning: true }, true), false)
  assert.equal(shouldStopVm({ ...PLAN, keepRunning: true }, false), false)
})

test('stopping runs limactl stop and reports a failure without the command output', async () => {
  const ok = recordingExec()
  await stopVm(PLAN, { exec: ok.exec })
  assert.deepEqual(ok.calls[0].args, ['stop', 'bench-agent-test'])
  const failing = recordingExec({ 'limactl stop': new Error('exit 1: private detail') })
  await assert.rejects(stopVm(PLAN, { exec: failing.exec }), { message: 'vm_stop_failed' })
})

test('the tunnel and one relay per provider start with tools', () => {
  const { launch, launched } = fakeLaunch()
  const items = startVmChildren(PLAN, { ...CONTEXT, launch })
  assert.deepEqual(
    items.map((item) => item.name),
    VM_CHILD_NAMES,
  )

  const [tunnel, claude, codex] = launched
  assert.equal(tunnel.command, 'ssh')
  assert.deepEqual(tunnel.args, [
    '-NT',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'ControlPath=none',
    '-F',
    '/home/dev/.lima/bench-agent-test/ssh.config',
    '-L',
    '127.0.0.1:14315:127.0.0.1:14315',
    '-L',
    '127.0.0.1:14317:127.0.0.1:14317',
    'lima-bench-agent-test',
  ])

  for (const relay of [claude, codex]) {
    assert.equal(relay.command, '/opt/node/bin/node')
    assert.deepEqual(relay.args, [
      '/checkout/tooling/deployment/bridge/relay.mjs',
      'bench-agent-test',
      '14313',
      '/var/tmp/bench-paired',
      'bench-intake-runner:personal-test',
    ])
    assert.equal(relay.options.cwd, '/checkout')
    assert.equal(relay.options.env.INTAKE_VM_BUILTIN_TOOLS, '1')
    assert.equal(relay.options.env.PATH, '/usr/bin')
  }
  assert.equal(claude.options.env.INTAKE_VM_CLAUDE_SUBSCRIPTION, '1')
  assert.equal(claude.options.env.INTAKE_VM_CODEX_SUBSCRIPTION, undefined)
  assert.equal(codex.options.env.INTAKE_VM_CODEX_SUBSCRIPTION, '1')
  assert.equal(codex.options.env.INTAKE_VM_CLAUDE_SUBSCRIPTION, undefined)
})

test('relays start without tools when tools are off, and honour LIMA_HOME', () => {
  const { launch, launched } = fakeLaunch()
  startVmChildren(
    { ...PLAN, tools: false },
    { ...CONTEXT, baseEnv: { ...CONTEXT.baseEnv, LIMA_HOME: '/lima' }, launch },
  )
  const [tunnel, claude, codex] = launched
  assert.ok(tunnel.args.includes('/lima/bench-agent-test/ssh.config'))
  for (const relay of [claude, codex]) {
    assert.equal(relay.options.env.INTAKE_VM_BUILTIN_TOOLS, undefined)
    assert.equal(relay.options.env.LIMA_HOME, '/lima')
  }
})

test('children that stay up through the settle window are confirmed', async () => {
  const { launch } = fakeLaunch()
  const items = startVmChildren(PLAN, { ...CONTEXT, launch })
  await confirmVmChildren(items, { settleMs: 5 })
})

test('a child that exits during the settle window fails startup by name', async () => {
  const { launch, launched } = fakeLaunch()
  const items = startVmChildren(PLAN, { ...CONTEXT, launch })
  launched[0].finish({ code: 255, signal: null })
  await assert.rejects(confirmVmChildren(items, { settleMs: 50 }), {
    message: 'vm-tunnel_stopped_during_startup',
  })
})

test('confirming stops waiting when startup is cancelled', async () => {
  const { launch } = fakeLaunch()
  const items = startVmChildren(PLAN, { ...CONTEXT, launch })
  const controller = new AbortController()
  const waiting = confirmVmChildren(items, { settleMs: 10000, signal: controller.signal })
  controller.abort()
  await assert.rejects(waiting)
})

test('the status read is cancellable', async () => {
  const { exec, calls } = recordingExec({ 'limactl list': 'Running\n' })
  const controller = new AbortController()
  await vmRunning(PLAN, { exec, signal: controller.signal })
  assert.equal(calls[0].options.signal, controller.signal)
})

test('a running VM is not booted and not marked as booted', async () => {
  const { exec, calls } = recordingExec({ 'limactl list': 'Running\n' })
  let marked = false
  const booted = await ensureVmRunning(PLAN, { exec, onBoot: () => (marked = true) })
  assert.equal(booted, false)
  assert.equal(marked, false)
  assert.deepEqual(
    calls.map((call) => call.args[0]),
    ['list'],
  )
})

test('a stopped VM is marked as booted before the boot starts', async () => {
  const order = []
  const exec = async (command, args) => {
    order.push(args[0])
    return args[0] === 'list' ? 'Stopped\n' : ''
  }
  const booted = await ensureVmRunning(PLAN, { exec, onBoot: () => order.push('marked') })
  assert.equal(booted, true)
  assert.deepEqual(order, ['list', 'marked', 'start'])
})

test('a boot cancelled after the status read is never started or marked', async () => {
  const controller = new AbortController()
  const order = []
  const exec = async (command, args) => {
    order.push(args[0])
    controller.abort()
    return 'Stopped\n'
  }
  await assert.rejects(
    ensureVmRunning(PLAN, { exec, signal: controller.signal, onBoot: () => order.push('marked') }),
  )
  assert.deepEqual(order, ['list'])
})

test('commands run in their own process group, so a terminal Ctrl-C cannot interrupt them', async () => {
  const output = await runCommand(process.execPath, [
    '-e',
    "process.stdout.write(require('node:child_process').execFileSync('ps', ['-o', 'pgid=', '-p', String(process.pid)]).toString().trim() + ' ' + process.pid)",
  ])
  const [group, pid] = output.trim().split(' ')
  assert.equal(group, pid)
})

test('commands fail on a non-zero exit, a timeout or cancellation', async () => {
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(3)']))
  await assert.rejects(
    runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { timeout: 100 }),
  )
  const controller = new AbortController()
  const waiting = runCommand(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], {
    signal: controller.signal,
  })
  controller.abort()
  await assert.rejects(waiting)
})

test('commands get only the environment they are given', async () => {
  const output = await runCommand(
    process.execPath,
    [
      '-e',
      'process.stdout.write(JSON.stringify([process.env.KEPT, process.env.SECRET_FROM_SHELL]))',
    ],
    { env: { PATH: process.env.PATH, KEPT: 'yes' } },
  )
  assert.deepEqual(JSON.parse(output), ['yes', null])
})

test('a command that ignores SIGTERM is killed after the grace', async () => {
  const started = Date.now()
  await assert.rejects(
    runCommand(
      process.execPath,
      ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      { timeout: 100, killGraceMs: 200 },
    ),
  )
  assert.ok(Date.now() - started < 5000)
})

test('the VM commands pass the environment through', async () => {
  const { exec, calls } = recordingExec({ 'limactl list': 'Stopped\n' })
  const env = { PATH: '/usr/bin' }
  await ensureVmRunning(PLAN, { exec, env, onBoot: () => {} })
  await stopVm(PLAN, { exec, env })
  assert.deepEqual(
    calls.map((call) => call.options.env),
    [env, env, env],
  )
})

function recordingWrites() {
  const lines = { out: [], err: [] }
  return {
    lines,
    write: { out: (text) => lines.out.push(text), err: (text) => lines.err.push(text) },
  }
}

test('finishing stops a VM this run booted, including after a failed startup', async () => {
  const { exec, calls } = recordingExec()
  const { lines, write } = recordingWrites()
  assert.equal(await finishVm(PLAN, true, { exec, write }), true)
  assert.deepEqual(
    calls.map((call) => call.args),
    [['stop', 'bench-agent-test']],
  )
  assert.deepEqual(lines.out, ['Stopping VM bench-agent-test.\n'])
  assert.deepEqual(lines.err, [])
})

test('finishing leaves a VM alone when this run did not boot it or it is kept', async () => {
  for (const [plan, booted] of [
    [PLAN, false],
    [{ ...PLAN, keepRunning: true }, true],
  ]) {
    const { exec, calls } = recordingExec()
    const { lines, write } = recordingWrites()
    assert.equal(await finishVm(plan, booted, { exec, write }), true)
    assert.equal(calls.length, 0)
    assert.deepEqual(lines.out, [])
  }
})

test('a failed stop is reported with the command to run and never throws', async () => {
  const { exec } = recordingExec({ 'limactl stop': new Error('exit 1: private detail') })
  const { lines, write } = recordingWrites()
  assert.equal(await finishVm(PLAN, true, { exec, write }), false)
  assert.deepEqual(lines.err, ['vm_stop_failed: run limactl stop bench-agent-test\n'])
})

test('command errors are forwarded line by line', async () => {
  const lines = []
  await assert.rejects(
    runCommand(
      process.execPath,
      ['-e', "process.stderr.write('instance not found\\nsecond line\\n'); process.exit(1)"],
      { stderr: (line) => lines.push(line) },
    ),
  )
  assert.deepEqual(lines, ['instance not found', 'second line'])
})

test('booting forwards limactl messages with a prefix', async () => {
  const { lines, write } = recordingWrites()
  const exec = async (command, args, options) => {
    options.stderr?.(`starting ${args[0]}`)
    return args[0] === 'list' ? 'Stopped\n' : ''
  }
  await ensureVmRunning(PLAN, { exec, write, onBoot: () => {} })
  assert.deepEqual(lines.err, ['[limactl] starting list\n', '[limactl] starting start\n'])
})

function signalSource() {
  const source = new EventEmitter()
  return {
    source,
    on: (name, handler) => source.on(name, handler),
    off: (name, handler) => source.off(name, handler),
  }
}

test('a second Ctrl-C while the VM still needs stopping is held, a third forces the quit', () => {
  const { source, on, off } = signalSource()
  const { lines, write } = recordingWrites()
  const exits = []
  const release = guardVmStop(PLAN, true, { on, off, write, exit: (code) => exits.push(code) })
  source.emit('SIGINT', 'SIGINT')
  assert.deepEqual(exits, [])
  assert.match(lines.err[0], /Stopping the app and VM bench-agent-test first/)
  source.emit('SIGINT', 'SIGINT')
  assert.deepEqual(exits, [130])
  release()
  assert.equal(source.listenerCount('SIGINT'), 0)
  assert.equal(source.listenerCount('SIGTERM'), 0)
  assert.equal(source.listenerCount('SIGHUP'), 0)
})

test('no guard is installed when the VM will not be stopped', () => {
  for (const [plan, booted] of [
    [PLAN, false],
    [{ ...PLAN, keepRunning: true }, true],
  ]) {
    const { source, on, off } = signalSource()
    const release = guardVmStop(plan, booted, { on, off, write: recordingWrites().write })
    assert.equal(source.listenerCount('SIGINT'), 0)
    release()
  }
})

test('a command run with discarded output holds no pipe to the launcher', async () => {
  // Node connects child output with sockets on macOS and pipes elsewhere; neither may remain.
  const check =
    "const { fstatSync } = require('node:fs'); " +
    'const piped = [1, 2].some((fd) => fstatSync(fd).isFIFO() || fstatSync(fd).isSocket()); ' +
    'process.exit(piped ? 1 : 0)'
  await runCommand(process.execPath, ['-e', check], { discardOutput: true })
})

test('stopping the VM discards its output, so it survives the launcher exiting', async () => {
  const { exec, calls } = recordingExec()
  await stopVm(PLAN, { exec })
  assert.equal(calls[0].options.discardOutput, true)
  assert.equal(calls[0].options.stderr, undefined)
})

test('a repeated stop signal other than Ctrl-C quits with its own status and no Ctrl-C hint', () => {
  const { source, on, off } = signalSource()
  const { lines, write } = recordingWrites()
  const exits = []
  const release = guardVmStop(PLAN, true, { on, off, write, exit: (code) => exits.push(code) })
  source.emit('SIGTERM', 'SIGTERM')
  assert.deepEqual(exits, [])
  assert.doesNotMatch(lines.err.join(''), /Ctrl-C/)
  source.emit('SIGTERM', 'SIGTERM')
  assert.deepEqual(exits, [143])
  release()
})

test('the tunnel forwards the ports the dev UI proxies', () => {
  const { CREDENTIAL_PORTS } = require('../dev/vm.cjs')
  const ui = require('node:fs').readFileSync(require.resolve('../dev/ui.cjs'), 'utf8')
  assert.match(ui, /CREDENTIAL_PORTS\.claude/)
  assert.match(ui, /CREDENTIAL_PORTS\.codex/)
  assert.deepEqual(CREDENTIAL_PORTS, { claude: 14315, codex: 14317 })
})
