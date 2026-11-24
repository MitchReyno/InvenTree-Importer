const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveDevelopmentSettings, DevelopmentSettingsError } = require('../dev/settings.cjs')

const VM = { INTAKE_VM_PAIR: '/pair', INTAKE_VM_PORT: '14313' }
const STATE = { stateDirectory: '/state' }
const EXTERNAL = {
  INTAKE_INVENTREE_URL: 'https://inventory.example.invalid',
  INTAKE_INVENTREE_TOKEN: 'synthetic-read-token',
}

function refusedNames(settings, code) {
  try {
    resolveDevelopmentSettings(settings, STATE)
  } catch (error) {
    assert.ok(error instanceof DevelopmentSettingsError)
    assert.equal(error.message, code)
    return error.names.map(({ name }) => name)
  }
  assert.fail(`expected ${code}`)
}

function refusal(settings, code) {
  assert.throws(
    () => resolveDevelopmentSettings(settings),
    (error) => error instanceof DevelopmentSettingsError && error.message === code,
  )
}

test('the processing switches select each supported profile', () => {
  const cases = [
    [{ INTAKE_USE_AGENT_SESSIONS: 'false' }, 'synthetic-research/2'],
    [{}, 'synthetic-session/1'],
    [{ INTAKE_RUN_AGENTS_IN_VM: 'true', ...VM }, 'synthetic-session/1'],
    [{ INTAKE_USE_MOCK_AI_AGENTS: 'false', INTAKE_USE_AGENT_SESSIONS: 'false' }, 'native-agent/1'],
    [{ INTAKE_USE_MOCK_AI_AGENTS: 'false' }, 'native-agent/2'],
    [
      {
        INTAKE_USE_MOCK_AI_AGENTS: 'false',
        INTAKE_RUN_AGENTS_IN_VM: 'true',
        INTAKE_VM_AGENT_TOOLS: 'false',
        ...VM,
      },
      'shared-vm-agent/1',
    ],
    [
      { INTAKE_USE_MOCK_AI_AGENTS: 'false', INTAKE_RUN_AGENTS_IN_VM: 'true', ...VM },
      'shared-vm-agent/3',
    ],
  ]
  for (const [settings, profile] of cases) {
    assert.equal(resolveDevelopmentSettings(settings).profile, profile, JSON.stringify(settings))
  }
})

test('defaults give a writable mock inventory and scripted sessions on the host', () => {
  const resolved = resolveDevelopmentSettings({})
  assert.deepEqual(resolved.targetSettings, { INTAKE_TARGET_PROFILE: 'fake' })
  assert.equal(resolved.readOnly, false)
  assert.equal(resolved.profile, 'synthetic-session/1')
  assert.equal(resolved.agentsInVm, false)
  assert.deepEqual(resolved.ignored, [])
})

test('the secrets directory is an absolute path from the operator, or left for the launcher to default', () => {
  assert.equal(resolveDevelopmentSettings({}).secretsDir, null)
  assert.equal(
    resolveDevelopmentSettings({ INTAKE_SECRETS_DIR: '/owned/secrets' }).secretsDir,
    '/owned/secrets',
  )
  assert.throws(
    () => resolveDevelopmentSettings({ INTAKE_SECRETS_DIR: 'secrets' }),
    (error) =>
      error instanceof DevelopmentSettingsError &&
      error.message === 'invalid_development_setting' &&
      error.names[0].name === 'INTAKE_SECRETS_DIR',
  )
})

test('VM agents need sessions; their pairing and port default under the state directory', () => {
  refusal(
    { INTAKE_RUN_AGENTS_IN_VM: 'true', INTAKE_USE_AGENT_SESSIONS: 'false', ...VM },
    'unsupported_agent_settings',
  )
  const defaulted = resolveDevelopmentSettings({ INTAKE_RUN_AGENTS_IN_VM: 'true' }, STATE)
  assert.deepEqual(defaulted.vmPairing, { pair: '/state/vm-pair', port: '14313' })
  assert.deepEqual(defaulted.defaulted, ['INTAKE_VM_PAIR', 'INTAKE_VM_PORT'])
  const explicit = resolveDevelopmentSettings({ INTAKE_RUN_AGENTS_IN_VM: '1', ...VM }, STATE)
  assert.deepEqual(explicit.vmPairing, { pair: '/pair', port: '14313' })
  assert.deepEqual(explicit.defaulted, [])
  assert.equal(resolveDevelopmentSettings({}, STATE).vmPairing, null)
})

