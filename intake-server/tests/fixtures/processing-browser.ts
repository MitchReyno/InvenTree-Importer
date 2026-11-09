import { DBOS, DBOSClient } from '@dbos-inc/dbos-sdk'
import { createServer } from 'node:net'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import {
  validate,
  type CaptureEditDto,
  type CaptureSnapshotDto,
  type ProcessingSnapshotDto,
} from '@invimport/contracts'
import { captureRepository } from '#/capture/repository.ts'
import { syntheticDevelopmentRunner } from '#/dev/synthetic-runner.ts'
import {
  dispatchProcessingCommands,
  executeProcessingCommand,
} from '#/processing/delivery.ts'
import type { RestrictedResearchRunner } from '#/processing/runner.ts'
import { processingFixture } from '../support/processing.ts'
import { processingMediaFixture } from '../support/processing-media.ts'
import { processingCheckpoint } from '../support/processing-process.ts'

/** Explicit qualification entrypoint only. Never imported by an application or normal test. */
async function availablePort(): Promise<number> {
  const requested = process.env.INTAKE_PROCESSING_PREVIEW_PORT
  if (
    requested &&
    (!/^[1-9][0-9]{3,4}$/.test(requested) || Number(requested) < 1024 || Number(requested) > 65535)
  ) {
    throw new Error('processing_preview_port_invalid')
  }
  const probe = createServer()
  try {
    await new Promise<void>((resolve, reject) => {
      probe.once('error', reject)
      probe.listen(Number(requested ?? '4350'), '127.0.0.1', resolve)
    })
    const address = probe.address()
    if (!address || typeof address === 'string') {
      throw new Error('processing_preview_port_unavailable')
    }
    return address.port
  } finally {
    if (probe.listening) {
      await new Promise<void>((resolve) => probe.close(() => resolve()))
    }
  }
}

function captureValue(value: unknown): CaptureSnapshotDto {
  validate('CaptureSnapshot', value)
  return value as CaptureSnapshotDto
}

async function seedCapture(fixture: Awaited<ReturnType<typeof processingFixture>>) {
  const repository = captureRepository(fixture.api.pool, fixture.config)
  let batch = captureValue(
    await repository.create(randomUUID(), {
      title: 'SYNTHETIC · two physical packets',
      note: 'Deterministic browser fixture only. Keep Packet A and Packet B separate. No provider or inventory transport exists.',
    }),
  )

  async function edit(change: CaptureEditDto['change']) {
    batch = captureValue(
      await repository.edit(batch.id, randomUUID(), { expected_revision: batch.revision, change }),
    )
  }

  await edit({ kind: 'add_part', label: 'Synthetic shared Part candidate' })
  const partId = batch.parts[0].id
  await edit({
    kind: 'add_lot',
    label: 'Packet A · counted sample',
    note: 'Human fixture count: 17.000001 units. This is a synthetic exact decimal.',
    part_subject_id: partId,
  })
  await edit({
    kind: 'add_lot',
    label: 'Packet B · separate stock',
    note: 'Human fixture count: 23 units. This is a separate physical packet.',
    part_subject_id: partId,
  })
  const lotA = batch.lots.find((lot) => lot.label.startsWith('Packet A'))!
  const lotB = batch.lots.find((lot) => lot.label.startsWith('Packet B'))!
  await edit({ kind: 'lot', id: lotA.id, quantity: { mode: 'set', value: '17.000001' } })
  await edit({ kind: 'lot', id: lotB.id, quantity: { mode: 'set', value: '23' } })
  return { batch, lotA: lotA.id, lotB: lotB.id, partId }
}

