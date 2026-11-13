/**
 * Turns the `pnpm dev` switches into the internal target settings and processing profile its
 * children understand. Pure: no files, network or processes.
 */

class DevelopmentSettingsError extends Error {
  /** @param {string} code @param {{ name: string, replacement?: string }[]} names */
  constructor(code, names = []) {
    super(code)
    this.names = names
  }
}

/** Replaced user-facing names; only their names are ever reported, never their values. */
const RETIRED_SETTINGS = [
  [
    'INTAKE_TARGET_PROFILE',
    'INTAKE_USE_MOCK_INVENTREE, INTAKE_USE_LOCAL_INVENTREE, INTAKE_INVENTREE_URL',
  ],
  [
    'INTAKE_PROCESSING_PROFILE',
    'INTAKE_USE_MOCK_AI_AGENTS, INTAKE_USE_AGENT_SESSIONS, INTAKE_RUN_AGENTS_IN_VM, INTAKE_VM_AGENT_TOOLS',
  ],
  ['INTAKE_READ_ORIGIN', 'INTAKE_INVENTREE_URL (keep INTAKE_CREDENTIAL_REF to reuse its data)'],
  ['INTAKE_DEV_API_KEY', 'INTAKE_INVENTREE_TOKEN'],
  ['INTAKE_PERSONAL_MANAGEMENT', 'INTAKE_RUN_AGENTS_IN_VM'],
]

/** The credential-reference length limit `developmentTarget` and the API enforce. */
const MAX_CREDENTIAL_REF_LENGTH = 128

function present(settings, name) {
  const value = settings[name]
  return value !== undefined && value !== ''
}

/** True, false, or undefined when unset; any other value is refused by name. */
function switchValue(settings, name) {
  if (!present(settings, name)) {
    return undefined
  }
  const value = settings[name].toLowerCase()
  if (value === 'true' || value === '1') {
    return true
  }
  if (value === 'false' || value === '0') {
    return false
  }
  throw new DevelopmentSettingsError('invalid_development_setting', [{ name }])
}

function refuseRetiredSettings(settings) {
  const retired = RETIRED_SETTINGS.filter(([name]) => present(settings, name)).map(
    ([name, replacement]) => ({ name, replacement }),
  )
  if (retired.length > 0) {
    throw new DevelopmentSettingsError('retired_development_setting', retired)
  }
}

/** A stable namespace reference for an external server, from its host. */
function derivedCredentialRef(address) {
  let host
  try {
    host = new URL(address).hostname
  } catch {
    // The target policy refuses the origin itself with its own code.
    return 'inventree'
  }
  const safeHost = host.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `inventree_${safeHost}`.slice(0, MAX_CREDENTIAL_REF_LENGTH)
}

function externalTarget(settings) {
  const address = settings.INTAKE_INVENTREE_URL
  const credentialRef = present(settings, 'INTAKE_CREDENTIAL_REF')
    ? settings.INTAKE_CREDENTIAL_REF
    : derivedCredentialRef(address)
  return {
    INTAKE_TARGET_PROFILE: 'read-only',
    INTAKE_READ_ORIGIN: address,
    INTAKE_CREDENTIAL_REF: credentialRef,
    ...(present(settings, 'INTAKE_INVENTREE_TOKEN')
      ? { INTAKE_DEV_API_KEY: settings.INTAKE_INVENTREE_TOKEN }
      : {}),
  }
}

/** Real-server settings an explicit mock overrides, in the order they are reported. */
function overriddenByMock(settings) {
  const ignored = []
  if (switchValue(settings, 'INTAKE_USE_LOCAL_INVENTREE') === true) {
    ignored.push('INTAKE_USE_LOCAL_INVENTREE')
  }
  for (const name of ['INTAKE_INVENTREE_URL', 'INTAKE_INVENTREE_TOKEN', 'INTAKE_CREDENTIAL_REF']) {
    if (present(settings, name)) {
      ignored.push(name)
    }
  }
  return ignored
}

