import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk'
import { setTimeout as delay } from 'node:timers/promises'
import { database } from '../db/database.ts'
import { devConfig, processingConfig } from '../config.ts'
import { compatibleSchema } from '../operations/compatibility.ts'
import { readMediaStoreIdentity } from '../media/store-identity.ts'
import { BlobStore } from '../media/blob-store.ts'
import { dispatchProcessingCommands, executeProcessingCommand } from '../processing/delivery.ts'
import { requireHandlerVersion } from '../workers/delivery.ts'
import { processingApplication } from '../processing/queue.ts'
import { nativeAgentHost, privateDirectory } from './environment.ts'
import { nativeProfileId, nativeHandlerVersion } from './policy.ts'
import { nativeAgentRunner } from './runner.ts'
import { acquireAgentSupervisor } from './worker.ts'

function localDatabaseUrl(value: string | undefined) {
  if (!value) {
    throw new Error('agent_database_required')
  }
  const url = new URL(value)
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  ) {
    throw new Error('local_agent_database_required')
  }
  return value
}

/** Explicit supervised process. The web process never imports or launches this entrypoint. */
async function main() {
  const config = processingConfig(devConfig(process.env), process.env)
  if (config.profileId !== nativeProfileId || !config.channelSecret) {
    throw new Error('native_agent_configuration_required')
  }
  const host = nativeAgentHost(process.env)
  await privateDirectory(host.stateRoot)
  const db = database(localDatabaseUrl(process.env.INTAKE_AGENT_DATABASE_URL))
  let owner: Awaited<ReturnType<typeof acquireAgentSupervisor>> | undefined
  let scheduler: DBOSClient | undefined
  let launched = false
  const shutdown = new AbortController()
  let ownerLost = false
  try {
    if (!(await compatibleSchema(db.pool))) {
      throw new Error('database_version_quarantined')
    }
    owner = await acquireAgentSupervisor(db.pool, config)
    owner.on('error', () => {
      ownerLost = true
      shutdown.abort()
    })
    const store = process.env.INTAKE_BLOB_ROOT
      ? await BlobStore.initialize(
          process.env.INTAKE_BLOB_ROOT,
          await readMediaStoreIdentity(db.pool),
        )
      : undefined
    const runner = nativeAgentRunner(db.pool, config, host, store, shutdown.signal)
    DBOS.setConfig({
      name: processingApplication,
      applicationVersion: nativeHandlerVersion,
      systemDatabaseUrl: localDatabaseUrl(process.env.INTAKE_AGENT_SCHEDULER_DATABASE_URL),
      executorID: `native-${config.actorId}`,
      systemDatabasePoolSize: 3,
      runAdminServer: false,
      logLevel: 'error',
    })
    DBOS.registerWorkflow(
      async (payload: unknown) => {
        requireHandlerVersion(DBOS.applicationVersion, nativeHandlerVersion)
        if (!DBOS.workflowID || shutdown.signal.aborted) {
          throw new Error('agent_worker_stopping')
        }
        return DBOS.runStep(
          () => executeProcessingCommand(db.pool, config, DBOS.workflowID!, payload, runner),
          { name: 'originalNativeAgent', retriesAllowed: false },
        )
      },
      { name: 'intakeCommand' },
    )
    await DBOS.launch()
    launched = true
    await DBOS.registerQueue('bench-research', { workerConcurrency: 1, globalConcurrency: 1 })
    scheduler = await DBOSClient.create({
      systemDatabaseUrl: localDatabaseUrl(process.env.INTAKE_AGENT_SCHEDULER_DATABASE_URL),
      systemDatabasePoolSize: 1,
    })
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => shutdown.abort())
    }
    process.stdout.write(
      'Bench Intake native agent supervisor ready. No inference starts until a queued command is claimed.\n',
    )
    while (!shutdown.signal.aborted) {
      await dispatchProcessingCommands(db.pool, scheduler, config)
      await delay(500, undefined, { signal: shutdown.signal }).catch(() => undefined)
    }
    if (ownerLost) {
      throw new Error('agent_supervisor_lock_lost')
    }
  } finally {
    shutdown.abort()
    await scheduler?.destroy()
    if (launched) {
      await DBOS.shutdown({ workflowCompletionTimeoutMS: 10000 })
    }
    owner?.release(true)
    await db.close()
  }
}

main().catch((error: unknown) => {
  const safeCodes = [
    'agent_supervisor_already_running',
    'agent_reap_confirmation_required',
    'native_agent_configuration_required',
    'private_agent_state_required',
    'agent_database_required',
    'local_agent_database_required',
    'database_version_quarantined',
    'agent_supervisor_lock_lost',
  ]
  let code =
    error instanceof Error && safeCodes.includes(error.message)
      ? error.message
      : 'native_agent_startup_refused'
  if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
    code = 'agent_database_permission_denied'
  }
  process.stderr.write(JSON.stringify({ event: 'native_agent_stopped', code }) + '\n')
  process.stderr.write(
    'Native agent supervisor stopped. Inspect retained sessions and confirm child termination before recovering an occupied lane.\n',
  )
  process.exitCode = 1
})
