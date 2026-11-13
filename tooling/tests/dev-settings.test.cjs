const test = require('node:test')
const assert = require('node:assert/strict')
const { resolveDevelopmentSettings, DevelopmentSettingsError } = require('../dev/settings.cjs')

const VM = { INTAKE_VM_PAIR: '/pair', INTAKE_VM_PORT: '14313' }
const EXTERNAL = {
  INTAKE_INVENTREE_URL: 'https://inventory.example.invalid',
  INTAKE_INVENTREE_TOKEN: 'synthetic-read-token',
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
      'shared-vm-agent/2',
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

test('VM agents need sessions and a pairing', () => {
  refusal(
    { INTAKE_RUN_AGENTS_IN_VM: 'true', INTAKE_USE_AGENT_SESSIONS: 'false', ...VM },
    'unsupported_agent_settings',
  )
  refusal({ INTAKE_RUN_AGENTS_IN_VM: 'true' }, 'vm_pairing_required')
  refusal({ INTAKE_RUN_AGENTS_IN_VM: 'true', INTAKE_VM_PAIR: '/pair' }, 'vm_pairing_required')
  assert.equal(resolveDevelopmentSettings({ INTAKE_RUN_AGENTS_IN_VM: '1', ...VM }).agentsInVm, true)
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
  agentWorkerSettingNames,
  personalManagementFlag,
  startupSummary,
} = require('../dev/settings.cjs')

test('scripted agents get no provider access; real agents get it; VM agents get only the pairing', () => {
  assert.deepEqual(agentWorkerSettingNames(resolveDevelopmentSettings({})), [])
  assert.deepEqual(
    agentWorkerSettingNames(resolveDevelopmentSettings({ INTAKE_RUN_AGENTS_IN_VM: 'true', ...VM })),
    ['INTAKE_VM_PAIR', 'INTAKE_VM_PORT'],
  )
  assert.deepEqual(
    agentWorkerSettingNames(
      resolveDevelopmentSettings({
        INTAKE_USE_MOCK_AI_AGENTS: 'false',
        INTAKE_RUN_AGENTS_IN_VM: 'true',
        ...VM,
      }),
    ),
    ['INTAKE_VM_PAIR', 'INTAKE_VM_PORT'],
  )
  assert.deepEqual(
    agentWorkerSettingNames(resolveDevelopmentSettings({ INTAKE_USE_MOCK_AI_AGENTS: 'false' })),
    ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'INTAKE_CODEX_EXECUTABLE', 'INTAKE_CLAUDE_EXECUTABLE'],
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
  ...VM,
}
const VM_LAUNCH = {
  INTAKE_VM_NAME: 'bench-agent-test',
  INTAKE_VM_GUEST_DIR: '/var/tmp/bench-paired',
  INTAKE_VM_RUNNER_IMAGE: 'bench-intake-runner:personal-test',
}

function refusedNames(settings, code) {
  try {
    resolveDevelopmentSettings(settings)
  } catch (error) {
    assert.ok(error instanceof DevelopmentSettingsError)
    assert.equal(error.message, code)
    return error.names.map(({ name }) => name)
  }
  assert.fail(`expected ${code}`)
}

test('without a VM name the launcher manages no VM', () => {
  assert.equal(resolveDevelopmentSettings({}).vm, null)
  assert.equal(resolveDevelopmentSettings(REAL_VM_AGENTS).vm, null)
})

test('a named VM with real VM agents yields the launch plan', () => {
  assert.deepEqual(resolveDevelopmentSettings({ ...REAL_VM_AGENTS, ...VM_LAUNCH }).vm, {
    name: 'bench-agent-test',
    guestDir: '/var/tmp/bench-paired',
    image: 'bench-intake-runner:personal-test',
    port: '14313',
    tools: true,
    keepRunning: false,
  })
  const plan = resolveDevelopmentSettings({
    ...REAL_VM_AGENTS,
    ...VM_LAUNCH,
    INTAKE_VM_AGENT_TOOLS: 'false',
    INTAKE_VM_KEEP_RUNNING: '1',
  }).vm
  assert.equal(plan.tools, false)
  assert.equal(plan.keepRunning, true)
})

test('a named VM needs real agents in the VM', () => {
  assert.deepEqual(
    refusedNames(
      { ...VM_LAUNCH, INTAKE_USE_MOCK_AI_AGENTS: 'false' },
      'vm_launch_requires_real_vm_agents',
    ),
    ['INTAKE_VM_NAME', 'INTAKE_RUN_AGENTS_IN_VM', 'INTAKE_USE_MOCK_AI_AGENTS'],
  )
  assert.deepEqual(
    refusedNames(
      { ...VM_LAUNCH, INTAKE_RUN_AGENTS_IN_VM: 'true', ...VM },
      'vm_launch_requires_real_vm_agents',
    ),
    ['INTAKE_VM_NAME', 'INTAKE_RUN_AGENTS_IN_VM', 'INTAKE_USE_MOCK_AI_AGENTS'],
  )
})

test('a named VM needs its guest directory and runner image', () => {
  assert.deepEqual(
    refusedNames(
      { ...REAL_VM_AGENTS, INTAKE_VM_NAME: 'bench-agent-test' },
      'vm_launch_setting_required',
    ),
    ['INTAKE_VM_GUEST_DIR', 'INTAKE_VM_RUNNER_IMAGE'],
  )
  assert.deepEqual(
    refusedNames(
      { ...REAL_VM_AGENTS, ...VM_LAUNCH, INTAKE_VM_GUEST_DIR: '' },
      'vm_launch_setting_required',
    ),
    ['INTAKE_VM_GUEST_DIR'],
  )
})

test('malformed VM settings are refused by name, never by value', () => {
  const cases = [
    ['INTAKE_VM_NAME', 'Bench Agent'],
    ['INTAKE_VM_GUEST_DIR', 'relative/dir'],
    ['INTAKE_VM_GUEST_DIR', '/dir with space'],
    ['INTAKE_VM_RUNNER_IMAGE', 'image name'],
    ['INTAKE_VM_RUNNER_IMAGE', '-flag'],
  ]
  for (const [name, value] of cases) {
    const settings = { ...REAL_VM_AGENTS, ...VM_LAUNCH, [name]: value }
    assert.deepEqual(refusedNames(settings, 'invalid_vm_launch_setting'), [name], value)
    let lines
    try {
      resolveDevelopmentSettings(settings)
    } catch (error) {
      lines = settingsRefusalLines(error).join('\n')
    }
    assert.ok(!lines.includes(value), `refusal must not contain ${value}`)
  }
  assert.deepEqual(
    refusedNames(
      { ...REAL_VM_AGENTS, ...VM_LAUNCH, INTAKE_VM_KEEP_RUNNING: 'yes' },
      'invalid_development_setting',
    ),
    ['INTAKE_VM_KEEP_RUNNING'],
  )
})

test('the startup summary says whether the launcher manages the VM', () => {
  const managed = resolveDevelopmentSettings({ ...REAL_VM_AGENTS, ...VM_LAUNCH })
  assert.equal(
    startupSummary('fake', managed),
    'Inventory: mock (writable).\nProcessing: shared-vm-agent/2 in the VM.\n' +
      'VM: bench-agent-test, started with the app and stopped with it if this run starts it.\n',
  )
  const kept = resolveDevelopmentSettings({
    ...REAL_VM_AGENTS,
    ...VM_LAUNCH,
    INTAKE_VM_KEEP_RUNNING: 'true',
  })
  assert.match(
    startupSummary('fake', kept),
    /VM: bench-agent-test, started with the app and kept running afterwards\.\n$/,
  )
  assert.doesNotMatch(startupSummary('fake', resolveDevelopmentSettings(REAL_VM_AGENTS)), /VM:/)
})

test('the keep-running switch is checked even without a VM name', () => {
  assert.deepEqual(refusedNames({ INTAKE_VM_KEEP_RUNNING: 'yes' }, 'invalid_development_setting'), [
    'INTAKE_VM_KEEP_RUNNING',
  ])
  assert.deepEqual(
    refusedNames(
      { ...REAL_VM_AGENTS, INTAKE_VM_NAME: 'bench-agent-test', INTAKE_VM_KEEP_RUNNING: 'yes' },
      'invalid_development_setting',
    ),
    ['INTAKE_VM_KEEP_RUNNING'],
  )
})

test('a named VM needs a port the relay accepts', () => {
  for (const port of ['0', '65536', '14313x', '-1']) {
    assert.deepEqual(
      refusedNames(
        { ...REAL_VM_AGENTS, ...VM_LAUNCH, INTAKE_VM_PORT: port },
        'invalid_vm_launch_setting',
      ),
      ['INTAKE_VM_PORT'],
      port,
    )
  }
})
