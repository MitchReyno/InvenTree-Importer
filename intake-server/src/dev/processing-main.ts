import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk'
import { setTimeout as delay } from 'node:timers/promises'
import { database } from '#/db/database.ts'
import { executeProcessingCommand, dispatchProcessingCommands } from '#/processing/delivery.ts'
import { processingApplication } from '#/processing/queue.ts'
import { readDevState, schedulerUrl } from './state.ts'
import { syntheticDevelopmentRunner } from './synthetic-runner.ts'

async function main() {
  const state = await readDevState(process.env.INTAKE_APP_STATE!)
  const config = {
    actorId: state.identity.actor,
    targetId: state.identity.target,
    targetContextId: state.identity.context,
    profileId: 'synthetic-research/2' as const,
    channelSecret: state.channelSecret,
  }
  const db = database(state.processingUrl)
  const stop = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => stop.abort())
  }
  let scheduler: DBOSClient | undefined
  try {
    DBOS.setConfig({
      name: processingApplication,
      systemDatabaseUrl: schedulerUrl(state),
      applicationVersion: 'processing/2',
      executorID: `dev-${state.identity.actor}`,
      runAdminServer: false,
      systemDatabasePoolSize: 3,
      logLevel: 'error',
    })
    DBOS.registerWorkflow(
      async (payload: unknown) => {
        if (!DBOS.workflowID || stop.signal.aborted) {
          throw new Error('development_worker_stopping')
        }
        return DBOS.runStep(
          () =>
            executeProcessingCommand(
              db.pool,
              config,
              DBOS.workflowID!,
              payload,
              syntheticDevelopmentRunner,
            ),
          { name: 'syntheticDevelopment', retriesAllowed: false },
        )
      },
      { name: 'intakeCommand' },
    )
    await DBOS.launch()
    await DBOS.registerQueue('bench-research', { workerConcurrency: 1, globalConcurrency: 1 })
    scheduler = await DBOSClient.create({
      systemDatabaseUrl: schedulerUrl(state),
      systemDatabasePoolSize: 1,
    })
    process.stdout.write('DEV_PROCESSING_READY\n')
    while (!stop.signal.aborted) {
      await dispatchProcessingCommands(db.pool, scheduler, config)
      await delay(500, undefined, { signal: stop.signal }).catch(() => undefined)
    }
  } finally {
    await scheduler?.destroy()
    await DBOS.shutdown({ workflowCompletionTimeoutMS: 30000 })
    await db.close()
  }
}

main().catch(() => {
  process.stderr.write('Synthetic development processing stopped.\n')
  process.exitCode = 1
})