test('a defaulted pairing needs the state directory from the caller', () => {
  assert.throws(
    () => resolveDevelopmentSettings({ INTAKE_RUN_AGENTS_IN_VM: 'true' }),
    /development_state_directory_required/,
  )
})

test('an explicit VM port must be one the relay accepts', () => {
  for (const port of ['0', '65536', '14313x', '-1']) {
    const names = refusedNames(
      { INTAKE_RUN_AGENTS_IN_VM: 'true', INTAKE_VM_PORT: port },
      'invalid_vm_launch_setting',
    )
    assert.deepEqual(names, ['INTAKE_VM_PORT'], port)
  }
})

test('the local switch and a URL each select their real server, read-only by default', () => {
  const local = resolveDevelopmentSettings({ INTAKE_USE_LOCAL_INVENTREE: 'true' })
  assert.deepEqual(local.targetSettings, { INTAKE_TARGET_PROFILE: 'local-inventree' })
  assert.equal(local.readOnly, true)

  const external = resolveDevelopmentSettings(EXTERNAL)
  assert.deepEqual(external.targetSettings, {
    INTAKE_TARGET_PROFILE: 'read-only',
    INTAKE_READ_ORIGIN: 'https://inventory.example.invalid',
    INTAKE_CREDENTIAL_REF: 'inventree_inventory_example_invalid',
    INTAKE_DEV_API_KEY: 'synthetic-read-token',
  })
  assert.equal(external.readOnly, true)
})

test('an explicit credential reference replaces the derived one', () => {
  const resolved = resolveDevelopmentSettings({
    ...EXTERNAL,
    INTAKE_CREDENTIAL_REF: 'development_inventory',
  })
  assert.equal(resolved.targetSettings.INTAKE_CREDENTIAL_REF, 'development_inventory')
})

test('the derived reference keeps to the allowed characters and length', () => {
  const host = `${'a'.repeat(150)}.example`
  const resolved = resolveDevelopmentSettings({
    ...EXTERNAL,
    INTAKE_INVENTREE_URL: `http://${host}:8080`,
  })
  const reference = resolved.targetSettings.INTAKE_CREDENTIAL_REF
  assert.match(reference, /^[a-zA-Z0-9_-]{1,128}$/)
  assert.equal(reference.length, 128)
})

test('an unparseable URL is left for the target policy to refuse', () => {
  const resolved = resolveDevelopmentSettings({ ...EXTERNAL, INTAKE_INVENTREE_URL: 'not a url' })
  assert.equal(resolved.targetSettings.INTAKE_READ_ORIGIN, 'not a url')
  assert.match(resolved.targetSettings.INTAKE_CREDENTIAL_REF, /^[a-zA-Z0-9_-]{1,128}$/)
})

test('an explicit mock overrides the real-server settings and names them', () => {
  const resolved = resolveDevelopmentSettings({
    INTAKE_USE_MOCK_INVENTREE: 'true',
    INTAKE_USE_LOCAL_INVENTREE: 'true',
    INTAKE_CREDENTIAL_REF: 'development_inventory',
    ...EXTERNAL,
  })
  assert.deepEqual(resolved.targetSettings, { INTAKE_TARGET_PROFILE: 'fake' })
  assert.deepEqual(resolved.ignored, [
    'INTAKE_USE_LOCAL_INVENTREE',
    'INTAKE_INVENTREE_URL',
    'INTAKE_INVENTREE_TOKEN',
    'INTAKE_CREDENTIAL_REF',
  ])
})