function resolveInventory(settings) {
  const mock = switchValue(settings, 'INTAKE_USE_MOCK_INVENTREE')
  const local = switchValue(settings, 'INTAKE_USE_LOCAL_INVENTREE') === true
  const external = present(settings, 'INTAKE_INVENTREE_URL')
  const externalCredentials = ['INTAKE_INVENTREE_TOKEN', 'INTAKE_CREDENTIAL_REF'].filter((name) =>
    present(settings, name),
  )

  if (mock === true) {
    return {
      targetSettings: { INTAKE_TARGET_PROFILE: 'fake' },
      ignored: overriddenByMock(settings),
    }
  }

  // The local stack owns its origin, key and database server; nothing may redirect them.
  const localConflicts = [
    ...(external ? ['INTAKE_INVENTREE_URL'] : []),
    ...externalCredentials,
    ...(present(settings, 'INTAKE_DEV_ADMIN_URL') ? ['INTAKE_DEV_ADMIN_URL'] : []),
  ]
  if (local && localConflicts.length > 0) {
    throw new DevelopmentSettingsError(
      'conflicting_development_target_settings',
      localConflicts.map((name) => ({ name })),
    )
  }

  if (!external && externalCredentials.length > 0) {
    throw new DevelopmentSettingsError(
      'conflicting_development_target_settings',
      externalCredentials.map((name) => ({ name })),
    )
  }

  if (local) {
    return { targetSettings: { INTAKE_TARGET_PROFILE: 'local-inventree' }, ignored: [] }
  }
  if (external) {
    return { targetSettings: externalTarget(settings), ignored: [] }
  }
  if (mock === false) {
    throw new DevelopmentSettingsError('inventree_server_required')
  }
  return { targetSettings: { INTAKE_TARGET_PROFILE: 'fake' }, ignored: [] }
}

/** Only the owned mock can be written to; real servers are always read-only. */
function resolveReadOnly(settings, targetKind) {
  const requested = switchValue(settings, 'INTAKE_INVENTREE_READ_ONLY')
  const mock = targetKind === 'fake'
  if (!mock && requested === false) {
    throw new DevelopmentSettingsError('inventree_writes_not_supported')
  }
  return requested ?? !mock
}

function resolveProcessing(settings) {
  const mockAgents = switchValue(settings, 'INTAKE_USE_MOCK_AI_AGENTS') ?? true
  const sessions = switchValue(settings, 'INTAKE_USE_AGENT_SESSIONS') ?? true
  const agentsInVm = switchValue(settings, 'INTAKE_RUN_AGENTS_IN_VM') ?? false
  const vmTools = switchValue(settings, 'INTAKE_VM_AGENT_TOOLS') ?? true

  if (agentsInVm && !sessions) {
    throw new DevelopmentSettingsError('unsupported_agent_settings')
  }
  const vmPaired = present(settings, 'INTAKE_VM_PAIR') && present(settings, 'INTAKE_VM_PORT')
  if (agentsInVm && !vmPaired) {
    throw new DevelopmentSettingsError('vm_pairing_required')
  }
  if (mockAgents) {
    return {
      profile: sessions ? 'synthetic-session/1' : 'synthetic-research/2',
      mockAgents,
      agentsInVm,
    }
  }
  if (agentsInVm) {
    return { profile: vmTools ? 'shared-vm-agent/2' : 'shared-vm-agent/1', mockAgents, agentsInVm }
  }
  return { profile: sessions ? 'native-agent/2' : 'native-agent/1', mockAgents, agentsInVm }
}

/** The forms `tooling/deployment/bridge/relay.mjs` accepts, so the launcher never starts a relay it refuses. */
const VM_LAUNCH_FORMS = {
  INTAKE_VM_NAME: /^[a-z0-9-]+$/,
  INTAKE_VM_GUEST_DIR: /^\/[a-zA-Z0-9_./-]+$/,
  INTAKE_VM_RUNNER_IMAGE: /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$/,
}

/** The VM `pnpm dev` boots and relays into, or null when the developer runs the VM side themselves. */
function resolveVmLaunch(settings, processing) {
  if (!present(settings, 'INTAKE_VM_NAME')) {
    return null
  }
  if (!processing.agentsInVm || processing.mockAgents) {
    throw new DevelopmentSettingsError('vm_launch_requires_real_vm_agents', [
      { name: 'INTAKE_VM_NAME' },
      { name: 'INTAKE_RUN_AGENTS_IN_VM' },
      { name: 'INTAKE_USE_MOCK_AI_AGENTS' },
    ])
  }
  const missing = Object.keys(VM_LAUNCH_FORMS).filter((name) => !present(settings, name))
  if (missing.length > 0) {
    throw new DevelopmentSettingsError(
      'vm_launch_setting_required',
      missing.map((name) => ({ name })),
    )
  }
  const malformed = Object.entries(VM_LAUNCH_FORMS)
    .filter(([name, form]) => !form.test(settings[name]))
    .map(([name]) => ({ name }))
  if (malformed.length > 0) {
    throw new DevelopmentSettingsError('invalid_vm_launch_setting', malformed)
  }
  return {
    name: settings.INTAKE_VM_NAME,
    guestDir: settings.INTAKE_VM_GUEST_DIR,
    image: settings.INTAKE_VM_RUNNER_IMAGE,
    port: settings.INTAKE_VM_PORT,
    tools: switchValue(settings, 'INTAKE_VM_AGENT_TOOLS') ?? true,
    keepRunning: switchValue(settings, 'INTAKE_VM_KEEP_RUNNING') ?? false,
  }
}

/**
 * Resolves every `pnpm dev` switch before any setup. `targetSettings` uses the internal names
 * `developmentTarget` and the child processes read.
 */
