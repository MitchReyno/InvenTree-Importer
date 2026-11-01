import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk'
import { readFile } from 'node:fs/promises'
import { database } from '../../src/db/database.ts'
import type { ProcessingConfig } from '../../src/processing/attempts.ts'
import {
  dispatchProcessingCommands,
  executeProcessingCommand,
} from '../../src/processing/delivery.ts'
import type { RestrictedResearchRunner } from '../../src/processing/runner.ts'
import type { ProcessingEnvelopeDto } from '@invimport/contracts'

/** Explicit synthetic process fixture. It cannot infer, authenticate a provider or reach inventory. */
const configPath = process.env.INTAKE_SYNTHETIC_PROCESSING_CONFIG
if (!configPath) throw new Error('synthetic_processing_configuration_required')
const config: ProcessingConfig & {
  runnerDatabaseUrl: string
  schedulerDatabaseUrl: string
  pauseAfterClaim: boolean
} = JSON.parse(await readFile(configPath, 'utf8'))
for (const connection of [config.runnerDatabaseUrl, config.schedulerDatabaseUrl]) {
  const url = new URL(connection)
  if (url.hostname !== '127.0.0.1' || !/^intake_test_[a-f0-9]+$/.test(url.pathname.slice(1))) {
    throw new Error('synthetic_owned_processing_database_required')
  }
}
const db = database(config.runnerDatabaseUrl)
const synthetic: RestrictedResearchRunner = {
  profileId: 'synthetic-research/1',
  qualification: 'fixture_only',
  async run(command, emit) {
    process.stdout.write(`SYNTHETIC_CLAIMED:${command.payload.attempt_id}\n`)
    if (config.pauseAfterClaim) await new Promise<void>(() => {})
    const binding = {
      schema_version: 'bench-intake-runner/1' as const,
      job_id: command.payload.job_id,
      attempt_id: command.payload.attempt_id,
      command_id: command.payload.command_id,
      input_sha256: command.payload.input_sha256,
      profile_id: 'synthetic-research/1' as const,
      handler_version: 'processing/1' as const,
    }
    const subject = command.manifest.subject
    const quantity = 'quantity' in subject ? subject.quantity : null
    if (command.manifest.stage === 'reading' && quantity?.mode !== 'set') {
      const question: ProcessingEnvelopeDto = {
        ...binding,
        sequence: '1',
        kind: 'question',
        payload: {
          kind: 'quantity',
          subject_id: subject.id,
          prompt: 'Synthetic fixture: how many are in this packet?',
          reason: 'Synthetic fixture pauses for a human count; no provider was called.',
        },
      }
      await emit(question)
      return
    }
    await emit({
      ...binding,
      sequence: '1',
      kind: 'proposal',
      payload: {
        subject_id: subject.id,
        summary: 'Synthetic replayed candidate from retained human notes; not actual AI research.',
        source_note_ids: command.manifest.notes.map((note) => note.id),
      },
    })
    await emit({ ...binding, sequence: '2', kind: 'terminal', payload: { state: 'ready' } })
  },
}
DBOS.setConfig({
  name: 'bench-intake-synthetic-processing',
  systemDatabaseUrl: config.schedulerDatabaseUrl,
  applicationVersion: 'processing/1',
  executorID: `synthetic-${config.actorId}`,
  runAdminServer: false,
  systemDatabasePoolSize: 3,
  logLevel: 'error',
})
DBOS.registerWorkflow(
  async (payload: unknown) => {
    const workflowId = DBOS.workflowID
    if (!workflowId) throw new Error('synthetic_workflow_context_required')
    return DBOS.runStep(
      () => executeProcessingCommand(db.pool, config, workflowId, payload, synthetic),
      { name: 'restrictedSyntheticResearch', retriesAllowed: false },
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
  })
}
process.stdout.write('SYNTHETIC_PROCESSING_READY\n')
try {
  while (!stopping) {
    await dispatchProcessingCommands(db.pool, scheduler, config)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
} finally {
  await scheduler.destroy()
  await DBOS.shutdown({ workflowCompletionTimeoutMS: 100 })
  await db.close()
}