test('the read-only switch applies to the mock and refuses writes to a real server', () => {
  assert.equal(resolveDevelopmentSettings({ INTAKE_INVENTREE_READ_ONLY: 'true' }).readOnly, true)
  assert.equal(
    resolveDevelopmentSettings({
      INTAKE_USE_LOCAL_INVENTREE: 'true',
      INTAKE_INVENTREE_READ_ONLY: 'true',
    }).readOnly,
    true,
  )
  refusal(
    { INTAKE_USE_LOCAL_INVENTREE: 'true', INTAKE_INVENTREE_READ_ONLY: 'false' },
    'inventree_writes_not_supported',
  )
  refusal({ ...EXTERNAL, INTAKE_INVENTREE_READ_ONLY: '0' }, 'inventree_writes_not_supported')
})

test('contradictory or incomplete inventory settings are refused', () => {
  refusal({ INTAKE_USE_MOCK_INVENTREE: 'false' }, 'inventree_server_required')
  refusal(
    { INTAKE_USE_LOCAL_INVENTREE: 'true', ...EXTERNAL },
    'conflicting_development_target_settings',
  )
  refusal(
    { INTAKE_USE_LOCAL_INVENTREE: 'true', INTAKE_INVENTREE_TOKEN: 'x' },
    'conflicting_development_target_settings',
  )
  refusal(
    { INTAKE_USE_LOCAL_INVENTREE: 'true', INTAKE_CREDENTIAL_REF: 'x' },
    'conflicting_development_target_settings',
  )
  refusal({ INTAKE_INVENTREE_TOKEN: 'x' }, 'conflicting_development_target_settings')
  assert.throws(
    () =>
      resolveDevelopmentSettings({
        INTAKE_USE_LOCAL_INVENTREE: 'true',
        INTAKE_DEV_ADMIN_URL: 'postgres://a',
      }),
    (error) =>
      error.message === 'conflicting_development_target_settings' &&
      error.names.some((entry) => entry.name === 'INTAKE_DEV_ADMIN_URL'),
  )
  refusal({ INTAKE_CREDENTIAL_REF: 'x' }, 'conflicting_development_target_settings')
})

test('switches accept true/false/1/0 in any case and treat empty as unset', () => {
  assert.equal(
    resolveDevelopmentSettings({ INTAKE_USE_AGENT_SESSIONS: 'FALSE' }).profile,
    'synthetic-research/2',
  )
  assert.equal(
    resolveDevelopmentSettings({ INTAKE_USE_AGENT_SESSIONS: '0' }).profile,
    'synthetic-research/2',
  )
  assert.equal(
    resolveDevelopmentSettings({ INTAKE_USE_AGENT_SESSIONS: '' }).profile,
    'synthetic-session/1',
  )
  assert.deepEqual(resolveDevelopmentSettings({ INTAKE_INVENTREE_URL: '' }).targetSettings, {
    INTAKE_TARGET_PROFILE: 'fake',
  })
})

test('an invalid switch value names the variable without echoing the value', () => {
  try {
    resolveDevelopmentSettings({ INTAKE_USE_MOCK_AI_AGENTS: 'secret-looking-yes' })
    assert.fail('expected a refusal')
  } catch (error) {
    assert.ok(error instanceof DevelopmentSettingsError)
    assert.equal(error.message, 'invalid_development_setting')
    assert.deepEqual(error.names, [{ name: 'INTAKE_USE_MOCK_AI_AGENTS' }])
    assert.doesNotMatch(JSON.stringify(error.names), /secret-looking-yes/)
  }
})

test('retired names are refused with their replacements and no values', () => {
  try {
    resolveDevelopmentSettings({
      INTAKE_TARGET_PROFILE: 'local-inventree',
      INTAKE_PROCESSING_PROFILE: 'native-agent/2',
      INTAKE_READ_ORIGIN: 'https://inventory.example.invalid',
      INTAKE_DEV_API_KEY: 'synthetic-secret',
      INTAKE_PERSONAL_MANAGEMENT: '1',
    })
    assert.fail('expected a refusal')
  } catch (error) {
    assert.ok(error instanceof DevelopmentSettingsError)
    assert.equal(error.message, 'retired_development_setting')
    assert.deepEqual(
      error.names.map((entry) => entry.name),
      [
        'INTAKE_TARGET_PROFILE',
        'INTAKE_PROCESSING_PROFILE',
        'INTAKE_READ_ORIGIN',
        'INTAKE_DEV_API_KEY',
        'INTAKE_PERSONAL_MANAGEMENT',
      ],
    )
    for (const entry of error.names) {
      assert.match(entry.replacement, /^INTAKE_[A-Z_]+/)
    }
    assert.doesNotMatch(
      JSON.stringify(error.names),
      /synthetic-secret|native-agent|local-inventree/,
    )
  }
})