function resolveDevelopmentSettings(settings) {
  refuseRetiredSettings(settings)
  const { targetSettings, ignored } = resolveInventory(settings)
  const readOnly = resolveReadOnly(settings, targetSettings.INTAKE_TARGET_PROFILE)
  const { profile, mockAgents, agentsInVm } = resolveProcessing(settings)
  const vm = resolveVmLaunch(settings, { mockAgents, agentsInVm })
  return { targetSettings, readOnly, profile, mockAgents, agentsInVm, ignored, vm }
}

/** User-facing and internal target names; only the resolved internal values may reach the policy. */
const TARGET_SETTING_NAMES = [
  'INTAKE_TARGET_PROFILE',
  'INTAKE_READ_ORIGIN',
  'INTAKE_CREDENTIAL_REF',
  'INTAKE_DEV_API_KEY',
  'INTAKE_INVENTREE_URL',
  'INTAKE_INVENTREE_TOKEN',
]

/** The settings `developmentTarget` and the state helpers read, with the resolved target in place. */
function targetEnvironment(settings, targetSettings) {
  // An empty admin URL means unset here too; the target policy would treat it as supplied.
  const others = Object.fromEntries(
    Object.entries(settings).filter(
      ([name, value]) =>
        !TARGET_SETTING_NAMES.includes(name) && !(name === 'INTAKE_DEV_ADMIN_URL' && value === ''),
    ),
  )
  return { ...others, ...targetSettings }
}

/** Settings the agent worker receives: the VM pairing, provider access, or nothing for scripted agents. */
function agentWorkerSettingNames(resolved) {
  if (resolved.agentsInVm) {
    return ['INTAKE_VM_PAIR', 'INTAKE_VM_PORT']
  }
  if (resolved.mockAgents) {
    return []
  }
  return [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'INTAKE_CODEX_EXECUTABLE',
    'INTAKE_CLAUDE_EXECUTABLE',
  ]
}

const INVENTORY_NAMES = {
  fake: 'mock',
  'local-inventree': 'local InvenTree',
  'read-only': 'external InvenTree',
}

/** What the app runs, in the terms of the switches that chose it. */
function startupSummary(targetKind, resolved) {
  const access = resolved.readOnly ? 'read-only' : 'writable'
  const where = resolved.agentsInVm ? ' in the VM' : ''
  const lines = [
    `Inventory: ${INVENTORY_NAMES[targetKind]} (${access}).`,
    `Processing: ${resolved.profile}${where}.`,
  ]
  if (resolved.ignored.length > 0) {
    lines.push(`Ignored because the mock inventory is selected: ${resolved.ignored.join(', ')}.`)
  }
  if (resolved.vm) {
    const afterwards = resolved.vm.keepRunning
      ? 'kept running afterwards'
      : 'stopped with it if this run starts it'
    lines.push(`VM: ${resolved.vm.name}, started with the app and ${afterwards}.`)
  }
  return `${lines.join('\n')}\n`
}

/** The dev UI proxies the VM's personal credential management only when agents run in the VM. */
function personalManagementFlag(resolved) {
  return resolved.agentsInVm ? '1' : undefined
}

/** The user-facing settings behind each external-target refusal from the target policy. */
const TARGET_REFUSAL_SETTINGS = {
  development_read_key_required: ['INTAKE_INVENTREE_TOKEN'],
  development_read_target_required: ['INTAKE_INVENTREE_URL', 'INTAKE_CREDENTIAL_REF'],
  invalid_development_target_origin: ['INTAKE_INVENTREE_URL'],
}

/**
 * Runs a target-policy step (`intake-server/src/dev/target.ts`, which owns these fixed codes),
 * naming the settings to fix when it refuses an external target.
 */
function withTargetSettingNames(step, settings = {}) {
  try {
    return step()
  } catch (error) {
    const names = TARGET_REFUSAL_SETTINGS[error?.message]
    if (!names) {
      throw error
    }
    // A derived reference is not something the user set, so it is not named.
    const named = names.filter(
      (name) => name !== 'INTAKE_CREDENTIAL_REF' || present(settings, name),
    )
    throw new DevelopmentSettingsError(
      error.message,
      named.map((name) => ({ name })),
    )
  }
}

/** The refusal code, then one line per named variable; values are never included. */
function settingsRefusalLines(error) {
  const details = error.names.map(({ name, replacement }) =>
    replacement ? `  ${name}: use ${replacement}` : `  ${name}`,
  )
  return [error.message, ...details]
}

module.exports = {
  resolveDevelopmentSettings,
  targetEnvironment,
  settingsRefusalLines,
  withTargetSettingNames,
  agentWorkerSettingNames,
  personalManagementFlag,
  startupSummary,
  DevelopmentSettingsError,
}
