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
      assert.match(entry.replacement, /^INTAKE_[A-Z_]+(, INTAKE_[A-Z_]+)*$/)
    }
    assert.doesNotMatch(
      JSON.stringify(error.names),
      /synthetic-secret|native-agent|local-inventree/,
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