function syntheticRunner(questionSubjectId: string): RestrictedResearchRunner {
  return {
    profileId: 'synthetic-research/2',
    qualification: 'fixture_only',
    async run(command, emit) {
      const version = command.manifest.schema_version
      if (version !== 'bench-intake-input/2' && version !== 'bench-intake-input/5') {
        throw new Error('processing_preview_v2_required')
      }
      const binding = {
        schema_version: 'bench-intake-runner/2' as const,
        profile_id: 'synthetic-research/2' as const,
        handler_version: 'processing/2' as const,
        job_id: command.payload.job_id,
        attempt_id: command.payload.attempt_id,
        command_id: command.payload.command_id,
        input_sha256: command.payload.input_sha256,
      }
      const needsConfirmation =
        command.manifest.subject_id === questionSubjectId &&
        command.manifest.stage === 'reading' &&
        command.manifest.answer_id === null
      if (needsConfirmation) {
        await emit({
          ...binding,
          sequence: '1',
          kind: 'question',
          payload: {
            kind: 'quantity',
            subject_id: questionSubjectId,
            prompt: 'Synthetic fixture: confirm the count for Packet A.',
            reason:
              'This deterministic fixture requests confirmation so you can exercise a pinned answer draft. No provider inferred uncertainty.',
          },
        })
        return
      }
      // Proposals come from the development runner, which cites only evidence notes.
      await syntheticDevelopmentRunner.run(command, emit)
    },
  }
}

