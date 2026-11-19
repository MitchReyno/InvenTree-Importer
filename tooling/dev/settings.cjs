/**
 * Turns the `pnpm dev` switches into the internal target settings and processing profile its
 * children understand. Pure: no files, network or processes.
 */

const { join } = require('node:path')

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
  if (mockAgents) {
    return {
      profile: sessions ? 'synthetic-session/1' : 'synthetic-research/2',
      mockAgents,
      agentsInVm,
      vmTools,
    }
  }
  if (agentsInVm) {
    return {
      profile: vmTools ? 'shared-vm-agent/2' : 'shared-vm-agent/1',
      mockAgents,
      agentsInVm,
      vmTools,
    }
  }
  return {
    profile: sessions ? 'native-agent/2' : 'native-agent/1',
    mockAgents,
    agentsInVm,
    vmTools,
  }
}

/** The forms `tooling/deployment/bridge/relay.mjs` accepts, so the launcher never starts a relay it refuses. */
const VM_LAUNCH_FORMS = {
  INTAKE_VM_NAME: /^[a-z0-9][a-z0-9-]*$/,
  INTAKE_VM_GUEST_DIR: /^\/[a-zA-Z0-9_./-]+$/,
  INTAKE_VM_RUNNER_IMAGE: /^[a-zA-Z0-9][a-zA-Z0-9._/:@-]+$/,
}

/** The port range `relay.mjs` accepts. */
function validRelayPort(value) {
  return /^[0-9]+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535
}

/** Defaults matching the README's VM walkthrough, so a fresh clone needs only the two switches. */
const VM_DEFAULTS = {
  INTAKE_VM_PORT: '14313',
  INTAKE_VM_NAME: 'bench-agent',
  INTAKE_VM_RUNNER_IMAGE: 'bench-intake-runner:personal',
}
/** The pairing directory's name inside the development state directory. */
const VM_PAIR_DIRECTORY = 'vm-pair'
/** Shown for a guest directory that is looked up inside the guest after boot. */
const GUEST_DIR_DEFAULT_LABEL = 'bench-intake-guest in the guest home'

/** The pairing directory and port the session worker uses whenever agents run in the VM. */
function resolveVmPairing(settings, stateDirectory, defaulted) {
  let pair = settings.INTAKE_VM_PAIR
  if (!present(settings, 'INTAKE_VM_PAIR')) {
    if (!stateDirectory) {
      // A programming error in the caller, not a setting the developer can fix.
      throw new Error('development_state_directory_required')
    }
    pair = join(stateDirectory, VM_PAIR_DIRECTORY)
    defaulted.push('INTAKE_VM_PAIR')
  }
  let port = settings.INTAKE_VM_PORT
  if (!present(settings, 'INTAKE_VM_PORT')) {
    port = VM_DEFAULTS.INTAKE_VM_PORT
    defaulted.push('INTAKE_VM_PORT')
  } else if (!validRelayPort(port)) {
    throw new DevelopmentSettingsError('invalid_vm_launch_setting', [{ name: 'INTAKE_VM_PORT' }])
  }
  return { pair, port }
}

/** Whether `pnpm dev` runs the VM side: on for real VM agents unless switched off. */
function resolveManaged(settings, { mockAgents, agentsInVm }) {
  const requested = switchValue(settings, 'INTAKE_VM_MANAGED')
  const realVmAgents = agentsInVm && !mockAgents
  if (requested === true && !realVmAgents) {
    throw new DevelopmentSettingsError('vm_launch_requires_real_vm_agents', [
      { name: 'INTAKE_VM_MANAGED' },
      { name: 'INTAKE_RUN_AGENTS_IN_VM' },
      { name: 'INTAKE_USE_MOCK_AI_AGENTS' },
    ])
  }
  return requested ?? realVmAgents
}

/** The VM `pnpm dev` boots and relays into; a null guest directory is looked up after boot. */
function resolveVmLaunch(settings, pairing, { vmTools, keepRunning }, defaulted) {
  const value = (name) => {
    if (present(settings, name)) {
      return settings[name]
    }
    defaulted.push(name)
    return VM_DEFAULTS[name] ?? null
  }
  const name = value('INTAKE_VM_NAME')
  const guestDir = value('INTAKE_VM_GUEST_DIR')
  const image = value('INTAKE_VM_RUNNER_IMAGE')
  const malformed = Object.entries({
    INTAKE_VM_NAME: name,
    INTAKE_VM_GUEST_DIR: guestDir,
    INTAKE_VM_RUNNER_IMAGE: image,
  })
    .filter(([key, current]) => current !== null && !VM_LAUNCH_FORMS[key].test(current))
    .map(([key]) => ({ name: key }))
  if (malformed.length > 0) {
    throw new DevelopmentSettingsError('invalid_vm_launch_setting', malformed)
  }
  return {
    name,
    guestDir,
    image,
    pair: pairing.pair,
    port: pairing.port,
    tools: vmTools,
    keepRunning,
  }
}