test('a conflict names the variables involved without their values', () => {
  try {
    resolveDevelopmentSettings({ INTAKE_CREDENTIAL_REF: 'secret-looking-ref' })
    assert.fail('expected a refusal')
  } catch (error) {
    assert.equal(error.message, 'conflicting_development_target_settings')
    assert.deepEqual(
      error.names.map((entry) => entry.name),
      ['INTAKE_CREDENTIAL_REF'],
    )
    assert.doesNotMatch(JSON.stringify(error.names), /secret-looking-ref/)
  }
  try {
    resolveDevelopmentSettings({ INTAKE_USE_LOCAL_INVENTREE: 'true', ...EXTERNAL })
    assert.fail('expected a refusal')
  } catch (error) {
    assert.deepEqual(
      error.names.map((entry) => entry.name),
      ['INTAKE_INVENTREE_URL', 'INTAKE_INVENTREE_TOKEN'],
    )
  }
})

test('an empty retired name is treated as unset', () => {
  assert.equal(
    resolveDevelopmentSettings({ INTAKE_DEV_API_KEY: '' }).profile,
    'synthetic-session/1',
  )
})

const { targetEnvironment } = require('../dev/settings.cjs')

test('the target environment replaces every user target value with the resolved ones', () => {
  const settings = {
    INTAKE_DEV_STATE: '/state',
    INTAKE_DEV_ADMIN_URL: 'postgres://admin',
    INTAKE_CREDENTIAL_REF: 'ignored',
    INTAKE_READ_ORIGIN: '',
    INTAKE_DEV_API_KEY: '',
    INTAKE_TARGET_PROFILE: '',
    INTAKE_INVENTREE_TOKEN: 'ignored',
  }
  assert.deepEqual(targetEnvironment(settings, { INTAKE_TARGET_PROFILE: 'fake' }), {
    INTAKE_DEV_STATE: '/state',
    INTAKE_DEV_ADMIN_URL: 'postgres://admin',
    INTAKE_TARGET_PROFILE: 'fake',
  })
})

const { settingsRefusalLines } = require('../dev/settings.cjs')

test('a refusal prints its code, then each named variable and its replacement', () => {
  const lines = settingsRefusalLines(
    new DevelopmentSettingsError('retired_development_setting', [
      { name: 'INTAKE_DEV_API_KEY', replacement: 'INTAKE_INVENTREE_TOKEN' },
    ]),
  )
  assert.deepEqual(lines, [
    'retired_development_setting',
    '  INTAKE_DEV_API_KEY: use INTAKE_INVENTREE_TOKEN',
  ])
  assert.deepEqual(
    settingsRefusalLines(
      new DevelopmentSettingsError('invalid_development_setting', [{ name: 'INTAKE_X' }]),
    ),
    ['invalid_development_setting', '  INTAKE_X'],
  )
})

const { pathToFileURL } = require('node:url')
const { join } = require('node:path')
const {
  agentProtectedOrigins,
  agentWorkerSettings,
  personalManagementFlag,
  startupSummary,
} = require('../dev/settings.cjs')

