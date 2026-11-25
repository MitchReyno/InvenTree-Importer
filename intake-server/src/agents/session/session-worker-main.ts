import { startSessionBridge } from '#/agents/shared-vm/coordinator.ts'
import { bridgeProtectedHosts } from '#/agents/shared-vm/protected-hosts.ts'
import { join } from 'node:path'
import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk'
import type { PoolClient } from 'pg'
import { setTimeout as delay } from 'node:timers/promises'
import { database } from '#/db/database.ts'
import { devConfig, processingConfig } from '#/config.ts'
import { compatibleSchema } from '#/operations/compatibility.ts'
import { readMediaStoreIdentity } from '#/media/store-identity.ts'
import { BlobStore } from '#/media/blob-store.ts'
import { dispatchProcessingCommands } from '#/processing/delivery.ts'
import { requireHandlerVersion } from '#/workers/delivery.ts'
import { processingApplication } from '#/processing/queue.ts'
import {
  isSessionProfile,
  sessionCommandQueue,
  sessionHandlerVersion,
} from '#/processing/session-policy.ts'
import { nativeAgentHost, privateDirectory } from '#/agents/environment.ts'
import { triggerExamine } from '#/processing/examine-trigger.ts'
import { lockAgentSupervisor } from '#/agents/worker.ts'
import {
  heldCapacityChecked,
  requireFreeCapacity,
  type HeldCapacityChecks,
} from '#/agents/held-capacity.ts'
import { evidenceImageMode } from '#/agents/tools/handlers.ts'
import { startSessionToolServer } from '#/agents/tools/server.ts'
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
import { deliverMissingInstructions } from '#/agents/instructions.ts'
import { localDatabaseUrl, schedulerDatabaseUrl, schedulerReachable } from './database-urls.ts'
import { serveProviderStatusRequests } from '#/agents/provider-status-channel.ts'
import type { BridgeProviderStatuses } from '#/agents/shared-vm/coordinator.ts'

/**
 * How long a stopping worker waits for its turns to settle, so a confirmed reap releases its slot.
 * Inside the development launcher's 45 s stop grace, with room for the scheduler's own shutdown.
 */
const SHUTDOWN_TURN_SETTLE_MS = 30_000

/** The turns this worker is running, so shutdown can wait for them to settle. */
function turnTracker() {
  const turns = new Set<Promise<unknown>>()
  return {
    track<T>(turn: Promise<T>) {
      turns.add(turn)

      const forget = () => {
        turns.delete(turn)
      }

      turn.then(forget, forget)
      return turn
    },

    /** Waits for every running turn to settle, for at most `boundMs`. */
    async settle(boundMs: number) {
      const bound = new AbortController()
      const settledTurns = Promise.allSettled([...turns])
      const expiry = delay(boundMs, undefined, { signal: bound.signal }).catch(() => undefined)
      await Promise.race([settledTurns, expiry])
      bound.abort()
    },
  }
}

/** A worker without the VM bridge has no provider status to read. */
async function statusNotConfigured(): Promise<BridgeProviderStatuses> {
  return {
    claude: { state: 'unknown', reason: 'not_configured' },
    codex: { state: 'unknown', reason: 'not_configured' },
  }
}

/**
 * The paired VM bridge this worker starts, or undefined without one. Checked before any
 * effect, so a misconfigured worker refuses before it recovers or touches retained sessions.
 */
function vmBridgeConfiguration(env: NodeJS.ProcessEnv, profileId: string) {
  const vmProfile = profileId === 'shared-vm-agent/1' || profileId === 'shared-vm-agent/3'
  if (!env.INTAKE_VM_PAIR) {
    if (vmProfile) {
      throw new Error('session_agent_configuration_required')
    }
    return undefined
  }
  if (!vmProfile && profileId !== 'synthetic-session/1') {
    throw new Error('session_agent_configuration_required')
  }
  const port = Number(env.INTAKE_VM_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('session_agent_configuration_required')
  }
  return {
    pair: env.INTAKE_VM_PAIR,
    port,
    protectedHosts: bridgeProtectedHosts(env, profileId),
  }
}

