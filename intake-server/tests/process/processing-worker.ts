import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { database } from '../../src/db/database.ts'
import type { ProcessingConfig } from '../../src/processing/attempts.ts'
import {
  dispatchProcessingCommands,
  executeProcessingCommand,
} from '../../src/processing/delivery.ts'
import type { RestrictedResearchRunner } from '../../src/processing/runner.ts'
import { sha256 } from '../../src/db/authority.ts'
import { decodeMediaInputs } from '../../src/media/inputs.ts'
import { evidenceNotes } from '../../src/capture/context-input.ts'
import type { ProcessingEnvelopeDto } from '@invimport/contracts'

/** Explicit synthetic process fixture. It cannot infer, authenticate a provider or reach inventory. */
const configPath = process.env.INTAKE_SYNTHETIC_PROCESSING_CONFIG
if (!configPath) throw new Error('synthetic_processing_configuration_required')
const config: ProcessingConfig & {
  runnerDatabaseUrl: string
  schedulerDatabaseUrl: string
  pauseAfterClaim: boolean
  controlledAttemptId?: string
} = JSON.parse(await readFile(configPath, 'utf8'))
for (const connection of [config.runnerDatabaseUrl, config.schedulerDatabaseUrl]) {
  const url = new URL(connection)
  if (url.hostname !== '127.0.0.1' || !/^intake_test_[a-f0-9]+$/.test(url.pathname.slice(1))) {
    throw new Error('synthetic_owned_processing_database_required')
  }
}
const control = config.controlledAttemptId ? createInterface({ input: process.stdin }) : null

async function waitForControl(expected: 'proposal' | 'terminal') {
  if (!control) throw new Error('synthetic_control_not_configured')
  const [step] = await once(control, 'line')
  if (step !== expected) throw new Error('synthetic_control_step_mismatch')
}

const db = database(config.runnerDatabaseUrl)
const synthetic: RestrictedResearchRunner = {
  profileId: 'synthetic-research/2',
  qualification: 'fixture_only',
  async run(command, emit) {
    process.stdout.write(`SYNTHETIC_CLAIMED:${command.payload.attempt_id}\n`)
    if (config.pauseAfterClaim) await new Promise<void>(() => {})
    const binding = {
      schema_version: 'bench-intake-runner/2' as const,
      job_id: command.payload.job_id,
      attempt_id: command.payload.attempt_id,
      command_id: command.payload.command_id,
      input_sha256: command.payload.input_sha256,
      profile_id: 'synthetic-research/2' as const,
      handler_version: 'processing/2' as const,
    }
    if (
      command.manifest.schema_version !== 'bench-intake-input/2' &&
      command.manifest.schema_version !== 'bench-intake-input/5'
    ) {
      throw new Error('synthetic_v2_input_required')
    }
    const media = decodeMediaInputs(
      Buffer.from(command.manifest.media.manifest),
      Buffer.from(command.manifest.media.sha256, 'hex'),
    )
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
    const controlled = command.payload.attempt_id === config.controlledAttemptId
    if (controlled) await waitForControl('proposal')
    await emit({
      ...binding,
      sequence: '1',
      kind: 'proposal',
      payload: {
        subject_id: subject.id,
        summary: 'Synthetic replayed candidate from retained human notes; not actual AI research.',
        schema_version: 'bench-intake-proposal/2',
        sources: [
          ...evidenceNotes(command.manifest.notes, command.manifest.batch_id).map((note) => ({
            kind: 'note' as const,
            note_id: note.id,
            text_sha256: sha256(note.text).toString('hex'),
          })),
          ...media.versions.map((version) => ({
            kind: 'media_version' as const,
            evidence_id: version.evidenceId,
            version_id: version.versionId,
            sha256: version.digest,
          })),
        ],
      },
    })
    process.stdout.write(`SYNTHETIC_PROPOSAL:${command.payload.attempt_id}\n`)
    if (controlled) await waitForControl('terminal')
    await emit({ ...binding, sequence: '2', kind: 'terminal', payload: { state: 'ready' } })
  },
}
DBOS.setConfig({
  name: 'bench-intake-synthetic-processing',
  systemDatabaseUrl: config.schedulerDatabaseUrl,
  applicationVersion: 'processing/2',
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
  control?.close()
  await scheduler.destroy()
  await DBOS.shutdown({ workflowCompletionTimeoutMS: 100 })
  await db.close()
}
