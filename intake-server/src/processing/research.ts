import type { Pool } from 'pg'
import { and, eq } from 'drizzle-orm'
import { validate, type ProcessingInputV3Dto } from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { captureInTransaction } from '../capture/repository.ts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import { prepareMediaTransaction } from '../media/transaction.ts'
import { assertResearchActive, refuseResearch } from '../research/errors.ts'
import type { ResearchReceiptScope } from '../research/receipts.ts'
import type { ProcessingConfig } from './attempts.ts'
import { loadProcessingAuthority, processingInputIsCurrent } from './authority.ts'
import { processingDependencyStatus } from './dependencies.ts'
import { processingMediaFor, readProcessingMediaScopes } from './media.ts'
import { processingLanes } from './schema.ts'
import type { ResearchInput } from './runner.ts'

export interface ResearchAttemptAccess {
  scope: ResearchReceiptScope
  manifest: ProcessingInputV3Dto
  ensureCurrent: (signal: AbortSignal) => Promise<void>
}

/** Research obtains currentness through its owning boundary, without receiving SQL or channel authority. */
export async function researchAttemptAccess(
  pool: Pool,
  config: ProcessingConfig,
  supplied: ResearchInput,
): Promise<ResearchAttemptAccess> {
  const input = structuredClone(supplied)
  validate('ProcessingInputV3', input.manifest)
  validate('ProcessingCommandV3', input.payload)
  if (input.manifest.schema_version !== 'bench-intake-input/3') {
    refuseResearch('research_input_invalid')
  }
  const manifest = input.manifest
  const scope: ResearchReceiptScope = Object.freeze({
    actorId: config.actorId,
    targetId: config.targetId,
    targetContextId: config.targetContextId,
    batchId: manifest.batch_id,
    attemptId: input.payload.attempt_id,
    commandId: input.payload.command_id,
    inputSha256: input.payload.input_sha256,
    sourceUrls: Object.freeze([...manifest.source_urls]),
  })

  async function ensureCurrent(signal: AbortSignal) {
    assertResearchActive(signal)
    await transaction(pool, async (client) => {
      await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
      await prepareMediaTransaction(client)
      const authority = await loadProcessingAuthority(client, config, scope.attemptId)
      const sameInput =
        canonical(authority.payload) === canonical(input.payload) &&
        canonical(authority.manifest) === canonical(manifest) &&
        authority.row.instruction_bytes.toString('utf8') === input.instructions
      if (!sameInput) {
        refuseResearch('research_input_invalid')
      }
      const capture = await captureInTransaction(client, config, scope.batchId)
      const mediaScopes = await readProcessingMediaScopes(client, config, capture.snapshot, [
        manifest.subject_id,
      ])
      const media = processingMediaFor(mediaScopes, manifest.subject_id)
      const dependencies = await processingDependencyStatus(client, config, authority)
      const lanes = await executeDatabaseQuery(
        queryDatabase(client)
          .select({ attemptId: processingLanes.attemptId })
          .from(processingLanes)
          .where(
            and(
              eq(processingLanes.actorId, config.actorId),
              eq(processingLanes.attemptId, scope.attemptId),
            ),
          ),
      )
      const current =
        !capture.snapshot.archived &&
        authority.row.current_attempt_id === scope.attemptId &&
        authority.row.state === 'running' &&
        authority.row.job_state === 'running' &&
        lanes.length === 1 &&
        dependencies.current &&
        dependencies.ready &&
        media.available &&
        processingInputIsCurrent(
          manifest,
          capture.snapshot,
          media.inputs,
          config.approvedSourceUrls,
        )
      if (!current) {
        refuseResearch('research_attempt_unavailable')
      }
    })
    assertResearchActive(signal)
  }

  await ensureCurrent(new AbortController().signal)
  return Object.freeze({ scope, manifest, ensureCurrent })
}
