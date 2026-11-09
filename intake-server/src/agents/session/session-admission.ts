import { NativeSessionError } from '#/agents/failure-model.ts'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentSelectionDto } from '@invimport/contracts'

// Changing the qualified surface invalidates existing conversation provenance.
const ADMISSION_POLICY = 'native-session-direct-tools/1'

function policyRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NativeSessionError('agent_policy_refused')
  }
  return value as Record<string, unknown>
}

export function requireCodexSessionVersion(value: unknown) {
  if (typeof value !== 'string' || !/^bench_intake\/0\.166\.0(?:\s|$)/u.test(value)) {
    throw new NativeSessionError('agent_version_unqualified')
  }
}

export function requireCodexSessionConfig(value: unknown, guestTools = false) {
  const config = policyRecord(value)
  const features = policyRecord(config.features)
  const skills = policyRecord(config.skills)
  const disabledFeatures = [
    'goals',
    'apps',
    'plugins',
    'remote_plugin',
    'memories',
    'multi_agent',
    'request_permissions_tool',
  ]
  if (
    config.approval_policy !== 'never' ||
    config.sandbox_mode !== (guestTools ? 'danger-full-access' : 'read-only') ||
    features.shell_tool !== guestTools ||
    features.view_image !== guestTools ||
    config.web_search !== 'disabled' ||
    policyRecord(features.code_mode).enabled !== false ||
    disabledFeatures.some((key) => features[key] !== false) ||
    policyRecord(skills.bundled).enabled !== false ||
    skills.include_instructions !== false
  ) {
    throw new NativeSessionError('agent_policy_refused')
  }
}

function admissionIdentity(selection: AgentSelectionDto, conversation: string) {
  return createHash('sha256')
    .update(
      JSON.stringify([
        ADMISSION_POLICY,
        selection.provider,
        selection.authentication,
        conversation,
      ]),
    )
    .digest('hex')
}

/** The caller owns a private session directory; markers never contain credentials or input. */
export async function hasAdmission(
  cwd: string,
  selection: AgentSelectionDto,
  conversation: string,
) {
  const identity = admissionIdentity(selection, conversation)
  let file
  try {
    file = await open(join(cwd, `admission-${identity}`), constants.O_RDONLY | constants.O_NOFOLLOW)
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw new NativeSessionError('agent_admission_unavailable')
  }
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size !== identity.length || (info.mode & 0o077) !== 0) {
      return false
    }
    return (await file.readFile('utf8')) === identity
  } finally {
    await file.close()
  }
}

export async function rememberAdmission(
  cwd: string,
  selection: AgentSelectionDto,
  conversation: string,
) {
  if (await hasAdmission(cwd, selection, conversation)) {
    return
  }
  const identity = admissionIdentity(selection, conversation)
  const file = await open(join(cwd, `admission-${identity}`), 'wx', 0o600)
  try {
    await file.writeFile(identity)
    await file.sync()
  } finally {
    await file.close()
  }
}

export async function requireClaudeSessionVersion(
  executable: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
  onVersion?: (version: string) => void,
) {
  let version: string
  try {
    const result = await promisify(execFile)(executable, ['--version'], {
      cwd,
      env: { PATH: env.PATH, HOME: env.HOME },
      signal,
      timeout: 5000,
      maxBuffer: 4096,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
    })
    version = result.stdout.trim()
  } catch {
    throw new NativeSessionError('agent_version_unavailable')
  }
  const number = /^(\d+\.\d+\.\d+) \(Claude Code\)$/.exec(version)?.[1]
  if (number) {
    onVersion?.(number)
  }
  if (version !== '2.1.319 (Claude Code)') {
    throw new NativeSessionError('agent_version_unqualified')
  }
}

/** Startup metadata is checked as well as flags; unknown customizations fail closed. */
export function requireClaudeSessionConfig(value: unknown) {
  const config = policyRecord(value)
  const emptyLists = ['slash_commands', 'skills', 'additional_directories']
  const builtinPlugins = ['cc-plugin-agents-md', 'cc-plugin-privacy', 'cc-plugin-plugin-authoring']
  // Subscription sessions also load the built-in telemetry plugin.
  const admittedPluginSets = [builtinPlugins, [...builtinPlugins, 'cc-plugin-telemetry']].map(
    (set) => JSON.stringify([...set].sort()),
  )
  if (
    config.claude_code_version !== '2.1.319' ||
    config.permissionMode !== 'default' ||
    config.output_style !== 'default' ||
    emptyLists.some((key) => !Array.isArray(config[key]) || config[key].length !== 0) ||
    !Array.isArray(config.plugins)
  ) {
    throw new NativeSessionError('agent_policy_refused')
  }
  const names = config.plugins.map((value) => {
    const plugin = policyRecord(value)
    if (
      typeof plugin.name !== 'string' ||
      plugin.path !== 'builtin' ||
      plugin.source !== `${plugin.name}@builtin`
    ) {
      throw new NativeSessionError('agent_policy_refused')
    }
    return plugin.name
  })
  if (!admittedPluginSets.includes(JSON.stringify(names.sort()))) {
    throw new NativeSessionError('agent_policy_refused')
  }
}
