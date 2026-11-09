import { startSessionBridge } from './shared-vm/coordinator.ts'
import { join } from 'node:path'
import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk'
import { setTimeout as delay } from 'node:timers/promises'
import { database } from '../db/database.ts'
import { devConfig, processingConfig } from '../config.ts'
import { compatibleSchema } from '../operations/compatibility.ts'
import { readMediaStoreIdentity } from '../media/store-identity.ts'
import { BlobStore } from '../media/blob-store.ts'
import { dispatchProcessingCommands } from '../processing/delivery.ts'
import { requireHandlerVersion } from '../workers/delivery.ts'
import { processingApplication } from '../processing/queue.ts'
import {
  isSessionProfile,
  sessionCommandQueue,
  sessionHandlerVersion,
} from '../processing/session-policy.ts'
import { nativeAgentHost, privateDirectory } from './environment.ts'
import { triggerExamine } from '../processing/examine-trigger.ts'
import { acquireAgentSupervisor } from './worker.ts'
import { startSessionToolServer } from './tools/server.ts'
import {
  interruptRunningSessions,
  runSessionTurn,
  syntheticSessionDriver,
  type SessionRunnerDeps,
} from './session-runner.ts'
import {
  executeSessionCommand,
  SESSION_RESUME_WORKFLOW,
  wakePendingSessions,
} from './session-execution.ts'

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

/** Explicit supervised process for the session profiles. The web process never launches it. */
async function main() {
  const config = processingConfig(devConfig(process.env), process.env)
  if (!config.profileId || !isSessionProfile(config.profileId) || !config.channelSecret) {
    throw new Error('session_agent_configuration_required')
  }
  const host = nativeAgentHost(process.env)
  await privateDirectory(host.stateRoot)
  const db = database(localDatabaseUrl(process.env.INTAKE_AGENT_DATABASE_URL))
  // Without the `agent_writer` connection the lot-forming tools refuse and nothing else changes.
  const writer = process.env.INTAKE_AGENT_WRITER_DATABASE_URL
    ? database(localDatabaseUrl(process.env.INTAKE_AGENT_WRITER_DATABASE_URL))
    : undefined
  let owner: Awaited<ReturnType<typeof acquireAgentSupervisor>> | undefined
  let scheduler: DBOSClient | undefined
  let tools: Awaited<ReturnType<typeof startSessionToolServer>> | undefined
  let bridge: Awaited<ReturnType<typeof startSessionBridge>> | undefined
  let launched = false
  const shutdown = new AbortController()
  const examineSkipped = new Map<string, string>()
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
    // This process now owns the actor, so no other worker can be running these turns.
    await interruptRunningSessions(db.pool, config)
    const store = process.env.INTAKE_BLOB_ROOT
      ? await BlobStore.initialize(
          process.env.INTAKE_BLOB_ROOT,
          await readMediaStoreIdentity(db.pool),
        )
      : undefined
    tools = await startSessionToolServer({
      pool: db.pool,
      writerPool: writer?.pool,
      cropCacheDir: join(host.stateRoot, 'region-crops'),
      config,
      store,
    })
    if (config.profileId === 'shared-vm-agent/1' && !process.env.INTAKE_VM_PAIR) {throw new Error('session_agent_configuration_required')}
    if (process.env.INTAKE_VM_PAIR) {
      if (config.profileId !== 'synthetic-session/1' && config.profileId !== 'shared-vm-agent/1')
        {throw new Error('session_agent_configuration_required')}
      bridge = await startSessionBridge(
        process.env.INTAKE_VM_PAIR,
        Number(process.env.INTAKE_VM_PORT),
      )
    }
    const deps: SessionRunnerDeps = {
      pool: db.pool,
      config,
      host,
      toolUrl: tools.url,
      drivers: {
        'synthetic-session/1':
          config.profileId === 'synthetic-session/1' && bridge
            ? bridge.driver
            : syntheticSessionDriver,
        'shared-vm-agent/1': bridge?.driver,
      },
    }
    DBOS.setConfig({
      name: processingApplication,
      applicationVersion: sessionHandlerVersion,
      systemDatabaseUrl: localDatabaseUrl(process.env.INTAKE_AGENT_SCHEDULER_DATABASE_URL),
      executorID: `sessions-${config.actorId}`,
      systemDatabasePoolSize: 3,
      runAdminServer: false,
      logLevel: 'error',
    })
    DBOS.registerWorkflow(
      async (payload: unknown) => {
        requireHandlerVersion(DBOS.applicationVersion, sessionHandlerVersion)
        if (!DBOS.workflowID || shutdown.signal.aborted) {
          throw new Error('agent_worker_stopping')
        }
        return DBOS.runStep(
          () => executeSessionCommand(deps, DBOS.workflowID!, payload, shutdown.signal),
          { name: 'sessionTurn', retriesAllowed: false },
        )
      },
      { name: 'intakeCommand' },
    )
    DBOS.registerWorkflow(
      async (attemptId: unknown) => {
        requireHandlerVersion(DBOS.applicationVersion, sessionHandlerVersion)
        if (typeof attemptId !== 'string' || shutdown.signal.aborted) {
          throw new Error('agent_worker_stopping')
        }
        return DBOS.runStep(() => runSessionTurn(deps, attemptId, shutdown.signal), {
          name: 'sessionResumeTurn',
          retriesAllowed: false,
        })
      },
      { name: SESSION_RESUME_WORKFLOW },
    )
    await DBOS.launch()
    launched = true
    await DBOS.registerQueue(sessionCommandQueue, { workerConcurrency: 8, globalConcurrency: 8 })
    scheduler = await DBOSClient.create({
      systemDatabaseUrl: localDatabaseUrl(process.env.INTAKE_AGENT_SCHEDULER_DATABASE_URL),
      systemDatabasePoolSize: 1,
    })
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => shutdown.abort())
    }
    process.stdout.write(
      'Bench Intake session supervisor ready. No session starts until a queued command is claimed.\n',
    )
    while (!shutdown.signal.aborted) {
      if (writer) {
        // Lead jobs and evidence notices first, so this pass dispatches and wakes them.
        await triggerExamine(writer.pool, config, { skipped: examineSkipped })
      }
      await dispatchProcessingCommands(db.pool, scheduler, config)
      await wakePendingSessions(db.pool, config, scheduler)
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
    bridge?.close()
    await tools?.close()
    owner?.release(true)
    await writer?.close()
    await db.close()
  }
}

main().catch((error: unknown) => {
  const safeCodes = [
    'agent_supervisor_already_running',
    'agent_reap_confirmation_required',
    'session_agent_configuration_required',
    'private_agent_state_required',
    'agent_database_required',
    'local_agent_database_required',
    'database_version_quarantined',
    'agent_supervisor_lock_lost',
  ]
  let code =
    error instanceof Error && safeCodes.includes(error.message)
      ? error.message
      : 'session_agent_startup_refused'
  if (error && typeof error === 'object' && 'code' in error && error.code === '42501') {
    code = 'agent_database_permission_denied'
  }
  process.stderr.write(JSON.stringify({ event: 'session_agent_stopped', code }) + '\n')
  process.exitCode = 1
})
