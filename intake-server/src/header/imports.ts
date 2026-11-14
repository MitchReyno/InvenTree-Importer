import { and, desc, eq, sql } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import type { HeaderWorkDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import type { ManualConfig } from '#/review/authority.ts'
import {
  manualApprovals,
  manualPreparations,
  manualPrepareCommands,
  manualRuns,
} from '#/review/schema.ts'
import { manualRunSnapshot } from '#/review/runs.ts'

export async function importHeaderWork(client: PoolClient, config: ManualConfig, batchId?: string) {
  const work: HeaderWorkDto['work'] = []
  const runs = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: manualRuns.id, batchId: manualRuns.batchId })
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
      .orderBy(
        desc(sql`CASE WHEN ${manualRuns.batchId} = ${batchId ?? null} THEN 1 ELSE 0 END`),
        manualRuns.id,
      )
      .limit(101),
  )
  for (const row of runs.slice(0, 100)) {
    const run = await manualRunSnapshot(client, config, row.id)
    if (run.state === 'settled_complete' && row.batchId !== batchId) {
      continue
    }
    work.push({
      kind: 'import',
      id: run.run_id,
      batch_id: run.batch_id,
      stage: 'inventory',
      state: run.state,
      steps: [
        { name: 'approval', state: 'confirmed' },
        { name: 'dispatch', state: run.dispatch_state },
        { name: 'inventory', state: run.effect_certainty },
      ],
      steps_complete: false,
    })
  }
  return { work, truncated: runs.length > 100 }
}
