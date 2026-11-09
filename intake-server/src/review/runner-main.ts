import {
  EFFECTS_BUILD,
  EFFECTS_CAPABILITY,
  RECORD_EFFECTS_BUILD,
  RECORD_EFFECTS_CAPABILITY,
} from '../execution/effects/effects-plan.ts'
import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk'
import { lstat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { strictJson } from '@invimport/contracts/json'
import { database } from '../db/database.ts'
import { MEDIA_EXECUTOR_BUILD, MEDIA_CAPABILITY } from '../execution/media-plan.ts'
import { EXECUTOR_BUILD, id } from '../execution/plan.ts'
import { requireHandlerVersion } from '../workers/delivery.ts'
import { dispatchManualCommands, executeManualDispatch, type ManualRunnerConfig } from './runner.ts'

/** Explicit process entry point. The web process never imports this module.
 * Only a separately provisioned private config contains the owned fake apply capability.
 */
async function readConfig(): Promise<ManualRunnerConfig> {
  const path = process.env.INTAKE_RUNNER_CONFIG
  if (!path) {
    throw new Error('manual_runner_configuration_required')
  }
  const file = resolve(path)
  const stat = await lstat(file)
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.uid !== process.getuid?.() ||
    stat.mode & 0o077 ||
    stat.size > 16384
  ) {
    throw new Error('private_manual_runner_configuration_required')
  }
  const parsed = strictJson(await readFile(file, 'utf8'))
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('invalid_manual_runner_configuration')
  }
  const value = parsed as Record<string, unknown>
  const keys = [
    'runnerDatabaseUrl',
    'schedulerDatabaseUrl',
    'applyDatabaseUrl',
    'gateRoot',
    'deploymentId',
    'profile',
  ]
  const actualKeys = Object.keys(value).filter((key) => key !== 'mediaBlobRoot')
  if (actualKeys.sort().join(',') !== keys.sort().join(',')) {
    throw new Error('invalid_manual_runner_configuration')
  }
  for (const name of ['runnerDatabaseUrl', 'schedulerDatabaseUrl', 'applyDatabaseUrl'] as const) {
    if (typeof value[name] !== 'string') {
      throw new Error('invalid_manual_runner_configuration')
    }
    const url = new URL(value[name])
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    ) {
      throw new Error('local_manual_runner_database_required')
    }
  }
  id(value.deploymentId)
  const rawProfile = value.profile
  if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) {
    throw new Error('owned_fake_manual_runner_required')
  }
  const profile = rawProfile as Record<string, unknown>
  id(profile.targetId)
  id(profile.contextId)
  const protectedOrigins = profile.protectedOrigins
  if (
    typeof profile.origin !== 'string' ||
    typeof profile.credential !== 'string' ||
    !profile.credential.trim() ||
    !Array.isArray(protectedOrigins) ||
    !protectedOrigins.length ||
    !protectedOrigins.every((entry): entry is string => typeof entry === 'string')
  ) {
    throw new Error('owned_fake_manual_runner_required')
  }
  const origin = new URL(profile.origin)
  if (
    profile.kind !== 'owned-disposable' ||
    origin.origin !== profile.origin ||
    origin.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(origin.hostname)
  ) {
    throw new Error('owned_fake_manual_runner_required')
  }
  const effects =
    profile.effectsCapability === EFFECTS_CAPABILITY ||
    profile.effectsCapability === RECORD_EFFECTS_CAPABILITY
      ? (profile.effectsCapability as typeof EFFECTS_CAPABILITY | typeof RECORD_EFFECTS_CAPABILITY)
      : null
  if (profile.effectsCapability !== undefined && !effects) {
    throw new Error('unsupported_effects_capability')
  }
  const media = profile.attachmentCapability === MEDIA_CAPABILITY
  if (profile.attachmentCapability !== undefined && !media) {
    throw new Error('unsupported_attachment_capability')
  }
  if (media && (typeof value.mediaBlobRoot !== 'string' || !value.mediaBlobRoot.trim())) {
    throw new Error('media_storage_configuration_required')
  }
  if (!media && value.mediaBlobRoot !== undefined) {
    throw new Error('media_capability_required')
  }
  if (typeof value.gateRoot !== 'string' || !value.gateRoot.trim()) {
    throw new Error('private_gate_configuration_required')
  }
  // Each field is validated before crossing into the separately credentialed apply process.
  return {
    runnerDatabaseUrl: String(value.runnerDatabaseUrl),
    schedulerDatabaseUrl: String(value.schedulerDatabaseUrl),
    applyDatabaseUrl: String(value.applyDatabaseUrl),
    deploymentId: String(value.deploymentId),
    gateRoot: value.gateRoot,
    ...(media ? { mediaBlobRoot: String(value.mediaBlobRoot) } : {}),
    profile: {
      kind: 'owned-disposable',
      targetId: String(profile.targetId),
      contextId: String(profile.contextId),
      origin: profile.origin,
      credential: profile.credential,
      protectedOrigins,
      ...(media ? { attachmentCapability: MEDIA_CAPABILITY } : {}),
      ...(effects ? { effectsCapability: effects } : {}),
    },
  }
}

async function main() {
  const config = await readConfig()
  const db = database(config.runnerDatabaseUrl)
  const build =
    config.profile.effectsCapability === RECORD_EFFECTS_CAPABILITY
      ? RECORD_EFFECTS_BUILD
      : config.profile.effectsCapability === EFFECTS_CAPABILITY
        ? EFFECTS_BUILD
        : config.profile.attachmentCapability === MEDIA_CAPABILITY
          ? MEDIA_EXECUTOR_BUILD
          : EXECUTOR_BUILD
  DBOS.setConfig({
    name: 'bench-intake-apply',
    systemDatabaseUrl: config.schedulerDatabaseUrl,
    applicationVersion: build,
    executorID: `manual-${config.deploymentId}`,
    runAdminServer: false,
    systemDatabasePoolSize: 3,
    logLevel: 'ERROR',
  })
  DBOS.registerWorkflow(
    async (payload: unknown) => {
      requireHandlerVersion(DBOS.applicationVersion, build)
      const workflowId = DBOS.workflowID
      if (!workflowId) {
        throw new Error('manual_workflow_context_required')
      }
      return DBOS.runStep(() => executeManualDispatch(db.pool, config, workflowId, payload), {
        name: 'originalSupervisedApply',
        retriesAllowed: false,
      })
    },
    { name: 'intakeCommand' },
  )
  await DBOS.launch()
  await DBOS.registerQueue('bench-apply', { workerConcurrency: 1 })
  const scheduler = await DBOSClient.create({
    systemDatabaseUrl: config.schedulerDatabaseUrl,
    systemDatabasePoolSize: 2,
  })
  let stopping = false
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      stopping = true
    })
  }
  process.stdout.write('Bench Intake owned-fake manual runner ready.\n')
  try {
    while (!stopping) {
      await dispatchManualCommands(db.pool, scheduler, config)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  } finally {
    await scheduler.destroy()
    await DBOS.shutdown({ workflowCompletionTimeoutMS: 30000 })
    await db.close()
  }
}

main().catch(() => {
  process.stderr.write(
    'Manual runner stopped; inspect retained original-run authority before recovery.\n',
  )
  process.exitCode = 1
})
