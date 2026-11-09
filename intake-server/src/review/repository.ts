import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { manualRuns, manualApprovals, manualPreparations, manualPrepareCommands } from './schema.ts'
import type { ManualAttachmentRead } from './part-attachments.ts'
import type { Pool, PoolClient } from 'pg'
import { validate, type ManualPreviewDto, type ManualWorkspaceDto } from '@invimport/contracts'
import { transaction } from '../db/database.ts'
import { captureInTransaction } from '../capture/repository.ts'
import { fail } from '../capture/model.ts'
import { canonical, canonicalRecord } from '@invimport/contracts/json'
import { stockSourceHistory } from '../execution/source.ts'
import type { CaptureRead } from '../capture/routes.ts'
import { deploymentBinding, currentReviews, type ManualConfig } from './authority.ts'
import { issue } from './model.ts'
import { materializeWithMedia } from './media-material.ts'
import { manualRunSnapshot, retainedPreparation } from './runs.ts'
import { preparationTree } from './preparation-tree.ts'
import { captureObservations } from '../capture/schema.ts'
import { isEffectsPlan } from '../execution/effects-plan.ts'
import {
  markReviewed,
  prepareSelection,
  approvePreparation,
  warningIssues,
} from './preparations.ts'
import { runCommand } from './commands.ts'

