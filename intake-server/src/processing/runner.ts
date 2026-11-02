import type { Pool } from 'pg'
import { eq } from 'drizzle-orm'
import type {
  ProcessingEnvelopeDto,
  ProcessingInputDto,
  ProcessingCommandDto,
} from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { commands } from '../db/schema.ts'
import { processingAttempts, processingLanes } from './schema.ts'
import { appendEvent } from '../db/authority.ts'
import { lockCaptureForInputSettlement } from '../capture/repository.ts'
import { lockLane } from './scope.ts'
import { channelToken, type ProcessingConfig } from './attempts.ts'
import {
  fail,
  mediaHandlerVersion,
  mediaProfileId,
  researchHandlerVersion,
  sealed,
  type SelectedProcessingProfile,
} from './model.ts'
import { loadProcessingAuthority, processingInputIsCurrent } from './authority.ts'
import { prepareMediaTransaction } from '../media/transaction.ts'
import { lockProcessingMediaCurrency } from './media.ts'
import { lockProcessingAttempt, transitionAttempt, releaseProcessingLane } from './state.ts'
import { processingDependencyStatus } from './dependencies.ts'

export interface ResearchInput {
  payload: ProcessingCommandDto
  manifest: ProcessingInputDto
  instructions: string
}

export interface ResearchCommand extends ResearchInput {
  /** Coordinator-only channel capability. Never pass it into a provider adapter or public DTO. */
  channelToken: string
}

export interface RestrictedResearchRunner {
  qualification: 'fixture_only'
  profileId: SelectedProcessingProfile
  run(
    command: ResearchInput,
    emit: (message: ProcessingEnvelopeDto) => Promise<void>,
  ): Promise<void>
}

/** Claims one actor lane and verifies actual retained bytes before returning bounded staged input. */
export async function claimProcessingCommand(
  pool: Pool,
  config: ProcessingConfig,
  workflowId: string,
  payload: unknown,
  actualHandlerVersion: string,
): Promise<ResearchCommand | null> {
  if (![mediaHandlerVersion, researchHandlerVersion].includes(actualHandlerVersion)) {
    fail('worker_version_conflict')
  }
  return transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    const matchingCommands = await executeDatabaseQuery(
      queryDatabase(client)
        .select({ id: commands.id })
        .from(commands)
        .where(eq(commands.workflowId, workflowId)),
    )
    const found = matchingCommands[0]
    if (!found) {
      fail('command_missing', 404)
    }
    const attempts = await executeDatabaseQuery(
      queryDatabase(client)
        .select({ id: processingAttempts.id })
        .from(processingAttempts)
        .where(eq(processingAttempts.commandId, found.id)),
    )
    const ref = attempts[0]
    if (!ref) {
      fail('attempt_not_found', 404)
    }
    const retained = await loadProcessingAuthority(client, config, ref.id)
    if (canonical(payload) !== canonical(retained.payload)) {
      fail('payload_conflict')
    }
    if (
      retained.manifest.profile_id !== (config.profileId ?? mediaProfileId) ||
      retained.payload.handler_version !== actualHandlerVersion
    ) {
      fail('worker_version_conflict')
    }
    const token = channelToken(config, ref.id)
    const channelMatches = sealed(token).digest.equals(retained.row.channelDigest)
    if (!channelMatches) {
      fail('processing_channel_binding_mismatch', 503)
    }
    const capture = await lockCaptureForInputSettlement(client, config, retained.row.batchId)
    const media = await lockProcessingMediaCurrency(
      client,
      config,
      capture.snapshot,
      retained.manifest.subject_id,
    )
    const lane = await lockLane(client, config.actorId)
    const { job, attempt } = await lockProcessingAttempt(client, retained.row.jobId, ref.id)
    if (job.current_attempt_id !== attempt.id || attempt.state !== 'queued') {
      return null
    }
    const dependencies = await processingDependencyStatus(client, config, retained)
    if (
      capture.snapshot.archived ||
      !dependencies.current ||
      !media.available ||
      !processingInputIsCurrent(
        retained.manifest,
        capture.snapshot,
        media.inputs,
        config.approvedSourceUrls,
      )
    ) {
      await transitionAttempt(client, job, attempt, 'superseded')
      await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: job.batch_id })
      return null
    }
    if (lane.attempt_id || !dependencies.ready) {
      return null
    }
    await executeDatabaseQuery(
      queryDatabase(client)
        .update(processingLanes)
        .set({ attemptId: attempt.id })
        .where(eq(processingLanes.actorId, config.actorId)),
    )
    await transitionAttempt(client, job, attempt, 'running')
    await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: job.batch_id })
    return {
      payload: retained.payload,
      manifest: retained.manifest,
      instructions: retained.row.instructionBytes.toString('utf8'),
      channelToken: token,
    }
  })
}

/** Restart never revives a prior process or native permission callback; explicit new attempt required. */
export async function interruptProcessing(pool: Pool, config: ProcessingConfig, attemptId: string) {
  return transaction(pool, async (client) => {
    await prepareMediaTransaction(client)
    const { row } = await loadProcessingAuthority(client, config, attemptId)
    const capture = await lockCaptureForInputSettlement(client, config, row.batchId)
    const lane = await lockLane(client, config.actorId)
    const { job, attempt } = await lockProcessingAttempt(client, row.jobId, row.id)
    if (attempt.state !== 'running' && lane.attempt_id !== attempt.id) {
      return
    }
    if (attempt.state === 'running') {
      await transitionAttempt(client, job, attempt, 'interrupted')
    } else {
      await releaseProcessingLane(client, attempt.id)
    }
    await appendEvent(client, capture.streamId, 'processing_changed', { batch_id: row.batchId })
  })
}

export { acceptEnvelope } from './messages.ts'