/** Explicit supervised process for the session profiles. The web process never launches it. */
async function main() {
  const config = processingConfig(devConfig(process.env), process.env)
  if (!config.profileId || !isSessionProfile(config.profileId) || !config.channelSecret) {
    throw new Error('session_agent_configuration_required')
  }
  const vmBridge = vmBridgeConfiguration(process.env, config.profileId)
  const schedulerUrl = schedulerDatabaseUrl(process.env.INTAKE_AGENT_SCHEDULER_DATABASE_URL)
  const host = nativeAgentHost(process.env)
  await privateDirectory(host.stateRoot)
  const db = database(localDatabaseUrl(process.env.INTAKE_AGENT_DATABASE_URL))
  // Without the `agent_writer` connection the lot-forming tools refuse and nothing else changes.
  const writer = process.env.INTAKE_AGENT_WRITER_DATABASE_URL
    ? database(localDatabaseUrl(process.env.INTAKE_AGENT_WRITER_DATABASE_URL))
    : undefined
  let owner: PoolClient | undefined
  let scheduler: DBOSClient | undefined
  const evidenceImage = evidenceImageMode(process.env.INTAKE_VM_EVIDENCE_IMAGE)
  let tools: Awaited<ReturnType<typeof startSessionToolServer>> | undefined
  let bridge: Awaited<ReturnType<typeof startSessionBridge>> | undefined
  let statusRequests: ReturnType<typeof serveProviderStatusRequests> | undefined
  let launched = false
  const shutdown = new AbortController()
  const examineSkipped = new Map<string, string>()
  const turns = turnTracker()
  let ownerLost = false
  try {
    if (!(await compatibleSchema(db.pool))) {
      throw new Error('database_version_quarantined')
    }
    owner = await lockAgentSupervisor(db.pool, config)
    owner.on('error', () => {
      ownerLost = true
      shutdown.abort()
    })
    // Pairing files and the listener are checked before recovery changes any retained session.
    if (vmBridge) {
      bridge = await startSessionBridge(vmBridge.pair, vmBridge.port, {
        protectedHosts: vmBridge.protectedHosts,
        confirmEvidence: (job, version, delivered) => {
          if (!tools) {
            throw new Error('session_tools_unavailable')
          }
          tools.confirmEvidence(job, version, delivered)
        },
      })
    }
    // Held slots are checked through the bridge, so it starts first; nothing has run yet.
    const capacityChecks: HeldCapacityChecks = { confirmVmReaped: bridge?.confirmReaped }
    const recovered = await requireFreeCapacity(db.pool, config, capacityChecks)
    // Recover-only mode (`pnpm agents:reap`) stops here; the next start interrupts the sessions.
    if (process.env.INTAKE_AGENT_RECOVER_ONLY === '1') {
      process.stdout.write(heldCapacityChecked(recovered.length))
      return
    }
    // From the worker's own pool: its role's connection limit leaves no room for another.
    statusRequests = serveProviderStatusRequests(
      db.pool,
      config,
      bridge?.providerStatus ?? statusNotConfigured,
    )
    // The scheduler takes over recovered work, so it must accept a connection first.
    await schedulerReachable(schedulerUrl)
    // This process now owns the actor, so no other worker can be running these turns.
    await interruptRunningSessions(db.pool, config)
    const store = process.env.INTAKE_BLOB_ROOT
      ? await BlobStore.initialize(
          process.env.INTAKE_BLOB_ROOT,
          await readMediaStoreIdentity(db.pool),
        )
      : undefined
    tools = await startSessionToolServer({
      evidenceImage,
      pool: db.pool,
      writerPool: writer?.pool,
      cropCacheDir: join(host.stateRoot, 'region-crops'),
      config,
      store,
    })
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
        'shared-vm-agent/3': bridge?.driver,
      },
    }
    DBOS.setConfig({
      name: processingApplication,
      applicationVersion: sessionHandlerVersion,
      systemDatabaseUrl: schedulerUrl,
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
          () =>
            turns.track(executeSessionCommand(deps, DBOS.workflowID!, payload, shutdown.signal)),
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
        return DBOS.runStep(() => turns.track(runSessionTurn(deps, attemptId, shutdown.signal)), {
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
      systemDatabaseUrl: schedulerUrl,
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
      // A failed relay pass is retried next pass; it must not stop dispatch or wake-ups.
      await deliverMissingInstructions(db.pool, config).catch(() => {
        process.stderr.write(`${JSON.stringify({ event: 'instruction_relay_retrying' })}\n`)
      })
      await wakePendingSessions(db.pool, config, scheduler)
      await delay(500, undefined, { signal: shutdown.signal }).catch(() => undefined)
    }
    if (ownerLost) {
      throw new Error('agent_supervisor_lock_lost')
    }
  } finally {
    shutdown.abort()
    // Stopped turns settle before anything they need closes: a VM turn's reap proof needs the
    // bridge, and its settlement the scheduler and the pool. Past the bound, a slot stays held.
    await turns.settle(SHUTDOWN_TURN_SETTLE_MS)
    // First, so a stopping worker holds no connection it isn't using.
    await statusRequests?.close()
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
