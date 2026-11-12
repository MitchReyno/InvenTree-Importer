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

/** Replaced user-facing names; the values are never read, only reported by name. */
const RETIRED_SETTINGS = [
  [
    'INTAKE_TARGET_PROFILE',
    'INTAKE_USE_MOCK_INVENTREE, INTAKE_USE_LOCAL_INVENTREE, INTAKE_INVENTREE_URL',
  ],
  [
    'INTAKE_PROCESSING_PROFILE',
    'INTAKE_USE_MOCK_AI_AGENTS, INTAKE_USE_AGENT_SESSIONS, INTAKE_RUN_AGENTS_IN_VM, INTAKE_VM_AGENT_TOOLS',
  ],
  ['INTAKE_READ_ORIGIN', 'INTAKE_INVENTREE_URL'],
  ['INTAKE_DEV_API_KEY', 'INTAKE_INVENTREE_TOKEN'],
  ['INTAKE_PERSONAL_MANAGEMENT', 'INTAKE_RUN_AGENTS_IN_VM'],
]

/** The credential-reference pattern `developmentTarget` and the API enforce. */
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
  const externalOnly =
    present(settings, 'INTAKE_INVENTREE_TOKEN') || present(settings, 'INTAKE_CREDENTIAL_REF')

  if (mock === true) {
    return {
      targetSettings: { INTAKE_TARGET_PROFILE: 'fake' },
      ignored: overriddenByMock(settings),
    }
  }
  if (local && (external || externalOnly)) {
    throw new DevelopmentSettingsError('conflicting_development_target_settings')
  }
  if (local) {
    return { targetSettings: { INTAKE_TARGET_PROFILE: 'local-inventree' }, ignored: [] }
  }
  if (external) {
    return { targetSettings: externalTarget(settings), ignored: [] }
  }
  if (externalOnly) {
    throw new DevelopmentSettingsError('conflicting_development_target_settings')
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
  if (
    agentsInVm &&
    (!present(settings, 'INTAKE_VM_PAIR') || !present(settings, 'INTAKE_VM_PORT'))
  ) {
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

/**
 * Resolves every `pnpm dev` switch before any setup. `targetSettings` uses the internal names
 * `developmentTarget` and the child processes read.
 */
function resolveDevelopmentSettings(settings) {
  refuseRetiredSettings(settings)
  const { targetSettings, ignored } = resolveInventory(settings)
  const readOnly = resolveReadOnly(settings, targetSettings.INTAKE_TARGET_PROFILE)
  const { profile, mockAgents, agentsInVm } = resolveProcessing(settings)
  return { targetSettings, readOnly, profile, mockAgents, agentsInVm, ignored }
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
  const others = Object.fromEntries(
    Object.entries(settings).filter(([name]) => !TARGET_SETTING_NAMES.includes(name)),
  )
  return { ...others, ...targetSettings }
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
  DevelopmentSettingsError,
}
