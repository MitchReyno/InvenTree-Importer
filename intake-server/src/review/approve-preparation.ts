import { and, eq, sql } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
import { manualApprovals, manualRuns } from './schema.ts'
import { selectedPartTransfers } from './part-attachments.ts'
import { knownPartBindings, knownRecordBindings, supportedPlan } from './effects-plan.ts'
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { canonical } from '@invimport/contracts/json'
import { idempotent, appendEvent } from '#/db/authority.ts'
import { fail } from '#/capture/model.ts'
import { loadRun, reserveApprovedStock } from '#/execution/authority.ts'
import { encodeExecutablePlan } from '#/execution/media-plan.ts'
import { preparedPlan } from './media-plan.ts'
import {
  lockedCapture,
  deploymentBinding,
  historyIssues,
  currentReviews,
  requireReviews,
  type ManualConfig,
  isEffectsBinding,
} from './authority.ts'
import { materializeWithMedia } from './media-material.ts'
import { retainedPreparation } from './runs.ts'
import { commandScope, warningIssues } from './selection.ts'

export interface ApprovalInput {
  preparation_id: string
  expected_plan_sha256: string
  expected_review_fingerprint: string
  selected_lot_ids: string[]
  expected_target_revision: string
}

export async function approvePreparation(
  pool: Pool,
  config: ManualConfig,
  key: string,
  input: ApprovalInput,
) {
  const payload = { ...input, selected_lot_ids: [...input.selected_lot_ids].sort() }
  return transaction(pool, (client) =>
    idempotent(
      client,
      commandScope(config, 'manual_approve', input.preparation_id, key),
      payload,
      async () => {
        const preparation = await retainedPreparation(client, config, input.preparation_id)
        const preview = preparation.preview
        if (
          input.expected_plan_sha256 !== preview.plan_sha256 ||
          input.expected_review_fingerprint !== preview.review_fingerprint ||
          input.expected_target_revision !== preview.target_revision ||
          canonical(payload.selected_lot_ids) !== canonical(preview.selected_lot_ids)
        ) {
          fail('approval_binding_mismatch', 409)
        }
        const capture = await lockedCapture(client, config, preview.batch_id)
        const previous = await executeDatabaseQuery(
          queryDatabase(client)
            .select({ id: manualApprovals.id })
            .from(manualApprovals)
            .where(
              and(
                eq(manualApprovals.preparationId, preview.id),
                eq(manualApprovals.actorId, config.actorId),
              ),
            ),
        )
        if (previous[0]) {
          const runResult = await executeDatabaseQuery(
            queryDatabase(client)
              .select({ id: manualRuns.id })
              .from(manualRuns)
              .where(eq(manualRuns.approvalId, previous[0].id)),
          )
          if (!runResult[0]) {
            fail('run_authority_missing', 409)
          }
          const original = await loadRun(client, runResult[0].id)
          await reserveApprovedStock(client, {
            approvalId: original.approvalId,
            preparationId: preview.id,
            runId: original.runId,
            commandId: original.commandId,
            actorId: config.actorId,
            bytes: preparation.row.plan_bytes,
            digest: preparation.row.plan_digest,
          })
          return {
            run_id: original.runId,
            approval_id: original.approvalId,
            preparation_id: preview.id,
          }
        }
        const material = await materializeWithMedia(
          client,
          config,
          capture.snapshot,
          preview.selected_lot_ids,
        )
        const binding = await deploymentBinding(client, config)
        const reviews = await currentReviews(client, preview.batch_id, material)
        const problems = [
          ...material.issues,
          ...warningIssues(material),
          ...(await historyIssues(client, capture.source, material, capture.guard.activeRunId)),
        ]
        if (problems.length) {
          fail(problems[0].code, 409)
        }
        if (
          !binding ||
          binding.targetRevision !== preview.target_revision ||
          !material.bytes.equals(preparation.row.dependency_bytes) ||
          canonical(reviews) !== preparation.row.review_bytes.toString('utf8')
        ) {
          fail('stale_preparation', 409)
        }
        requireReviews(material, reviews)
        const currentPlan = encodeExecutablePlan(
          isEffectsBinding(binding)
            ? supportedPlan(
                binding,
                capture.sourceId,
                capture.originalSourceKey,
                material,
                await knownPartBindings(client, capture.source, material),
                await selectedPartTransfers(
                  client,
                  capture.source,
                  material,
                  await knownPartBindings(client, capture.source, material),
                ),
                await knownRecordBindings(client, capture.source, material),
              )
            : preparedPlan(binding, capture.sourceId, capture.originalSourceKey, material),
        )
        if (!currentPlan.bytes.equals(preparation.row.plan_bytes)) {
          fail('stale_preparation', 409)
        }
        const approved = await reserveApprovedStock(client, {
          approvalId: randomUUID(),
          preparationId: preview.id,
          runId: randomUUID(),
          commandId: randomUUID(),
          actorId: config.actorId,
          bytes: preparation.row.plan_bytes,
          digest: preparation.row.plan_digest,
        })
        const roundResult = await executeDatabaseQuery(
          queryDatabase(client)
            .select({ next: sql<string>`(count(*)+1)::text` })
            .from(manualApprovals)
            .where(eq(manualApprovals.batchId, preview.batch_id)),
        )
        await executeDatabaseQuery(
          queryDatabase(client)
            .insert(manualApprovals)
            .values({
              id: approved.approvalId,
              batchId: preview.batch_id,
              preparationId: preview.id,
              actorId: config.actorId,
              roundNumber: BigInt(roundResult[0].next),
            }),
        )
        await executeDatabaseQuery(
          queryDatabase(client).insert(manualRuns).values({
            id: approved.runId,
            batchId: preview.batch_id,
            approvalId: approved.approvalId,
            actorId: config.actorId,
            streamId: capture.streamId,
          }),
        )
        await appendEvent(client, capture.streamId, 'manual_approved', {
          batch_id: preview.batch_id,
          run_id: approved.runId,
          approval_id: approved.approvalId,
        })
        return {
          run_id: approved.runId,
          approval_id: approved.approvalId,
          preparation_id: preview.id,
        }
      },
    ),
  )
}
