const test = require('node:test')
const assert = require('node:assert/strict')
const {
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
