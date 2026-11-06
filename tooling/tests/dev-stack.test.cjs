const test = require('node:test')
const assert = require('node:assert/strict')
const { prepareDevelopment } = require('../dev/stack.cjs')

function recorder(overrides = {}) {
  const calls = []
  const deps = {
    startServices: async () => calls.push('start-services'),
    serverIdentity: async (env) => {
      calls.push(env.INTAKE_DEV_ADMIN_URL ? 'identity-admin-url' : 'identity-state')
      return 'd'.repeat(32)
    },
    stateRoot: (env, target, scope) => {
      calls.push(`root:${target.kind}:${scope.serverId}`)
      return `/state/${target.kind}`
    },
    ...overrides,
  }
  return { calls, deps }
}

test('the supervisor starts the shared server before it resolves identity and the state root', async () => {
  const { calls, deps } = recorder()
  const prepared = await prepareDevelopment({}, { kind: 'fake' }, deps)
  assert.deepEqual(calls, ['start-services', 'identity-state', `root:fake:${'d'.repeat(32)}`])
  assert.equal(prepared.root, '/state/fake')
  assert.equal(prepared.serverId, 'd'.repeat(32))
})

test('an explicit admin URL skips the shared server and identifies by that URL', async () => {
  const { calls, deps } = recorder()
  await prepareDevelopment(
    { INTAKE_DEV_ADMIN_URL: 'postgresql://postgres:x@127.0.0.1:6543/postgres' },
    { kind: 'fake' },
    deps,
  )
  assert.deepEqual(calls, ['identity-admin-url', `root:fake:${'d'.repeat(32)}`])
})

test('a failed server start stops before any state root is chosen', async () => {
  const { calls, deps } = recorder({
    startServices: async () => {
      calls.push('start-services')
      throw new Error('development_setup_failed')
    },
  })
  await assert.rejects(prepareDevelopment({}, { kind: 'fake' }, deps), /development_setup_failed/)
  assert.deepEqual(calls, ['start-services'])
})

const { apiTargetEnv } = require('../dev/stack.cjs')

test('local-inventree starts the stack, reads the instance, then picks an instance-scoped root', async () => {
  const { calls, deps } = recorder({
    startLocalInventree: async () => calls.push('start-local-inventree'),
    readLocalInventree: async () => {
      calls.push('read-local-inventree')
      return { instanceId: '1'.repeat(32), readToken: 'inv-read-20261106' }
    },
    stateRoot: (env, target, scope) => {
      calls.push(`root:${target.kind}:${scope.serverId}:${scope.instanceId}`)
      return '/state/local'
    },
  })
  const target = {
    kind: 'local-inventree',
    origin: 'http://127.0.0.1:4320',
    credentialRef: 'local_inventree_dev',
  }
  const prepared = await prepareDevelopment({}, target, deps)
  assert.deepEqual(calls, [
    'start-local-inventree',
    'identity-state',
    'read-local-inventree',
    `root:local-inventree:${'d'.repeat(32)}:${'1'.repeat(32)}`,
  ])
  assert.equal(prepared.key, 'inv-read-20261106')
})

test('the API child gets the local origin, reference and state key without reading runnerConfig', () => {
  const target = {
    kind: 'local-inventree',
    origin: 'http://127.0.0.1:4320',
    credentialRef: 'local_inventree_dev',
  }
  const state = {
    version: 3,
    get runnerConfig() {
      throw new Error('runnerConfig is v1 only')
    },
  }
  assert.deepEqual(apiTargetEnv(target, state, 'inv-read-20261106'), {
    INTAKE_CREDENTIAL_REF: 'local_inventree_dev',
    INTAKE_DEV_API_KEY: 'inv-read-20261106',
    INTAKE_READ_ORIGIN: 'http://127.0.0.1:4320',
  })
  const fake = {
    version: 1,
    runnerConfig: {
      profile: { credential: 'owned-fake-token', origin: 'http://127.0.0.1:4351' },
      deploymentId: 'dep',
    },
  }
  assert.deepEqual(apiTargetEnv({ kind: 'fake' }, fake, undefined), {
    INTAKE_CREDENTIAL_REF: 'owned_development',
    INTAKE_DEV_API_KEY: 'owned-fake-token',
    INTAKE_READ_ORIGIN: 'http://127.0.0.1:4351',
    INTAKE_DEPLOYMENT_ID: 'dep',
  })
})

