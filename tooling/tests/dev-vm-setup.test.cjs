const test = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtemp, mkdir, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const { runCommand } = require('../dev/vm.cjs')
const {
  runVmSetup,
  refreshRunner,
  startManagedVm,
  hostToolEnv,
  staleImageWarning,
  failureLine,
} = require('../dev/vm-setup.cjs')

const REPOSITORY = resolve(__dirname, '../..')
const GUEST_DIR = '/home/dev/bench-intake-guest'
const ORIGIN = 'http://127.0.0.1:4330'
const SERVICES = {
  claude: ['bench-claude-egress', 'bench-claude-management'],
  codex: ['bench-codex-egress', 'bench-codex-management'],
}
const MANAGEMENT = new Set(['bench-claude-management', 'bench-codex-management'])

const sha256 = (content) => createHash('sha256').update(content).digest('hex')

/**
 * A fake host and guest behind the injected `exec`. Host pairing and key files are real files in a
 * temporary directory; the guest's state is held here. Mutating commands are recorded in `actions`.
 * `guestKey` is null when absent, '' when empty, or the key's SHA-256.
 */
async function world(t, initial = {}) {
  const root = await mkdtemp(join(tmpdir(), 'vm-setup-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const policy = sha256(
    await readFile(join(REPOSITORY, 'tooling/deployment/guest/browser-seccomp.json')),
  )
  const state = {
    missingTools: [],
    vmStatus: '',
    localLabel: null,
    localRole: 'runner',
    baseLabels: {},
    guestLabel: null,
    guestImageId: null,
    guestPairing: false,
    guestDirExists: false,
    guestCa: null,
    guestKey: null,
    policyHash: null,
    containers: {},
    reader: false,
    fail: new Set(),
    ...initial,
  }
  const actions = []
  const plan = {
    name: 'bench-agent-test',
    image: 'bench-intake-runner:personal-test',
    guestDir: null,
    pair: join(root, 'state', 'vm-pair'),
    port: '14313',
    tools: true,
    keepRunning: false,
  }
  const keyFile = join(root, 'state', 'vm-operator-key')

  const provision = (provider, origin) => {
    for (const name of SERVICES[provider]) {
      state.containers[name] = {
        image: state.guestImageId,
        running: !state.fail.has(`dies ${name}`),
        status: state.fail.has(`restarts ${name}`) ? 'restarting' : undefined,
        mounts: [`${GUEST_DIR}/operator`, `${GUEST_DIR}/${provider}-state`],
        origin: MANAGEMENT.has(name) ? origin : null,
      }
    }
  }

  const failIf = (name) => {
    if (state.fail.has(name)) {
      throw new Error('command_failed')
    }
  }

  const fileProbe = (value) => {
    if (value === null) {
      return 'absent\n'
    }
    return value === '' ? 'empty\n' : `present\n${value}  -\n`
  }

  const guest = async (args) => {
    const [first, second] = args
    if (first === 'sh' && args.includes('printf %s "$HOME"')) {
      return '/home/dev'
    }
    // Only root can see into `guest/`, as on the real guest.
    if (first === 'sudo' && second === 'sh' && args[3].includes('echo complete')) {
      failIf('guest probe')
      if (state.guestPairing) {
        return 'complete\n'
      }
      return state.guestDirExists ? 'present\n' : 'absent\n'
    }
    if (first === 'sudo' && second === 'python3') {
      // The guest's key against its certificate.
      failIf('guest pairing invalid')
      return ''
    }
    if (first === 'sudo' && second === 'cat') {
      return state.fail.has('guest certificate from elsewhere') ? 'other cert' : 'guest cert'
    }
    if (first === 'sudo' && second === 'sh') {
      failIf('guest probe')
      const path = args.at(-1)
      if (path.endsWith('/operator/key')) {
        return fileProbe(state.guestKey)
      }
      if (path.endsWith('/guest/ca.pem')) {
        return fileProbe(state.guestCa)
      }
      return fileProbe(state.policyHash)
    }
    if (first === 'sudo' && second === 'docker') {
      const rest = args.slice(2)
      if (rest[0] === 'image' && rest[1] === 'inspect') {
        if (!state.guestImageId) {
          throw new Error('command_failed')
        }
        return rest[3] === '{{.Id}}'
          ? state.guestImageId
          : `${state.guestLabel ?? '<no value>'}|runner`
      }
      if (rest[0] === 'inspect') {
        const container = state.containers[rest.at(-1)]
        if (!container) {
          throw new Error('command_failed')
        }
        const mounts = container.mounts.map((mount) => `${mount};`).join('')
        const env = container.origin
          ? `INTAKE_OPERATOR_ORIGIN=${container.origin};PATH=/bin;`
          : 'PATH=/bin;'
        const status = container.status ?? (container.running ? 'running' : 'exited')
        return `${container.image}|${status}|${mounts}|${env}`
      }
      if (rest[0] === 'rm') {
        actions.push(`remove ${rest.at(-1)}`)
        delete state.containers[rest.at(-1)]
        return ''
      }
      if (rest[0] === 'start') {
        const name = rest[1]
        actions.push(`start ${name}`)
        failIf(`start ${name}`)
        state.containers[name].running = true
        delete state.containers[name].status
        return ''
      }
    }
    throw new Error(`unexpected guest command: ${args.join(' ')}`)
  }

  const exec = async (command, args, options) => {
    if (command === 'git') {
      return runCommand(command, args, options)
    }
    if (command === 'sh' && args[1].includes('openssl verify')) {
      // `cd` checks the host side; `printf` checks the guest's certificate against the host CA.
      failIf(args[1].startsWith('cd') ? 'host pairing invalid' : 'guest certificate from elsewhere')
      return ''
    }
    if (command === 'sh' && args[1] === 'command -v "$1"') {
      if (state.missingTools.includes(args[3])) {
        throw new Error('command_failed')
      }
      return `/usr/bin/${args[3]}`
    }
    if (command === 'limactl') {
      if (args[0] === 'list') {
        // Lima lists every instance; the named one is absent until it is created.
        const other = 'bench-agent-other Running\n'
        return state.vmStatus === '' ? other : `${other}bench-agent-test ${state.vmStatus}\n`
      }
      if (args[0] === 'start') {
        actions.push(state.vmStatus === '' ? 'create vm' : 'boot vm')
        failIf('start vm')
        state.vmStatus = 'Running'
        return ''
      }
      if (args[0] === 'stop') {
        actions.push('stop vm')
        failIf('stop vm')
        state.vmStatus = 'Stopped'
        return ''
      }
      if (args[0] === 'shell') {
        return guest(args.slice(3))
      }
    }
    if (command === 'docker') {
      if (args[0] === 'image' && args[1] === 'inspect') {
        const tag = args.at(-1)
        const base = { 'bench-intake-app:dev': 'app', 'bench-intake-personal-guest:dev': 'guest' }[
          tag
        ]
        const label = base ? state.baseLabels[base] : state.localLabel
        if (label === null || label === undefined) {
          throw new Error('command_failed')
        }
        return `${label}|${base ?? state.localRole}`
      }
      const target = args.includes('personal') ? 'runner' : args.includes('-f') ? 'app' : 'guest'
      actions.push(`build ${target}`)
      failIf(`build ${target}`)
      const label = args[args.indexOf('--label') + 1].split('=')[1]
      if (target === 'runner') {
        state.localLabel = label
        state.localRole = 'runner'
      } else {
        state.baseLabels[target] = label
      }
      return ''
    }
    if (command === 'bash' && args[0] === '-o') {
      actions.push('load runner')
      failIf('load runner')
      state.guestLabel = state.localLabel
      // Each load gives a new image ID, as a rebuilt image does.
      state.loads = (state.loads ?? 0) + 1
      state.guestImageId = `sha256:${state.localLabel}-${state.loads}`
      return ''
    }
    if (command === 'bash') {
      const script = args[0].split('/').at(-1)
      actions.push(script)
      failIf(script)
      if (script === 'pair.sh') {
        await mkdir(args[2], { recursive: true })
        for (const file of ['ca.pem', 'cert.pem', 'key.pem']) {
          await writeFile(join(args[2], file), `${file} from this pairing`)
        }
        state.guestPairing = true
        state.guestCa = sha256('ca.pem from this pairing')
      } else if (script === 'operator-key.sh') {
        // The script makes the key on both sides when neither has one.
        await writeFile(args[3], 'a'.repeat(64) + '\n', { flag: 'wx' })
        state.guestKey = sha256(await readFile(args[3]))
      } else if (script === 'browser-policy.sh') {
        state.policyHash = policy
      } else if (script === 'personal-claude.sh') {
        provision('claude', args[5])
      } else if (script === 'personal-codex.sh') {
        provision('codex', args[4])
      }
      return ''
    }
    throw new Error(`unexpected command: ${command} ${args.join(' ')}`)
  }

  const output = []
  const write = { out: (text) => output.push(text), err: () => {} }
  const setup = (overrides = {}) =>
    runVmSetup({
      plan: { ...plan, ...overrides.plan },
      repository: REPOSITORY,
      origin: overrides.origin ?? ORIGIN,
      keyFile,
      exec,
      write,
      signal: overrides.signal,
      settleMs: 0,
    })
  const refresh = (overrides = {}) =>
    refreshRunner({
      plan: { ...plan, ...overrides.plan },
      guestDir: GUEST_DIR,
      repository: REPOSITORY,
      origin: overrides.origin ?? ORIGIN,
      keyFile,
      exec,
      write,
      settleMs: 0,
    })
  return { state, actions, output, plan, keyFile, root, exec, setup, refresh, policy }
}

const FRESH_ORDER = [
  'create vm',
  'build app',
  'build guest',
  'build runner',
  'load runner',
  'pair.sh',
  'operator-key.sh',
  'browser-policy.sh',
  'personal-claude.sh',
  'personal-codex.sh',
  'stop vm',
]

test('a fresh setup runs every step in order and stops the VM it started', async (t) => {
  const fake = await world(t)
  await fake.setup()
  assert.deepEqual(fake.actions, FRESH_ORDER)
  assert.equal(fake.state.guestKey, sha256(await readFile(fake.keyFile)))
  const text = fake.output.join('')
  assert.match(text, /INTAKE_USE_MOCK_AI_AGENTS=false/)
  assert.match(text, /INTAKE_RUN_AGENTS_IN_VM=true/)
})

test('a rerun on a prepared VM reports every step done and changes nothing', async (t) => {
  const fake = await world(t)
  await fake.setup({ plan: { keepRunning: true } })
  const key = await readFile(fake.keyFile, 'utf8')
  fake.actions.length = 0
  fake.output.length = 0
  await fake.setup({ plan: { keepRunning: true } })
  assert.deepEqual(fake.actions, [])
  const lines = fake.output.join('').split('\n')
  for (const name of [
    'VM',
    'Pairing and operator key checks',
    'Images',
    'Runner image in the VM',
    'Pairing',
    'Operator key',
    'Browser policy',
    'Guest services',
  ]) {
    assert.ok(lines.includes(`${name}: already done`), name)
  }
  assert.equal(await readFile(fake.keyFile, 'utf8'), key)
})

/** Writes a complete host pairing whose CA is `ca`. */
async function hostPairing(fake, ca = 'ca.pem from this pairing') {
  await mkdir(fake.plan.pair, { recursive: true })
  await writeFile(join(fake.plan.pair, 'ca.pem'), ca)
  await writeFile(join(fake.plan.pair, 'cert.pem'), 'cert')
  await writeFile(join(fake.plan.pair, 'key.pem'), 'key')
}

test('a pairing on one side only stops before anything is built, naming both and removing neither', async (t) => {
  for (const side of ['host', 'guest']) {
    await t.test(side, async (t) => {
      // A guest side needs an existing VM; a host side alone is refused before any VM is made.
      const fake = await world(
        t,
        side === 'guest' ? { guestDirExists: true, vmStatus: 'Stopped' } : {},
      )
      if (side === 'host') {
        await mkdir(fake.plan.pair, { recursive: true })
        await writeFile(join(fake.plan.pair, 'ca.pem'), 'kept')
      }
      await assert.rejects(fake.setup(), (error) => {
        assert.equal(error.code, 'vm_pairing_mismatch')
        assert.match(failureLine(error), new RegExp(`${fake.plan.pair} and bench-agent-test:`))
        return true
      })
      assert.deepEqual(fake.actions, side === 'host' ? [] : ['boot vm', 'stop vm'])
      if (side === 'host') {
        assert.equal(await readFile(join(fake.plan.pair, 'ca.pem'), 'utf8'), 'kept')
      } else {
        assert.equal(fake.state.guestDirExists, true)
      }
    })
  }
})

test('a pairing whose sides come from different pairings is refused', async (t) => {
  const fake = await world(t, {
    vmStatus: 'Stopped',
    guestPairing: true,
    guestCa: sha256('another pairing'),
  })
  await hostPairing(fake)
  await assert.rejects(fake.setup(), { code: 'vm_pairing_mismatch' })
  assert.deepEqual(fake.actions, ['boot vm', 'stop vm'])
})

test('a pairing sharing a CA but with a certificate or key from elsewhere is refused', async (t) => {
  for (const failure of [
    'host pairing invalid',
    'guest pairing invalid',
    'guest certificate from elsewhere',
  ]) {
    await t.test(failure, async (t) => {
      const fake = await world(t, {
        vmStatus: 'Stopped',
        guestPairing: true,
        guestCa: sha256('ca.pem from this pairing'),
        fail: new Set([failure]),
      })
      await hostPairing(fake)
      await assert.rejects(fake.setup(), { code: 'vm_pairing_mismatch' })
      assert.deepEqual(fake.actions, ['boot vm', 'stop vm'])
    })
  }
})

test('with no VM yet, a host pairing or key file alone is refused before a VM is created', async (t) => {
  const pairing = await world(t)
  await hostPairing(pairing)
  await assert.rejects(pairing.setup(), { code: 'vm_pairing_mismatch' })
  assert.deepEqual(pairing.actions, [])

  const key = await world(t)
  await mkdir(join(key.root, 'state'), { recursive: true })
  await writeFile(key.keyFile, 'kept\n')
  await assert.rejects(key.setup(), { code: 'vm_operator_key_mismatch' })
  assert.deepEqual(key.actions, [])
  assert.equal(await readFile(key.keyFile, 'utf8'), 'kept\n')
})

test('an operator key on one side only, empty, or different stops before anything is written', async (t) => {
  const cases = {
    'guest only': { host: null, guest: sha256('guest\n') },
    'host only': { host: 'host\n', guest: null },
    'empty guest key': { host: 'host\n', guest: '' },
    'empty host file': { host: '', guest: sha256('guest\n') },
    different: { host: 'host\n', guest: sha256('guest\n') },
  }
  for (const [name, keys] of Object.entries(cases)) {
    await t.test(name, async (t) => {
      const fake = await world(t, {
        vmStatus: 'Stopped',
        guestPairing: true,
        guestCa: sha256('ca.pem from this pairing'),
        guestKey: keys.guest,
      })
      await hostPairing(fake)
      if (keys.host !== null) {
        await writeFile(fake.keyFile, keys.host)
      }
      await assert.rejects(fake.setup(), { code: 'vm_operator_key_mismatch' })
      assert.deepEqual(fake.actions, ['boot vm', 'stop vm'])
      assert.equal(fake.state.guestKey, keys.guest)
      if (keys.host === null) {
        await assert.rejects(readFile(fake.keyFile), { code: 'ENOENT' })
      } else {
        assert.equal(await readFile(fake.keyFile, 'utf8'), keys.host)
      }
    })
  }
})

test('a failed guest check stops the run rather than reading as absent', async (t) => {
  const fake = await world(t, { fail: new Set(['guest probe']) })
  await assert.rejects(fake.setup(), (error) => {
    assert.equal(failureLine(error), 'vm_setup_step_failed: Pairing and operator key checks')
    return true
  })
  assert.deepEqual(fake.actions, ['create vm', 'stop vm'])
})

test('a missing limactl or docker is refused before anything runs', async (t) => {
  for (const tool of ['limactl', 'docker']) {
    await t.test(tool, async (t) => {
      const fake = await world(t, { missingTools: [tool] })
      await assert.rejects(fake.setup(), (error) => {
        assert.equal(failureLine(error), `vm_setup_prerequisite_missing: ${tool}`)
        return true
      })
      assert.deepEqual(fake.actions, [])
    })
  }
})

test('a runner tag naming one of its base images is refused before anything runs', async (t) => {
  for (const image of ['bench-intake-app:dev', 'bench-intake-personal-guest:dev']) {
    const fake = await world(t)
    await assert.rejects(fake.setup({ plan: { image } }), { code: 'vm_runner_image_name_reserved' })
    assert.deepEqual(fake.actions, [])
  }
})

test('an image with the current digest but built for another role is not taken as the runner', async (t) => {
  const fake = await world(t)
  await fake.setup({ plan: { keepRunning: true } })
  fake.state.localRole = 'app'
  fake.state.guestLabel = 'old'
  fake.actions.length = 0
  await fake.setup({ plan: { keepRunning: true } })
  assert.deepEqual(fake.actions.slice(0, 3), ['build app', 'build guest', 'build runner'])
})

test('a failed step stops the run naming it, runs no later step, and stops a VM it started', async (t) => {
  const fake = await world(t, { fail: new Set(['personal-claude.sh']) })
  await assert.rejects(fake.setup(), (error) => {
    assert.equal(failureLine(error), 'vm_guest_service_provision_failed: claude')
    return true
  })
  assert.ok(!fake.actions.includes('personal-codex.sh'))
  assert.equal(fake.actions.at(-1), 'stop vm')

  const build = await world(t, { fail: new Set(['build guest']) })
  await assert.rejects(build.setup(), (error) => {
    assert.equal(failureLine(error), 'vm_setup_step_failed: Images')
    return true
  })
  assert.deepEqual(build.actions, ['create vm', 'build app', 'build guest', 'stop vm'])
})

test('a service that dies after a successful provisioning command fails the run naming it', async (t) => {
  const fake = await world(t, { fail: new Set(['dies bench-codex-management']) })
  await assert.rejects(fake.setup(), (error) => {
    assert.equal(failureLine(error), 'vm_guest_service_start_failed: bench-codex-management')
    return true
  })
  assert.ok(!fake.output.join('').includes('is ready'))
})

test('a service in restart backoff is not taken as running', async (t) => {
  const fake = await world(t, { fail: new Set(['restarts bench-claude-management']) })
  await assert.rejects(fake.setup(), (error) => {
    assert.equal(failureLine(error), 'vm_guest_service_start_failed: bench-claude-management')
    return true
  })
})

test('a missing app or guest image is rebuilt even when the runner image is current', async (t) => {
  for (const base of ['app', 'guest']) {
    const fake = await world(t)
    await fake.setup({ plan: { keepRunning: true } })
    delete fake.state.baseLabels[base]
    fake.actions.length = 0
    await fake.setup({ plan: { keepRunning: true } })
    assert.deepEqual(fake.actions, ['build app', 'build guest', 'build runner'], base)
  }
})

test('a container of the same name from another installation is neither reused nor replaced', async (t) => {
  const fake = await world(t)
  await fake.setup({ plan: { keepRunning: true } })
  fake.state.containers['bench-claude-egress'].mounts = ['/home/dev/other-install/egress']
  fake.actions.length = 0
  await assert.rejects(
    fake.setup({ plan: { keepRunning: true }, origin: 'https://new.example' }),
    (error) => {
      assert.equal(failureLine(error), 'vm_guest_service_conflict: bench-claude-egress')
      return true
    },
  )
  assert.deepEqual(fake.actions, [])
})

test('the VM is stopped only when this run started it and it is not kept', async (t) => {
  const running = await world(t, { vmStatus: 'Running' })
  await running.setup()
  assert.ok(!running.actions.includes('stop vm'))

  const kept = await world(t)
  await kept.setup({ plan: { keepRunning: true } })
  assert.ok(!kept.actions.includes('stop vm'))

  const stopped = await world(t, { vmStatus: 'Stopped' })
  await stopped.setup()
  assert.equal(stopped.actions[0], 'boot vm')
  assert.equal(stopped.actions.at(-1), 'stop vm')
})

test('a failed VM stop fails the run, and the ready message is not printed', async (t) => {
  const fake = await world(t, { fail: new Set(['stop vm']) })
  await assert.rejects(fake.setup(), (error) => {
    assert.equal(failureLine(error), 'vm_stop_failed: bench-agent-test')
    return true
  })
  assert.ok(!fake.output.join('').includes('is ready'))
})

test('a cancelled run stops before the next step and still stops the VM it started', async (t) => {
  const fake = await world(t)
  const cancel = new AbortController()
  // Cancelled while the images build, as a Ctrl-C would be.
  const record = fake.actions.push.bind(fake.actions)
  fake.actions.push = (action) => {
    const length = record(action)
    if (action === 'build runner') {
      cancel.abort()
    }
    return length
  }
  await assert.rejects(fake.setup({ signal: cancel.signal }), { code: 'vm_setup_cancelled' })
  assert.ok(!fake.actions.includes('load runner'))
  assert.equal(fake.actions.at(-1), 'stop vm')
})

test('a new origin reprovisions both providers and keeps the pairing and key', async (t) => {
  const fake = await world(t)
  await fake.setup({ plan: { keepRunning: true } })
  const key = await readFile(fake.keyFile, 'utf8')
  fake.actions.length = 0
  await fake.setup({ plan: { keepRunning: true }, origin: 'https://bench.example.ts.net' })
  assert.deepEqual(fake.actions, ['personal-claude.sh', 'personal-codex.sh'])
  assert.equal(
    fake.state.containers['bench-claude-management'].origin,
    'https://bench.example.ts.net',
  )
  assert.equal(await readFile(fake.keyFile, 'utf8'), key)
})

test('a stopped guest service is started and confirmed; a failed start names the service', async (t) => {
  const fake = await world(t)
  await fake.setup({ plan: { keepRunning: true } })
  fake.state.containers['bench-claude-management'].running = false
  fake.actions.length = 0
  await fake.setup({ plan: { keepRunning: true } })
  assert.deepEqual(fake.actions, ['start bench-claude-management'])

  fake.state.containers['bench-codex-egress'].running = false
  fake.state.fail.add('start bench-codex-egress')
  await assert.rejects(fake.setup({ plan: { keepRunning: true } }), (error) => {
    assert.equal(failureLine(error), 'vm_guest_service_start_failed: bench-codex-egress')
    return true
  })
})

test("the retired document reader is removed only when it is this installation's", async (t) => {
  const fake = await world(t)
  await fake.setup({ plan: { keepRunning: true } })
  const reader = (mount) => ({
    image: 'sha256:reader',
    running: true,
    mounts: [mount],
    origin: null,
  })
  fake.state.containers['bench-public-reader'] = reader('/home/dev/other-install/web')
  fake.actions.length = 0
  await fake.setup({ plan: { keepRunning: true } })
  assert.deepEqual(fake.actions, [])

  fake.state.containers['bench-public-reader'] = reader(`${GUEST_DIR}/web`)
  await fake.setup({ plan: { keepRunning: true } })
  assert.deepEqual(fake.actions, ['remove bench-public-reader'])
})

/** A prepared VM, for the `pnpm dev` refresh. */
async function prepared(t) {
  const fake = await world(t)
  await fake.setup({ plan: { keepRunning: true } })
  fake.actions.length = 0
  fake.output.length = 0
  return fake
}

test('a current runner image, services and policy refresh nothing', async (t) => {
  const fake = await prepared(t)
  assert.equal(await fake.refresh(), false)
  assert.deepEqual(fake.actions, [])
})

test('a stale guest image is rebuilt, loaded and its services restarted, and says so', async (t) => {
  const fake = await prepared(t)
  fake.state.guestLabel = 'old'
  fake.state.localLabel = 'old'
  assert.equal(await fake.refresh(), true)
  assert.deepEqual(fake.actions, [
    'build app',
    'build guest',
    'build runner',
    'load runner',
    'personal-claude.sh',
    'personal-codex.sh',
  ])
  assert.match(fake.output.join(''), /Refreshing the runner image/)
})

test('a current local image is loaded without a build', async (t) => {
  const fake = await prepared(t)
  fake.state.guestLabel = 'old'
  await fake.refresh()
  assert.deepEqual(fake.actions.slice(0, 1), ['load runner'])
})

test('services left on an old image by an earlier failed refresh are reprovisioned without a build', async (t) => {
  const fake = await prepared(t)
  fake.state.containers['bench-codex-management'].image = 'sha256:old'
  assert.equal(await fake.refresh(), true)
  assert.deepEqual(fake.actions, ['personal-codex.sh'])
})

test('a failed rebuild or load is vm_runner_image_refresh_failed, with no service provisioned', async (t) => {
  for (const failing of ['build runner', 'load runner']) {
    await t.test(failing, async (t) => {
      const fake = await prepared(t)
      fake.state.guestLabel = 'old'
      if (failing === 'build runner') {
        fake.state.localLabel = 'old'
      }
      fake.state.fail.add(failing)
      await assert.rejects(fake.refresh(), { code: 'vm_runner_image_refresh_failed' })
      assert.ok(!fake.actions.some((action) => action.startsWith('personal-')))
    })
  }
})

test('a stale image with a missing or different host key stops before any build or provisioning', async (t) => {
  for (const host of [null, 'different\n']) {
    await t.test(host ?? 'missing', async (t) => {
      const fake = await prepared(t)
      const guestKey = fake.state.guestKey
      if (host) {
        await writeFile(fake.keyFile, host)
      } else {
        await rm(fake.keyFile)
      }
      fake.state.guestLabel = 'old'
      await assert.rejects(fake.refresh(), { code: 'vm_operator_key_mismatch' })
      assert.deepEqual(fake.actions, [])
      assert.equal(fake.state.guestKey, guestKey)
    })
  }
})

test('a refresh with both operator keys missing refuses rather than making a new one', async (t) => {
  const fake = await prepared(t)
  await rm(fake.keyFile)
  fake.state.guestKey = null
  fake.state.guestLabel = 'old'
  await assert.rejects(fake.refresh(), { code: 'vm_operator_key_mismatch' })
  assert.deepEqual(fake.actions, [])
  await assert.rejects(readFile(fake.keyFile), { code: 'ENOENT' })
  assert.equal(fake.state.guestKey, null)
})

test('a refresh refuses a pairing that does not match its guest', async (t) => {
  const fake = await prepared(t)
  fake.state.guestCa = sha256('another pairing')
  await assert.rejects(fake.refresh(), { code: 'vm_pairing_mismatch' })
  assert.deepEqual(fake.actions, [])
})

test('a missing or changed browser policy is reinstalled when tools are on, and a failure is named', async (t) => {
  const fake = await prepared(t)
  fake.state.policyHash = 'changed'
  assert.equal(await fake.refresh(), true)
  assert.deepEqual(fake.actions, ['browser-policy.sh'])

  fake.state.policyHash = null
  fake.actions.length = 0
  assert.equal(await fake.refresh({ plan: { tools: false } }), false)
  assert.deepEqual(fake.actions, [])

  fake.state.fail.add('browser-policy.sh')
  await assert.rejects(fake.refresh(), (error) => {
    assert.equal(
      failureLine(error),
      `vm_setup_step_failed: browser policy in bench-agent-test:${GUEST_DIR}`,
    )
    return true
  })
})

test('a stopped guest service is started by the refresh', async (t) => {
  const fake = await prepared(t)
  fake.state.containers['bench-codex-egress'].running = false
  assert.equal(await fake.refresh(), true)
  assert.deepEqual(fake.actions, ['start bench-codex-egress'])
})

test('an unmanaged VM with a stale local image gets a warning naming pnpm vm:setup', async (t) => {
  const fake = await prepared(t)
  const plan = fake.plan
  assert.equal(await staleImageWarning({ plan, repository: REPOSITORY, exec: fake.exec }), null)
  fake.state.localLabel = 'old'
  assert.match(
    await staleImageWarning({ plan, repository: REPOSITORY, exec: fake.exec }),
    /pnpm vm:setup/,
  )
  assert.deepEqual(fake.actions, [])
})

/** The launcher's VM side with recorded steps; `refresh` decides what the refresh does. */
function launcherSteps(refresh) {
  const order = []
  const steps = {
    ensureRunning: async (_plan, { onBoot }) => {
      onBoot()
      order.push('boot')
      return true
    },
    guestDirectory: async () => {
      order.push('guest directory')
      return GUEST_DIR
    },
    refresh: async (options) => {
      order.push('refresh')
      return refresh(options)
    },
    startChildren: (plan) => {
      order.push(`relays in ${plan.guestDir}`)
      return []
    },
    confirmChildren: async () => {
      order.push('confirm')
    },
  }
  return { order, steps }
}

test('pnpm dev refreshes the runner before starting any relay', async () => {
  const { order, steps } = launcherSteps(async () => true)
  let refreshed = false
  const vm = await startManagedVm(
    { name: 'bench-agent-test' },
    { steps, onBoot: () => {}, onRefreshed: () => (refreshed = true), origin: ORIGIN },
  )
  await vm.confirmed
  assert.deepEqual(order, [
    'boot',
    'guest directory',
    'refresh',
    `relays in ${GUEST_DIR}`,
    'confirm',
  ])
  assert.equal(refreshed, true)
})

test('a failed refresh starts no relay, and the boot is already recorded for shutdown', async () => {
  const { order, steps } = launcherSteps(async () => {
    const { VmSetupError } = require('../dev/vm-setup.cjs')
    throw new VmSetupError('vm_runner_image_refresh_failed', 'bench-intake-runner:personal')
  })
  let booted = false
  await assert.rejects(
    startManagedVm({ name: 'bench-agent-test' }, { steps, onBoot: () => (booted = true) }),
    { code: 'vm_runner_image_refresh_failed' },
  )
  assert.deepEqual(order, ['boot', 'guest directory', 'refresh'])
  assert.equal(booted, true)
})

test('Lima and Docker commands get the settings that select the Docker engine, and nothing else', () => {
  const env = hostToolEnv({
    PATH: '/usr/bin',
    HOME: '/home/dev',
    DOCKER_HOST: 'unix:///run/other.sock',
    DOCKER_CONTEXT: 'bench',
    DOCKER_CONFIG: '/home/dev/.docker-bench',
    LIMA_HOME: '/home/dev/.lima-bench',
    INTAKE_DEV_PORT: '4330',
    AWS_SECRET_ACCESS_KEY: 'not passed',
  })
  assert.deepEqual(env, {
    PATH: '/usr/bin',
    HOME: '/home/dev',
    DOCKER_HOST: 'unix:///run/other.sock',
    DOCKER_CONTEXT: 'bench',
    DOCKER_CONFIG: '/home/dev/.docker-bench',
    LIMA_HOME: '/home/dev/.lima-bench',
  })
})