async function main() {
  const image = process.env.INTAKE_MEDIA_DECODER_IMAGE
  if (!image || !/^sha256:[a-f0-9]{64}$/.test(image)) {
    throw new Error('processing_preview_decoder_image_required')
  }
  const port = await availablePort()
  const assets = fileURLToPath(new URL('../../../frontend/dist/', import.meta.url))
  const artifactRoot = fileURLToPath(new URL('../../../.amp/in/artifacts/', import.meta.url))
  const metadataPath = `${artifactRoot}/T06-preview.json`
  let stopRequested = false
  let resolveStop: () => void = () => {}
  const stopped = new Promise<void>((resolve) => {
    resolveStop = resolve
  })
  const requestStop = () => {
    stopRequested = true
    resolveStop()
  }
  process.once('SIGINT', requestStop)
  process.once('SIGTERM', requestStop)
  const fixture = await processingFixture({ autoStart: false })
  let media: Awaited<ReturnType<typeof processingMediaFixture>> | undefined
  let scheduler: DBOSClient | undefined
  let launched = false
  let loop: Promise<void> | undefined
  let metadata: string | undefined
  try {
    const capture = await seedCapture(fixture)
    if (stopRequested) {
      return
    }
    media = await processingMediaFixture(fixture, capture.batch.id)
    await fixture.start({ port, assets, mediaStore: media.store, readOnlyInventoryActivity: true })
    await media.upload(capture.partId, 'SYNTHETIC one-pixel media descriptor fixture.png')
    await media.decodeNext()
    if (stopRequested) {
      return
    }
    const retainedMedia = await media.snapshot()
    if (retainedMedia.evidence[0]?.versions[0]?.state !== 'ready') {
      throw new Error('processing_preview_media_not_ready')
    }
    const runner = syntheticRunner(capture.lotA)
    DBOS.setConfig({
      name: 'bench-intake-synthetic-browser',
      systemDatabaseUrl: fixture.scheduler.url,
      applicationVersion: 'processing/2',
      executorID: `synthetic-browser-${fixture.identity.actor}`,
      runAdminServer: false,
      systemDatabasePoolSize: 3,
      logLevel: 'error',
    })
    DBOS.registerWorkflow(
      async (payload: unknown) => {
        const workflowId = DBOS.workflowID
        if (!workflowId) {
          throw new Error('processing_preview_workflow_context_required')
        }
        return DBOS.runStep(
          () =>
            executeProcessingCommand(
              fixture.runner.pool,
              fixture.config,
              workflowId,
              payload,
              runner,
            ),
          { name: 'syntheticBrowserResearch', retriesAllowed: false },
        )
      },
      { name: 'intakeCommand' },
    )
    await DBOS.launch()
    launched = true
    await DBOS.registerQueue('bench-research', { workerConcurrency: 1, globalConcurrency: 1 })
    scheduler = await DBOSClient.create({
      systemDatabaseUrl: fixture.scheduler.url,
      systemDatabasePoolSize: 1,
    })
    if (stopRequested) {
      return
    }
    const initial = await fixture.http(`/batches/${capture.batch.id}/processing`, {
      schema_version: 'bench-intake-processing/1',
      expected_capture_revision: capture.batch.revision,
      subject_ids: [capture.lotA, capture.lotB],
      stages: ['reading'],
    })
    if (initial.status !== 202) {
      throw new Error('processing_preview_start_failed')
    }
    const client = scheduler
    loop = (async () => {
      while (!stopRequested) {
        await dispatchProcessingCommands(fixture.runner.pool, client, fixture.config)
        await new Promise<void>((resolve) => setTimeout(resolve, 500))
      }
    })()
    // Keep startup, active-loop failure and shutdown observable without an unhandled promise.
    const loopFailure = loop.then(() => {
      if (!stopRequested) {
        throw new Error('processing_preview_loop_stopped')
      }
    })
    const ready = await Promise.race([
      processingCheckpoint(
        async () => {
          const response = await fixture.http(`/batches/${capture.batch.id}/processing`)
          if (response.status !== 200) {
            throw new Error('processing_preview_read_failed')
          }
          return response.value as ProcessingSnapshotDto
        },
        (snapshot) => {
          const waitingQuestion = snapshot.jobs.some(
            (job) =>
              job.subject_id === capture.lotA &&
              job.questions.some((question) => question.state === 'open'),
          )
          const otherLotReady = snapshot.jobs.some(
            (job) => job.subject_id === capture.lotB && job.state === 'ready',
          )
          return stopRequested || (waitingQuestion && otherLotReady)
        },
      ),
      loopFailure,
    ])
    if (stopRequested) {
      return
    }
    if (!ready) {
      throw new Error('processing_preview_seed_incomplete')
    }
    const question = ready.jobs
      .flatMap((job) => job.questions)
      .find((question) => question.state === 'open')
    if (!question) {
      throw new Error('processing_preview_question_missing')
    }
    const url = `${fixture.config.origin}/#${capture.batch.id}/processing/overview/${question.id}`
    metadata =
      JSON.stringify({ url, batch_id: capture.batch.id, question_id: question.id }, null, 2) + '\n'
    await mkdir(artifactRoot, { recursive: true })
    await writeFile(metadataPath, metadata, { flag: 'wx', mode: 0o600 })
    process.stdout.write(`SYNTHETIC fixture only; no provider or inventory transport. ${url}\n`)
    await Promise.race([stopped, loopFailure])
  } finally {
    requestStop()
    // Independent cleanup steps still run if one resource refuses to close.
    const webCleanup = await Promise.allSettled([fixture.stop(), loop])
    const workerCleanup = await Promise.allSettled([
      scheduler?.destroy(),
      launched ? DBOS.shutdown({ workflowCompletionTimeoutMS: 1000 }) : undefined,
    ])
    const ownedCleanup = await Promise.allSettled([media?.dispose(), fixture.dispose()])
    if (metadata && (await readFile(metadataPath, 'utf8').catch(() => '')) === metadata) {
      await unlink(metadataPath)
    }
    const cleanupFailed = [...webCleanup, ...workerCleanup, ...ownedCleanup].some(
      (result) => result.status === 'rejected',
    )
    if (cleanupFailed) {
      throw new Error('processing_preview_cleanup_incomplete')
    }
    process.removeListener('SIGINT', requestStop)
    process.removeListener('SIGTERM', requestStop)
  }
}

void main().catch(() => {
  process.stderr.write(
    'Synthetic Processing browser fixture failed; owned cleanup was attempted.\n',
  )
  process.exitCode = 1
})