test('scripted agents get no provider access; real agents get it; VM agents get the resolved pairing and protected origins', () => {
  const providers = {
    OPENAI_API_KEY: 'synthetic-openai',
    ANTHROPIC_API_KEY: 'synthetic-anthropic',
  }
  const origins = {
    appOrigin: 'http://127.0.0.1:4330',
    tailnetOrigin: 'https://bench.tailnet.ts.net',
    inventoryOrigin: 'https://inventory.example.com',
  }
  const worker = (settings) =>
    agentWorkerSettings(resolveDevelopmentSettings(settings, STATE), settings, origins)
  assert.deepEqual(worker({ ...providers }), {})
  const protectedOrigins =
    'http://127.0.0.1:4330,https://bench.tailnet.ts.net,https://inventory.example.com'
  const pairing = {
    INTAKE_VM_PAIR: '/state/vm-pair',
    INTAKE_VM_PORT: '14313',
    INTAKE_AGENT_PROTECTED_ORIGINS: protectedOrigins,
  }
  for (const settings of [
    { INTAKE_RUN_AGENTS_IN_VM: 'true' },
    { INTAKE_RUN_AGENTS_IN_VM: 'true', INTAKE_USE_MOCK_AI_AGENTS: 'false' },
    {
      INTAKE_RUN_AGENTS_IN_VM: 'true',
      INTAKE_USE_MOCK_AI_AGENTS: 'false',
      INTAKE_VM_MANAGED: 'false',
    },
  ]) {
    assert.deepEqual(worker({ ...settings, ...providers }), pairing, JSON.stringify(settings))
  }
  assert.equal(
    worker({ INTAKE_RUN_AGENTS_IN_VM: 'true', INTAKE_VM_EVIDENCE_IMAGE: 'original' })
      .INTAKE_VM_EVIDENCE_IMAGE,
    'original',
  )
  assert.deepEqual(
    refusedNames({ INTAKE_VM_EVIDENCE_IMAGE: 'large' }, 'invalid_development_setting'),
    ['INTAKE_VM_EVIDENCE_IMAGE'],
  )
  const vmWorker = worker({ INTAKE_RUN_AGENTS_IN_VM: 'true', ...VM })
  assert.deepEqual(vmWorker, {
    INTAKE_VM_PAIR: '/pair',
    INTAKE_VM_PORT: '14313',
    INTAKE_AGENT_PROTECTED_ORIGINS: protectedOrigins,
  })
  // The worker's own app origin stays the API's loopback one; the tailnet name is only protected.
  assert.equal('INTAKE_ORIGIN' in vmWorker, false)
  assert.deepEqual(worker({ INTAKE_USE_MOCK_AI_AGENTS: 'false', ...providers }), providers)
})

test('the agent worker gets the app, tailnet and inventory origins to protect', () => {
  assert.equal(
    agentProtectedOrigins({
      appOrigin: 'http://127.0.0.1:4330',
      tailnetOrigin: 'https://bench.tailnet.ts.net',
      inventoryOrigin: 'https://inventory.example.com',
    }),
    'http://127.0.0.1:4330,https://bench.tailnet.ts.net,https://inventory.example.com',
  )
  assert.equal(
    agentProtectedOrigins({
      appOrigin: 'http://127.0.0.1:4330',
      tailnetOrigin: undefined,
      inventoryOrigin: 'http://127.0.0.1:4320',
    }),
    'http://127.0.0.1:4330,http://127.0.0.1:4320',
  )
})

test('protected origins are refused when the app or inventory origin is missing', () => {
  assert.throws(
    () =>
      agentWorkerSettings(
        resolveDevelopmentSettings({ INTAKE_RUN_AGENTS_IN_VM: 'true' }, STATE),
        {},
        undefined,
      ),
    /protected_origins_unavailable/,
  )
  assert.throws(
    () => agentProtectedOrigins({ appOrigin: 'http://127.0.0.1:4330', inventoryOrigin: '' }),
    /protected_origins_unavailable/,
  )
  assert.throws(
    () => agentProtectedOrigins({ appOrigin: '', inventoryOrigin: 'http://127.0.0.1:4320' }),
    /protected_origins_unavailable/,
  )
})

test('the credential-management proxy is on only with VM agents', () => {
  assert.equal(personalManagementFlag(resolveDevelopmentSettings({})), undefined)
  assert.equal(
    personalManagementFlag(resolveDevelopmentSettings({ INTAKE_RUN_AGENTS_IN_VM: 'true', ...VM })),
    '1',
  )
})

