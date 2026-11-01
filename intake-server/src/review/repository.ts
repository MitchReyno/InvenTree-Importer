import type { Pool } from 'pg'
import { validate, type ManualPreviewDto, type ManualWorkspaceDto } from '@invimport/contracts'
import { transaction } from '../db/database.ts'
import { captureInTransaction, fail } from '../capture/repository.ts'
import { canonical } from '@invimport/contracts/json'
import { stockSourceHistory } from '../execution/source.ts'
import type { CaptureRead } from '../capture/routes.ts'
import { deploymentBinding, currentReviews, type ManualConfig } from './authority.ts'
import { issue } from './model.ts'
import { materializeWithMedia } from './media-material.ts'
import { manualRunSnapshot, retainedPreparation } from './runs.ts'
import { markReviewed, prepareSelection, approvePreparation } from './preparations.ts'
import { runCommand } from './commands.ts'

export function manualRepository(pool: Pool, config: ManualConfig, read?: CaptureRead) {
  return {
    async activity() {
      return transaction(pool, async (client) => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        const rows = await client.query(
          `SELECT r.id FROM manual_run r JOIN manual_approval a ON a.id=r.approval_id
           JOIN manual_preparation p ON p.id=a.preparation_id
           JOIN manual_prepare_command c ON c.id=p.prepare_command_id
           WHERE a.actor_id=$1 AND c.target_id=$2 AND c.context_id=$3 ORDER BY r.id LIMIT 101`,
          [config.actorId, config.targetId, config.targetContextId],
        )
        const runs = []
        for (const row of rows.rows.slice(0, 100)) {
          const run = await manualRunSnapshot(client, config, row.id)
          if (run.state !== 'settled_complete') {
            runs.push({ batch_id: run.batch_id, run_id: run.run_id, state: run.state })
          }
        }
        return { runs, truncated: rows.rows.length > 100 }
      })
    },
    review: (batchId: string, key: string, input: Parameters<typeof markReviewed>[4]) =>
      markReviewed(pool, config, batchId, key, input),
    prepare: (batchId: string, key: string, input: Parameters<typeof prepareSelection>[5]) =>
      prepareSelection(pool, config, read, batchId, key, input),
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
        const runsResult = await client.query(
          'SELECT r.id FROM manual_run r JOIN manual_approval a ON a.id=r.approval_id WHERE r.batch_id=$1 ORDER BY a.round_number',
          [batchId],
        )
        const runs: ManualWorkspaceDto['runs'] = []
        for (const row of runsResult.rows) {
          runs.push(await manualRunSnapshot(client, config, row.id))
        }
        const preparationsResult = await client.query(
          `SELECT p.id FROM manual_preparation p LEFT JOIN manual_approval a ON a.preparation_id=p.id
           WHERE p.batch_id=$1 AND p.actor_id=$2 AND a.id IS NULL ORDER BY p.created_at DESC,p.id DESC LIMIT 21`,
          [batchId, config.actorId],
        )
        const preparations: ManualPreviewDto[] = []
        for (const row of preparationsResult.rows.slice(0, 20)) {
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
          preparations_truncated: preparationsResult.rows.length > 20,
          cursor: capture.snapshot.cursor,
        }
        validate('ManualWorkspace', result)
        if (Buffer.byteLength(canonical(result)) > 245760) {
          fail('manual_workspace_capacity', 409)
        }
        return result
      })
    },
  }
}
