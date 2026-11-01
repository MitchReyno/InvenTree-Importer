import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk'
import { lstat, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { strictJson } from '@invimport/contracts/json'
import { database } from '../db/database.ts'
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
  const value = strictJson(await readFile(file, 'utf8')) as ManualRunnerConfig
  const keys = [
    'runnerDatabaseUrl',
    'schedulerDatabaseUrl',
    'applyDatabaseUrl',
    'gateRoot',
    'deploymentId',
    'profile',
  ]
  if (!value || Object.keys(value).sort().join(',') !== keys.sort().join(',')) {
    throw new Error('invalid_manual_runner_configuration')
  }
  for (const name of ['runnerDatabaseUrl', 'schedulerDatabaseUrl', 'applyDatabaseUrl'] as const) {
    const url = new URL(value[name])
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    ) {
      throw new Error('local_manual_runner_database_required')
    }
  }
  id(value.deploymentId)
  id(value.profile.targetId)
  id(value.profile.contextId)
  const origin = new URL(value.profile.origin)
  if (
    value.profile.kind !== 'owned-disposable' ||
    origin.origin !== value.profile.origin ||
    origin.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(origin.hostname) ||
    !value.profile.credential?.trim() ||
    !value.profile.protectedOrigins?.length
  ) {
    throw new Error('owned_fake_manual_runner_required')
  }
  return value
}
async function main() {
  const config = await readConfig()
  const db = database(config.runnerDatabaseUrl)
  DBOS.setConfig({
    name: 'bench-intake-apply',
    systemDatabaseUrl: config.schedulerDatabaseUrl,
    applicationVersion: EXECUTOR_BUILD,
    executorID: `manual-${config.deploymentId}`,
    runAdminServer: false,
    systemDatabasePoolSize: 3,
    logLevel: 'ERROR',
  })
  DBOS.registerWorkflow(
    async (payload: unknown) => {
      requireHandlerVersion(DBOS.applicationVersion, EXECUTOR_BUILD)
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
