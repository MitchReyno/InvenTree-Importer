import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk'
import { setTimeout as delay } from 'node:timers/promises'
import type { ProcessingEnvelopeV2Dto, ProcessingSourceDto } from '@invimport/contracts'
import { database } from '../db/database.ts'
import { sha256 } from '../db/authority.ts'
import { decodeMediaInputs } from '../media/inputs.ts'
import { executeProcessingCommand, dispatchProcessingCommands } from '../processing/delivery.ts'
import type { RestrictedResearchRunner } from '../processing/runner.ts'
import { readDevState } from './state.ts'

const synthetic: RestrictedResearchRunner = {
  qualification: 'fixture_only',
  profileId: 'synthetic-research/2',
  async run(command, emit) {
    const input = command.manifest
    if (input.schema_version !== 'bench-intake-input/2') {
      throw new Error('synthetic_input_required')
    }
    const binding = {
      schema_version: 'bench-intake-runner/2',
      profile_id: 'synthetic-research/2',
      handler_version: 'processing/2',
      job_id: command.payload.job_id,
      attempt_id: command.payload.attempt_id,
      command_id: command.payload.command_id,
      input_sha256: command.payload.input_sha256,
    } as const
    const media = decodeMediaInputs(
      Buffer.from(input.media.manifest),
      Buffer.from(input.media.sha256, 'hex'),
    )
    const sources: ProcessingSourceDto[] = [
      ...input.notes.map((note) => ({
        kind: 'note' as const,
        note_id: note.id,
        text_sha256: sha256(note.text).toString('hex'),
      })),
      ...media.versions.map((version) => ({
        kind: 'media_version' as const,
        version_id: version.versionId,
        evidence_id: version.evidenceId,
        sha256: version.digest,
      })),
    ]
    const proposal: ProcessingEnvelopeV2Dto = {
      ...binding,
      sequence: '1',
      kind: 'proposal',
      payload: {
        schema_version: 'bench-intake-proposal/2',
        subject_id: input.subject_id,
        summary:
          'SYNTHETIC development result from retained notes and media descriptors. No model inference, image inspection or inventory research was performed.',
        sources,
      },
    }
    await emit(proposal)
    await emit({ ...binding, sequence: '2', kind: 'terminal', payload: { state: 'ready' } })
  },
}

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
      name: 'bench-intake-dev-processing',
      systemDatabaseUrl: state.runnerConfig.schedulerDatabaseUrl,
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
          () => executeProcessingCommand(db.pool, config, DBOS.workflowID!, payload, synthetic),
          { name: 'syntheticDevelopment', retriesAllowed: false },
        )
      },
      { name: 'intakeCommand' },
    )
    await DBOS.launch()
    await DBOS.registerQueue('bench-research', { workerConcurrency: 1, globalConcurrency: 1 })
    scheduler = await DBOSClient.create({
      systemDatabaseUrl: state.runnerConfig.schedulerDatabaseUrl,
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