export function manualRepository(
  pool: Pool,
  config: ManualConfig,
  read?: CaptureRead,
  attachmentRead?: ManualAttachmentRead,
) {
  return {
    async activity() {
      return transaction(pool, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const rows = await executeDatabaseQuery(
          queryDatabase(client)
            .select({ id: manualRuns.id })
            .from(manualRuns)
            .innerJoin(manualApprovals, eq(manualApprovals.id, manualRuns.approvalId))
            .innerJoin(manualPreparations, eq(manualPreparations.id, manualApprovals.preparationId))
            .innerJoin(
              manualPrepareCommands,
              eq(manualPrepareCommands.id, manualPreparations.prepareCommandId),
            )
            .where(
              and(
                eq(manualApprovals.actorId, config.actorId),
                eq(manualPrepareCommands.targetId, config.targetId),
                eq(manualPrepareCommands.contextId, config.targetContextId),
              ),
            )
            .orderBy(manualRuns.id)
            .limit(101),
        )
        const runs = []
        for (const row of rows.slice(0, 100)) {
          const run = await manualRunSnapshot(client, config, row.id)
          if (run.state !== 'settled_complete') {
            runs.push({ batch_id: run.batch_id, run_id: run.run_id, state: run.state })
          }
        }
        return { runs, truncated: rows.length > 100 }
      })
    },
    /** The stored plan as a tree; it reads the retained preparation and changes nothing. */
    async tree(preparationId: string) {
      return transaction(pool, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const { row, plan, preview } = await retainedPreparation(client, config, preparationId)
        const ids = isEffectsPlan(plan)
          ? plan.parts.flatMap(({ spec }) => [
              spec.category.observation_id,
              ...spec.parameters.map((parameter) => parameter.template.observation_id),
              ...(spec.manufacturer ? [spec.manufacturer.company.observation_id] : []),
              ...(spec.supplier ? [spec.supplier.company.observation_id] : []),
            ])
          : []
        const rows = ids.length
          ? await executeDatabaseQuery(
              queryDatabase(client)
                .select({ id: captureObservations.id, label: captureObservations.label })
                .from(captureObservations)
                .where(
                  and(
                    eq(captureObservations.batchId, row.batch_id),
                    inArray(captureObservations.id, [...new Set(ids)]),
                  ),
                ),
            )
          : []
        const labels = new Map(rows.map((value) => [value.id, value.label]))
        return {
          preparation_id: preparationId,
          plan_version: plan.version,
          nodes: preparationTree(plan, preview, (id) => labels.get(id)),
        }
      })
    },
    review: (batchId: string, key: string, input: Parameters<typeof markReviewed>[4]) =>
      markReviewed(pool, config, batchId, key, input),
    prepare: (batchId: string, key: string, input: Parameters<typeof prepareSelection>[5]) =>
      prepareSelection(pool, config, read, batchId, key, input, attachmentRead),
    approve: (key: string, input: Parameters<typeof approvePreparation>[3]) =>
      approvePreparation(pool, config, key, input),
    command: (
      runId: string,
      key: string,
      input: Parameters<typeof runCommand>[4],
      action: Parameters<typeof runCommand>[5],
    ) => runCommand(pool, config, runId, key, input, action),
    async run(runId: string) {
      return transaction(pool, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        return manualRunSnapshot(client, config, runId)
      })
    },
    async workspace(batchId: string): Promise<ManualWorkspaceDto> {
      return transaction(pool, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const capture = await captureInTransaction(client, config, batchId)
        const binding = await deploymentBinding(client, config)
        const allMaterial = await materializeWithMedia(
          client,
          config,
          capture.snapshot,
          capture.snapshot.lots.map((value) => value.id),
          false,
        )
        const source = {
          targetId: config.targetId,
          sourceId: capture.sourceId,
          originalSourceKey: capture.originalSourceKey,
        }
        const history = await stockSourceHistory(
          client,
          source,
          allMaterial.effects.map((value) => value.contribution_key),
        )
        const blockingRun = history.runs.find(
          (value) => value.state === 'queued' || value.state === 'recovery_required',
        )
        const blockingRunId = history.activeRunId ?? blockingRun?.runId
        const lots: ManualWorkspaceDto['lots'] = []
        for (const lot of capture.snapshot.lots) {
          const material = await materializeWithMedia(
            client,
            config,
            capture.snapshot,
            [lot.id],
            false,
          )
          const issues = [...material.issues]
          if (!binding) {
            issues.push(
              issue(
                'unsupported_capability',
                'Only a separately configured owned fake can execute stock.',
                lot.id,
              ),
            )
          }
          if (blockingRunId) {
            issues.push(
              issue(
                'source_history_unsettled',
                'Inspect the earlier original run before approving more stock.',
                lot.id,
                blockingRunId,
              ),
            )
          }
          const previous = history.contributions.find(
            (value) => value.contribution_key === lot.contribution_key,
          )
          if (previous) {
            issues.push(
              issue(
                'original_contribution_already_approved',
                'This contribution already has an approval; inspect its original run.',
                lot.id,
                previous.run_id,
              ),
            )
          }
          const reviews = await currentReviews(client, batchId, material)
          lots.push({
            lot_id: lot.id,
            reviewed: reviews.length === material.subjects.length && !material.issues.length,
            issues,
          })
        }
        const runsResult = await executeDatabaseQuery(
          queryDatabase(client)
            .select({ id: manualRuns.id })
            .from(manualRuns)
            .innerJoin(manualApprovals, eq(manualApprovals.id, manualRuns.approvalId))
            .where(eq(manualRuns.batchId, batchId))
            .orderBy(manualApprovals.roundNumber),
        )
        const runs: ManualWorkspaceDto['runs'] = []
        for (const row of runsResult) {
          runs.push(await manualRunSnapshot(client, config, row.id))
        }
        const preparationsResult = await executeDatabaseQuery(
          queryDatabase(client)
            .select({ id: manualPreparations.id })
            .from(manualPreparations)
            .leftJoin(manualApprovals, eq(manualApprovals.preparationId, manualPreparations.id))
            .where(
              and(
                eq(manualPreparations.batchId, batchId),
                eq(manualPreparations.actorId, config.actorId),
                isNull(manualApprovals.id),
              ),
            )
            .orderBy(desc(manualPreparations.createdAt), desc(manualPreparations.id))
            .limit(21),
        )
        const preparations: ManualPreviewDto[] = []
        for (const row of preparationsResult.slice(0, 20)) {
          const retained = await retainedPreparation(client, config, row.id)
          const material = await materializeWithMedia(
            client,
            config,
            capture.snapshot,
            retained.preview.selected_lot_ids,
            false,
          )
          const reviews = await currentReviews(client, batchId, material)
          const previouslyApproved = material.effects.some((value) =>
            history.contributions.some(
              (previous) => previous.contribution_key === value.contribution_key,
            ),
          )
          if (
            binding &&
            !blockingRunId &&
            !previouslyApproved &&
            !material.issues.length &&
            !warningIssues(material).length &&
            binding.targetRevision === retained.preview.target_revision &&
            material.bytes.equals(retained.row.dependency_bytes) &&
            canonical(reviews) === retained.row.review_bytes.toString('utf8')
          ) {
            preparations.push(retained.preview)
          }
        }
        const result: ManualWorkspaceDto = {
          batch_id: batchId,
          revision: capture.snapshot.revision,
          supported: Boolean(binding),
          capability: binding?.capability ?? null,
          lots,
          runs,
          preparations,
          preparations_truncated: preparationsResult.length > 20,
          cursor: capture.snapshot.cursor,
        }
        validate('ManualWorkspace', result)
        if (Buffer.byteLength(canonicalRecord(result)) > 245760) {
          fail('manual_workspace_capacity', 409)
        }
        return result
      })
    },
  }
}

/** Latest original round for an already scoped batch; retained outcome, never replay authority. */
export async function latestInboxRound(client: PoolClient, config: ManualConfig, batchId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: manualRuns.id })
      .from(manualRuns)
      .innerJoin(manualApprovals, eq(manualApprovals.id, manualRuns.approvalId))
      .where(and(eq(manualRuns.batchId, batchId), eq(manualApprovals.actorId, config.actorId)))
      .orderBy(desc(manualApprovals.roundNumber))
      .limit(1),
  )
  if (!rows[0]) {
    return null
  }
  const run = await manualRunSnapshot(client, config, rows[0].id)
  return {
    run_id: run.run_id,
    round_number: run.round_number,
    state: run.state,
    confirmed_stock: run.confirmed_stock_ids.length,
  }
}
