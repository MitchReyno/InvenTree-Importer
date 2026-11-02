import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk'
import { readFile } from 'node:fs/promises'
import { database } from '../../src/db/database.ts'
import { BlobStore } from '../../src/media/blob-store.ts'
import type { ProcessingConfig } from '../../src/processing/attempts.ts'
import {
  dispatchProcessingCommands,
  executeProcessingCommand,
} from '../../src/processing/delivery.ts'
import { createResearchBrokerFactory } from '../../src/research/factory.ts'
import { restrictedResearchRunner } from '../../src/research/adapter.ts'
import { controlledResearchSession } from '../../src/research/child-transport.ts'

const configPath = process.env.INTAKE_RESEARCH_PROCESSING_CONFIG
if (!configPath) {
  throw new Error('controlled_research_configuration_required')
}
const config: ProcessingConfig & {
  runnerDatabaseUrl: string
  schedulerDatabaseUrl: string
  mediaRoot: string
  mediaStoreId: string
} = JSON.parse(await readFile(configPath, 'utf8'))
for (const connection of [config.runnerDatabaseUrl, config.schedulerDatabaseUrl]) {
  const url = new URL(connection)
  if (url.hostname !== '127.0.0.1' || !/^intake_test_[a-f0-9]+$/.test(url.pathname.slice(1))) {
    throw new Error('owned_research_database_required')
  }
}
const db = database(config.runnerDatabaseUrl)
const store = await BlobStore.initialize(config.mediaRoot, config.mediaStoreId)
const cancellation = new AbortController()
const runner = restrictedResearchRunner({
  signal: cancellation.signal,
  createBroker: createResearchBrokerFactory({
    pool: db.pool,
    config,
    mediaStore: store,
    readInventory: async () =>
      Response.json({ pk: 7, name: 'Controlled fixture Part', private: 'never-public' }),
  }),
  async createSession(input, signal) {
    process.stdout.write(`RESEARCH_SESSION_STARTED:${input.payload.attempt_id}\n`)
    const session = controlledResearchSession({
      qualification: 'fixture_only',
      script: new URL('./research-processing-child.cjs', import.meta.url),
      signal,
    })
    return {
      send: session.send,
      messages: {
        async *[Symbol.asyncIterator]() {
          for await (const frame of session.messages) {
            const result = frame as { result?: { thread?: { id?: string } } }
            const match = result.result?.thread?.id?.match(/^research-child-(\d+)-/)
            if (match) {
              process.stdout.write(`RESEARCH_CHILD_PID:${match[1]}\n`)
            }
            yield frame
          }
        },
      },
      async close() {
        await session.close()
        process.stdout.write(`RESEARCH_SESSION_REAPED:${input.payload.attempt_id}\n`)
      },
    }
  },
})
DBOS.setConfig({
  name: 'bench-intake-controlled-research',
  systemDatabaseUrl: config.schedulerDatabaseUrl,
  applicationVersion: 'processing/3',
  executorID: `controlled-${config.actorId}`,
  runAdminServer: false,
  systemDatabasePoolSize: 3,
  logLevel: 'error',
})
DBOS.registerWorkflow(
  async (payload: unknown) => {
    const workflowId = DBOS.workflowID
    if (!workflowId) {
      throw new Error('controlled_workflow_context_required')
    }
    return DBOS.runStep(
      () => executeProcessingCommand(db.pool, config, workflowId, payload, runner),
      { name: 'restrictedControlledResearch', retriesAllowed: false },
    )
  },
  { name: 'intakeCommand' },
)
await DBOS.launch()
await DBOS.registerQueue('bench-research', { workerConcurrency: 1, globalConcurrency: 1 })
const scheduler = await DBOSClient.create({
  systemDatabaseUrl: config.schedulerDatabaseUrl,
  systemDatabasePoolSize: 1,
})
let stopping = false
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopping = true
    cancellation.abort()
  })
}
process.stdout.write('RESEARCH_PROCESSING_READY\n')
try {
  while (!stopping) {
    await dispatchProcessingCommands(db.pool, scheduler, config)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
} finally {
  await scheduler.destroy()
  await DBOS.shutdown({ workflowCompletionTimeoutMS: 1500 })
  await db.close()
}