test('the startup summary names the inventory, access, profile and ignored settings', () => {
  assert.equal(
    startupSummary('fake', resolveDevelopmentSettings({})),
    'Inventory: mock (writable).\nProcessing: synthetic-session/1.\n',
  )
  const overridden = resolveDevelopmentSettings({
    INTAKE_USE_MOCK_INVENTREE: 'true',
    INTAKE_INVENTREE_READ_ONLY: 'true',
    INTAKE_RUN_AGENTS_IN_VM: 'true',
    INTAKE_USE_LOCAL_INVENTREE: 'true',
    ...VM,
  })
  assert.equal(
    startupSummary('fake', overridden),
    'Inventory: mock (read-only).\nProcessing: synthetic-session/1 in the VM.\n' +
      'Ignored because the mock inventory is selected: INTAKE_USE_LOCAL_INVENTREE.\n',
  )
  assert.match(
    startupSummary(
      'local-inventree',
      resolveDevelopmentSettings({ INTAKE_USE_LOCAL_INVENTREE: 'true' }),
    ),
    /^Inventory: local InvenTree \(read-only\)\./,
  )
})

test('the target policy accepts every derived credential reference', async () => {
  const { developmentTarget } = await import(
    pathToFileURL(join(__dirname, '../../intake-server/src/dev/target.ts')).href
  )
  for (const address of [
    'https://inventory.example.invalid',
    'http://[::1]:8080',
    'https://bücher.example',
    `http://${'a'.repeat(150)}.example`,
  ]) {
    const { targetSettings } = resolveDevelopmentSettings({
      INTAKE_INVENTREE_URL: address,
      INTAKE_INVENTREE_TOKEN: 'synthetic-read-token',
    })
    const target = developmentTarget(targetSettings)
    assert.equal(target.kind, 'read-only', address)
    assert.equal(target.credentialRef, targetSettings.INTAKE_CREDENTIAL_REF)
  }
})

const { withTargetSettingNames } = require('../dev/settings.cjs')

test('external-target refusals from the target policy name the settings to fix', () => {
  for (const [code, names] of [
    ['development_read_key_required', ['INTAKE_INVENTREE_TOKEN']],
    ['development_read_target_required', ['INTAKE_INVENTREE_URL', 'INTAKE_CREDENTIAL_REF']],
    ['invalid_development_target_origin', ['INTAKE_INVENTREE_URL']],
  ]) {
    assert.throws(
      () =>
        withTargetSettingNames(
          () => {
            throw new Error(code)
          },
          { INTAKE_CREDENTIAL_REF: 'explicit' },
        ),
      (error) =>
        error instanceof DevelopmentSettingsError &&
        error.message === code &&
        JSON.stringify(error.names.map((entry) => entry.name)) === JSON.stringify(names),
    )
  }
  assert.throws(
    () =>
      withTargetSettingNames(() => {
        throw new Error('something_else')
      }),
    (error) => !(error instanceof DevelopmentSettingsError) && error.message === 'something_else',
  )
  assert.equal(
    withTargetSettingNames(() => 'value'),
    'value',
  )
  assert.throws(
    () =>
      withTargetSettingNames(() => {
        throw new Error('development_read_target_required')
      }, {}),
    (error) => JSON.stringify(error.names) === JSON.stringify([{ name: 'INTAKE_INVENTREE_URL' }]),
  )
})

test('an empty admin URL is unset for the local target', () => {
  const settings = { INTAKE_USE_LOCAL_INVENTREE: 'true', INTAKE_DEV_ADMIN_URL: '' }
  const { targetSettings } = resolveDevelopmentSettings(settings)
  assert.deepEqual(targetEnvironment(settings, targetSettings), {
    INTAKE_USE_LOCAL_INVENTREE: 'true',
    INTAKE_TARGET_PROFILE: 'local-inventree',
  })
})

