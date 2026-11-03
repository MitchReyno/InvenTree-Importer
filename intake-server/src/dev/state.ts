import { lstat, readFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { canonical } from '@invimport/contracts/json'
import { Id } from '@invimport/contracts'
import { MEDIA_CAPABILITY } from '../execution/media-plan.ts'
import { EFFECTS_CAPABILITY } from '../execution/effects-plan.ts'
import type { ManualRunnerConfig } from '../review/runner.ts'

export interface DevState {
  version: 1
  databaseName: string
  identity: { actor: string; target: string; context: string }
  apiUrl: string
  processingUrl: string
  mediaUrl: string
  fakeUrl: string
  runnerConfig: ManualRunnerConfig
  runnerConfigPath: string
  blobRoot: string
  channelSecret: string
}

export async function readDevState(root: string): Promise<DevState> {
  if ((await realpath(root)) !== root) {
    throw new Error('private_dev_state_required')
  }
  const path = join(root, 'app.json')
  const stat = await lstat(path)
  if (
    stat.size > 32768 ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077
  ) {
    throw new Error('private_dev_state_required')
  }
  const value: unknown = JSON.parse(await readFile(path, 'utf8'))
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('databaseName' in value) ||
    typeof value.databaseName !== 'string' ||
    !/^intake_dev_[a-f0-9]{32}$/.test(value.databaseName)
  ) {
    throw new Error('invalid_dev_state')
  }
  const raw = value as Record<string, unknown>
  for (const key of [
    'apiUrl',
    'processingUrl',
    'mediaUrl',
    'fakeUrl',
    'runnerConfigPath',
    'blobRoot',
    'channelSecret',
  ]) {
    if (typeof raw[key] !== 'string' || (raw[key] as string).length > 4096) {
      throw new Error('invalid_dev_state')
    }
  }
  const identity = raw.identity
  if (!identity || typeof identity !== 'object') {
    throw new Error('invalid_dev_identity')
  }
  const identityFields = identity as Record<string, unknown>
  for (const key of ['actor', 'target', 'context']) {
    if (
      typeof identityFields[key] !== 'string' ||
      !new RegExp(Id.pattern!).test(identityFields[key] as string)
    ) {
      throw new Error('invalid_dev_identity')
    }
  }
  const runner = raw.runnerConfig
  if (!runner || typeof runner !== 'object') {
    throw new Error('invalid_dev_runner')
  }
  const config = runner as Record<string, unknown>
  for (const key of [
    'runnerDatabaseUrl',
    'schedulerDatabaseUrl',
    'applyDatabaseUrl',
    'gateRoot',
    'deploymentId',
    'mediaBlobRoot',
  ]) {
    if (typeof config[key] !== 'string') {
      throw new Error('invalid_dev_runner')
    }
  }
  if (typeof raw.channelSecret !== 'string' || !/^[a-f0-9]{64}$/.test(raw.channelSecret)) {
    throw new Error('invalid_dev_channel')
  }
  const profile = config.profile
  if (!profile || typeof profile !== 'object') {
    throw new Error('invalid_dev_profile')
  }
  const fields = profile as Record<string, unknown>
  if (
    fields.kind !== 'owned-disposable' ||
    fields.targetId !== identityFields.target ||
    fields.contextId !== identityFields.context ||
    fields.credential !== 'owned-fake-token' ||
    fields.attachmentCapability !== MEDIA_CAPABILITY ||
    fields.effectsCapability !== EFFECTS_CAPABILITY
  ) {
    throw new Error('invalid_dev_profile')
  }
  if (
    typeof fields.origin !== 'string' ||
    !Array.isArray(fields.protectedOrigins) ||
    fields.protectedOrigins.some((origin) => typeof origin !== 'string')
  ) {
    throw new Error('invalid_dev_profile')
  }
  if (
    raw.runnerConfigPath !== join(root, 'retained/runner.json') ||
    raw.blobRoot !== join(root, 'retained/blobs') ||
    config.mediaBlobRoot !== raw.blobRoot ||
    config.gateRoot !== join(root, 'retained/gate') ||
    !new RegExp(Id.pattern!).test(config.deploymentId as string)
  ) {
    throw new Error('invalid_dev_paths')
  }
  const runnerStat = await lstat(raw.runnerConfigPath as string)
  if (
    !runnerStat.isFile() ||
    runnerStat.isSymbolicLink() ||
    runnerStat.uid !== process.getuid?.() ||
    runnerStat.mode & 0o077 ||
    runnerStat.size > 32768
  ) {
    throw new Error('private_dev_runner_required')
  }
  const retainedRunner = JSON.parse(await readFile(raw.runnerConfigPath as string, 'utf8'))
  if (canonical(retainedRunner) !== canonical(config)) {
    throw new Error('dev_runner_binding_changed')
  }
  const state = value as DevState
  for (const address of [
    state.apiUrl,
    state.processingUrl,
    state.mediaUrl,
    state.fakeUrl,
    state.runnerConfig.runnerDatabaseUrl,
    state.runnerConfig.applyDatabaseUrl,
    state.runnerConfig.schedulerDatabaseUrl,
  ]) {
    const url = new URL(address)
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.hostname !== '127.0.0.1' ||
      url.pathname !== `/${state.databaseName}` ||
      !/^intake_[a-z0-9_]+$/.test(url.username)
    ) {
      throw new Error('owned_dev_database_required')
    }
  }
  if (state.runnerConfig.profile.kind !== 'owned-disposable') {
    throw new Error('owned_dev_fake_required')
  }
  const origin = new URL(state.runnerConfig.profile.origin)
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    origin.origin !== state.runnerConfig.profile.origin
  ) {
    throw new Error('owned_dev_fake_required')
  }
  return state
}