/**
 * Resolves every `pnpm dev` switch before any setup. `targetSettings` uses the internal names
 * `developmentTarget` and the child processes read.
 */
function resolveDevelopmentSettings(settings, { stateDirectory } = {}) {
  refuseRetiredSettings(settings)
  const { targetSettings, ignored } = resolveInventory(settings)
  const readOnly = resolveReadOnly(settings, targetSettings.INTAKE_TARGET_PROFILE)
  const { profile, mockAgents, agentsInVm, vmTools } = resolveProcessing(settings)
  // Checked whether or not the VM is managed, like the other switches.
  const keepRunning = switchValue(settings, 'INTAKE_VM_KEEP_RUNNING') ?? false
  const managed = resolveManaged(settings, { mockAgents, agentsInVm })
  const defaulted = []
  const vmPairing = agentsInVm ? resolveVmPairing(settings, stateDirectory, defaulted) : null
  const vm = managed
    ? resolveVmLaunch(settings, vmPairing, { vmTools, keepRunning }, defaulted)
    : null
  return {
    targetSettings,
    readOnly,
    profile,
    mockAgents,
    agentsInVm,
    ignored,
    vmPairing,
    vm,
    defaulted,
  }
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

/** Settings the agent worker receives: the resolved VM pairing, provider access, or nothing. */
/**
 * Origins the VM agents' egress must refuse: the app (loopback and, when served, tailnet) and
 * the inventory it reads. The worker turns them into protected hosts and refuses to start
 * when one can't be represented.
 */
function agentProtectedOrigins({ appOrigin, tailnetOrigin, inventoryOrigin }) {
  if (!appOrigin || !inventoryOrigin) {
    throw new Error('protected_origins_unavailable')
  }
  return [appOrigin, tailnetOrigin, inventoryOrigin].filter(Boolean).join(',')
}

/**
 * The agent worker's provider and VM settings. VM agents also get the origins their egress
 * must protect; the worker's own app origin is not passed.
 */
function agentWorkerSettings(resolved, settings, origins) {
  if (resolved.vmPairing) {
    return {
      INTAKE_VM_PAIR: resolved.vmPairing.pair,
      INTAKE_VM_PORT: resolved.vmPairing.port,
      INTAKE_AGENT_PROTECTED_ORIGINS: agentProtectedOrigins(origins ?? {}),
    }
  }
  if (resolved.mockAgents) {
    return {}
  }
  const names = [
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'INTAKE_CODEX_EXECUTABLE',
    'INTAKE_CLAUDE_EXECUTABLE',
  ]
  return Object.fromEntries(
    names.filter((name) => settings[name]).map((name) => [name, settings[name]]),
  )
}

const INVENTORY_NAMES = {
  fake: 'mock',
  'local-inventree': 'local InvenTree',
  'read-only': 'external InvenTree',
}

/** Each defaulted VM value as `NAME=value`, in the order it was filled in. */
function defaultedValues(resolved) {
  const values = {
    INTAKE_VM_PAIR: resolved.vmPairing?.pair,
    INTAKE_VM_PORT: resolved.vmPairing?.port,
    INTAKE_VM_NAME: resolved.vm?.name,
    INTAKE_VM_GUEST_DIR: GUEST_DIR_DEFAULT_LABEL,
    INTAKE_VM_RUNNER_IMAGE: resolved.vm?.image,
  }
  return resolved.defaulted.map((name) => `${name}=${values[name]}`)
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
  if (resolved.defaulted.length > 0) {
    lines.push(`Defaults used: ${defaultedValues(resolved).join(', ')}.`)
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
  const details = error.names.map(({ name, replacement, hint }) => {
    if (replacement) {
      return `  ${name}: use ${replacement}`
    }
    return hint ? `  ${name}: ${hint}` : `  ${name}`
  })
  return [error.message, ...details]
}

/** An absolute guest directory in the form the relay accepts. */
function validGuestDirectory(path) {
  return VM_LAUNCH_FORMS.INTAKE_VM_GUEST_DIR.test(path)
}

module.exports = {
  validGuestDirectory,
  resolveDevelopmentSettings,
  targetEnvironment,
  settingsRefusalLines,
  withTargetSettingNames,
  agentProtectedOrigins,
  agentWorkerSettings,
  personalManagementFlag,
  startupSummary,
  DevelopmentSettingsError,
}