const REAL_VM_AGENTS = {
  INTAKE_USE_MOCK_AI_AGENTS: 'false',
  INTAKE_RUN_AGENTS_IN_VM: 'true',
}
const VM_EXPLICIT = {
  INTAKE_VM_PAIR: '/pair',
  INTAKE_VM_PORT: '14320',
  INTAKE_VM_NAME: 'bench-agent-test',
  INTAKE_VM_GUEST_DIR: '/var/tmp/bench-paired',
  INTAKE_VM_RUNNER_IMAGE: 'bench-intake-runner:personal-test',
}

test('real VM agents get a managed VM with every default', () => {
  const resolved = resolveDevelopmentSettings(REAL_VM_AGENTS, STATE)
  assert.deepEqual(resolved.vm, {
    name: 'bench-agent',
    guestDir: null,
    image: 'bench-intake-runner:personal',
    pair: '/state/vm-pair',
    port: '14313',
    tools: true,
    evidenceDelivery: 'file',
    keepRunning: false,
  })
  assert.deepEqual(resolved.defaulted, [
    'INTAKE_VM_PAIR',
    'INTAKE_VM_PORT',
    'INTAKE_VM_NAME',
    'INTAKE_VM_GUEST_DIR',
    'INTAKE_VM_RUNNER_IMAGE',
  ])
})

test('explicit VM values win and are not marked as defaults', () => {
  const resolved = resolveDevelopmentSettings({ ...REAL_VM_AGENTS, ...VM_EXPLICIT }, STATE)
  assert.deepEqual(resolved.vm, {
    name: 'bench-agent-test',
    guestDir: '/var/tmp/bench-paired',
    image: 'bench-intake-runner:personal-test',
    pair: '/pair',
    port: '14320',
    tools: true,
    evidenceDelivery: 'file',
    keepRunning: false,
  })
  assert.deepEqual(resolved.defaulted, [])
  const plan = resolveDevelopmentSettings(
    { ...REAL_VM_AGENTS, INTAKE_VM_AGENT_TOOLS: 'false', INTAKE_VM_KEEP_RUNNING: '1' },
    STATE,
  ).vm
  assert.equal(plan.tools, false)
  assert.equal(plan.keepRunning, true)
})

test('the pairing default follows the state directory it is given', () => {
  const resolved = resolveDevelopmentSettings(REAL_VM_AGENTS, { stateDirectory: '/other/state' })
  assert.equal(resolved.vm.pair, '/other/state/vm-pair')
})

test('management is off when opted out, and for scripted agents unless asked for', () => {
  assert.equal(
    resolveDevelopmentSettings({ ...REAL_VM_AGENTS, INTAKE_VM_MANAGED: 'false' }, STATE).vm,
    null,
  )
  assert.equal(resolveDevelopmentSettings({ INTAKE_RUN_AGENTS_IN_VM: 'true' }, STATE).vm, null)
  assert.equal(resolveDevelopmentSettings({}, STATE).vm, null)
  // A name alone no longer turns management on or off.
  assert.equal(
    resolveDevelopmentSettings({ INTAKE_RUN_AGENTS_IN_VM: 'true', INTAKE_VM_NAME: 'x' }, STATE).vm,
    null,
  )
})

test('asking for management without real VM agents is refused', () => {
  for (const settings of [
    { INTAKE_VM_MANAGED: 'true', INTAKE_RUN_AGENTS_IN_VM: 'true' },
    { INTAKE_VM_MANAGED: 'true', INTAKE_USE_MOCK_AI_AGENTS: 'false' },
  ]) {
    assert.deepEqual(
      refusedNames(settings, 'vm_launch_requires_real_vm_agents'),
      ['INTAKE_VM_MANAGED', 'INTAKE_RUN_AGENTS_IN_VM', 'INTAKE_USE_MOCK_AI_AGENTS'],
      JSON.stringify(settings),
    )
  }
})