const { serviceEnvironment, confirmLocalInventree } = require('../dev/stack.cjs')

test('children get the supervisor’s resolved state directory and never re-read an env file', () => {
  const env = serviceEnvironment({ PATH: '/bin' }, {}, () => '/resolved/state')
  assert.deepEqual(env, { PATH: '/bin', INTAKE_DEV_STATE: '/resolved/state', INTAKE_ENV_FILE: '' })
})

test('a local instance reset between up and the supervisor lock is refused', async () => {
  const target = {
    kind: 'local-inventree',
    origin: 'http://127.0.0.1:4320',
    credentialRef: 'local_inventree_dev',
  }
  const prepared = {
    scope: { serverId: 'd'.repeat(32), instanceId: '1'.repeat(32) },
    key: 'inv-read-20261106',
  }
  await confirmLocalInventree({}, target, prepared, async () => ({
    instanceId: '1'.repeat(32),
    readToken: 'inv-read-20261106',
  }))
  for (const changed of [
    { instanceId: '2'.repeat(32), readToken: 'inv-read-20261106' },
    { instanceId: '1'.repeat(32), readToken: 'inv-other-20261106' },
  ]) {
    await assert.rejects(
      confirmLocalInventree({}, target, prepared, async () => changed),
      /local_inventree_changed_during_startup/,
    )
  }
  await confirmLocalInventree({}, { kind: 'fake' }, prepared, async () => {
    throw new Error('not read for other profiles')
  })
})

const { startSupervision } = require('../dev/stack.cjs')

test('supervision starts the stack with the shared child env, locks the root, then re-checks the instance', async () => {
  const calls = []
  let instance = { instanceId: '1'.repeat(32), readToken: 'inv-read-20261106' }
  const deps = {
    baseEnv: { PATH: '/bin' },
    stateDirectory: () => '/resolved/state',
    startServices: async () => calls.push('start-services'),
    startLocalInventree: async (env) => calls.push(['start-local', env]),
    serverIdentity: async () => 'd'.repeat(32),
    readLocalInventree: async () => {
      calls.push('read-local')
      return instance
    },
    stateRoot: () => '/state/local',
    privateState: async (root) => {
      calls.push(`lock:${root}`)
      return async () => calls.push('release')
    },
  }
  const target = {
    kind: 'local-inventree',
    origin: 'http://127.0.0.1:4320',
    credentialRef: 'local_inventree_dev',
  }
  const started = await startSupervision({}, target, deps)
  assert.deepEqual(calls, [
    ['start-local', { PATH: '/bin', INTAKE_DEV_STATE: '/resolved/state', INTAKE_ENV_FILE: '' }],
    'read-local',
    'lock:/state/local',
    'read-local',
  ])
  assert.deepEqual(started.serviceEnv, {
    PATH: '/bin',
    INTAKE_DEV_STATE: '/resolved/state',
    INTAKE_ENV_FILE: '',
  })
  calls.length = 0
  deps.readLocalInventree = async () => {
    calls.push('read-local')
    const seen = instance
    instance = { instanceId: '2'.repeat(32), readToken: 'inv-new-20261106' }
    return seen
  }
  await assert.rejects(startSupervision({}, target, deps), /local_inventree_changed_during_startup/)
  assert.deepEqual(
    calls.slice(-2),
    ['read-local', 'release'],
    'the lock is released when the re-check fails',
  )
})

test('fake supervision starts the shared server with the shared child env before the lock', async () => {
  const calls = []
  const started = await startSupervision(
    {},
    { kind: 'fake' },
    {
      baseEnv: { PATH: '/bin' },
      stateDirectory: () => '/resolved/state',
      startServices: async (env) => calls.push(['start-services', env]),
      startLocalInventree: async () => calls.push('start-local'),
      serverIdentity: async () => 'd'.repeat(32),
      readLocalInventree: async () => calls.push('read-local'),
      stateRoot: () => '/state/fake',
      privateState: async (root) => {
        calls.push(`lock:${root}`)
        return async () => {}
      },
    },
  )
  assert.deepEqual(calls, [
    ['start-services', { PATH: '/bin', INTAKE_DEV_STATE: '/resolved/state', INTAKE_ENV_FILE: '' }],
    'lock:/state/fake',
  ])
  assert.equal(started.prepared.root, '/state/fake')
})