test('malformed VM settings are refused by name, never by value', () => {
  const cases = [
    ['INTAKE_VM_NAME', 'Bench Agent'],
    ['INTAKE_VM_NAME', '--debug'],
    ['INTAKE_VM_GUEST_DIR', 'relative/dir'],
    ['INTAKE_VM_GUEST_DIR', '/dir with space'],
    ['INTAKE_VM_RUNNER_IMAGE', 'image name'],
    ['INTAKE_VM_RUNNER_IMAGE', '-flag'],
    ['INTAKE_VM_PORT', '70000'],
  ]
  for (const [name, value] of cases) {
    const settings = { ...REAL_VM_AGENTS, ...VM_EXPLICIT, [name]: value }
    assert.deepEqual(refusedNames(settings, 'invalid_vm_launch_setting'), [name], value)
    let lines
    try {
      resolveDevelopmentSettings(settings, STATE)
    } catch (error) {
      lines = settingsRefusalLines(error).join('\n')
    }
    assert.ok(!lines.includes(value), `refusal must not contain ${value}`)
  }
})

test('the VM switches are checked whether or not a VM is managed', () => {
  for (const name of ['INTAKE_VM_KEEP_RUNNING', 'INTAKE_VM_MANAGED']) {
    assert.deepEqual(refusedNames({ [name]: 'maybe' }, 'invalid_development_setting'), [name])
    assert.deepEqual(
      refusedNames({ ...REAL_VM_AGENTS, [name]: 'yes' }, 'invalid_development_setting'),
      [name],
    )
  }
})

test('the startup summary names the managed VM and every default it filled in', () => {
  const summary = startupSummary('fake', resolveDevelopmentSettings(REAL_VM_AGENTS, STATE))
  assert.equal(
    summary,
    'Inventory: mock (writable).\nProcessing: shared-vm-agent/3 in the VM.\n' +
      'VM: bench-agent, started with the app and stopped with it if this run starts it.\n' +
      'Defaults used: INTAKE_VM_PAIR=/state/vm-pair, INTAKE_VM_PORT=14313, ' +
      'INTAKE_VM_NAME=bench-agent, INTAKE_VM_GUEST_DIR=bench-intake-guest in the guest home, ' +
      'INTAKE_VM_RUNNER_IMAGE=bench-intake-runner:personal.\n',
  )
  const kept = resolveDevelopmentSettings(
    { ...REAL_VM_AGENTS, ...VM_EXPLICIT, INTAKE_VM_KEEP_RUNNING: 'true' },
    STATE,
  )
  assert.match(
    startupSummary('fake', kept),
    /VM: bench-agent-test, started with the app and kept running afterwards\.\n$/,
  )
  const unmanaged = resolveDevelopmentSettings({ INTAKE_RUN_AGENTS_IN_VM: 'true', ...VM }, STATE)
  assert.doesNotMatch(startupSummary('fake', unmanaged), /VM:|Defaults used/)
})

test('defaults are reported for unmanaged VM modes too', () => {
  for (const settings of [
    { INTAKE_RUN_AGENTS_IN_VM: 'true' },
    { ...REAL_VM_AGENTS, INTAKE_VM_MANAGED: 'false' },
  ]) {
    const summary = startupSummary('fake', resolveDevelopmentSettings(settings, STATE))
    assert.doesNotMatch(summary, /^VM:/m, JSON.stringify(settings))
    assert.match(
      summary,
      /Defaults used: INTAKE_VM_PAIR=\/state\/vm-pair, INTAKE_VM_PORT=14313\.\n$/,
      JSON.stringify(settings),
    )
  }
})

test('VM evidence delivery validates and defaults before launch', () => {
  const base = { INTAKE_USE_MOCK_AI_AGENTS: 'false', INTAKE_RUN_AGENTS_IN_VM: 'true', ...VM }
  for (const value of [undefined, '', 'inline', 'file']) {
    const resolved = resolveDevelopmentSettings(
      { ...base, INTAKE_VM_EVIDENCE_DELIVERY: value },
      STATE,
    )
    assert.equal(resolved.vm.evidenceDelivery, value || 'file')
  }
  assert.deepEqual(
    refusedNames({ INTAKE_VM_EVIDENCE_DELIVERY: 'typo' }, 'invalid_development_setting'),
    ['INTAKE_VM_EVIDENCE_DELIVERY'],
  )
})
