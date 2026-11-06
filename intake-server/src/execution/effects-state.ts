import { and, asc, eq } from 'drizzle-orm'
import type { Pool, PoolClient } from 'pg'
import { partTransferKey } from './part-attachment-plan.ts'
import { verifyBytes } from '../db/authority.ts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import type { EffectsPlan } from './effects-plan.ts'
import {
  supportedAssessments,
  supportedEffects,
  supportedIntents,
  supportedResults,
} from './schema.ts'

export interface SupportedState {
  operationKey: string
  kind: string
  certainty: 'none' | 'unknown' | 'confirmed'
  remotePks: string[]
  createIntentId: string | null
  verification: 'matches' | 'missing_or_changed' | 'unavailable' | null
  /** The latest create got a validation error (400) and no record is attributed to it. */
  rejected: boolean
}

/** Verification never deletes attribution or makes a historical create repeatable. */
export async function supportedStates(
  client: Pool | PoolClient,
  runId: string,
  plan: EffectsPlan,
): Promise<SupportedState[]> {
  const db = queryDatabase(client)
  const attempts = await executeDatabaseQuery(
    db
      .select({
        id: supportedIntents.id,
        operationKey: supportedIntents.operationKey,
        certainty: supportedEffects.certainty,
        remotePks: supportedEffects.remotePks,
        outcome: supportedResults.outcome,
        status: supportedResults.status,
        responseBytes: supportedResults.responseBytes,
        responseDigest: supportedResults.responseDigest,
      })
      .from(supportedIntents)
      .leftJoin(supportedEffects, eq(supportedEffects.intentId, supportedIntents.id))
      .leftJoin(supportedResults, eq(supportedResults.intentId, supportedIntents.id))
      .where(and(eq(supportedIntents.runId, runId), eq(supportedIntents.kind, 'create')))
      .orderBy(asc(supportedIntents.createdAt), asc(supportedIntents.id)),
  )
  for (const row of attempts) {
    if (row.outcome === 'response') {
      if (!row.responseBytes || !row.responseDigest) {
        throw new Error('supported_result_authority_missing')
      }
      verifyBytes(row.responseBytes, row.responseDigest)
    }
  }
  const assessments = await executeDatabaseQuery(
    db
      .select()
      .from(supportedAssessments)
      .where(eq(supportedAssessments.runId, runId))
      .orderBy(asc(supportedAssessments.createdAt), asc(supportedAssessments.id)),
  )
  return [
    ...plan.effects.map((effect) => ({ operationKey: effect.operationKey, kind: effect.kind })),
    ...plan.operations.map((operation) => ({
      operationKey: operation.operationKey,
      kind: 'create_stock',
    })),
  ].map((operation) => {
    const rows = attempts.filter((row) => row.operationKey === operation.operationKey)
    const receipts = assessments.filter((row) => row.operationKey === operation.operationKey)
    const transfer =
      operation.kind === 'part_attachment'
        ? plan.partAttachments.find(
            (transfer) => partTransferKey(transfer) === operation.operationKey,
          )
        : undefined
    let expectedPart = transfer?.part ?? null
    if (transfer && expectedPart === null) {
      const creates = attempts.filter((row) => row.operationKey === transfer.partOperationKey)
      const known = creates.find(
        (row) =>
          row.certainty === 'confirmed' ||
          (row.remotePks?.length === 1 &&
            assessments.some(
              (receipt) =>
                receipt.createIntentId === row.id &&
                receipt.remotePk === row.remotePks?.[0] &&
                receipt.outcome === 'matches',
            )),
      )
      expectedPart = known?.remotePks?.length === 1 ? known.remotePks[0] : null
    }

    const positiveReceipt = (row: (typeof rows)[number]) =>
      row.remotePks?.length === 1 &&
      receipts.some((receipt) => {
        if (
          receipt.createIntentId !== row.id ||
          receipt.remotePk !== row.remotePks?.[0] ||
          receipt.outcome !== 'matches'
        ) {
          return false
        }
        if (!transfer) {
          return true
        }
        return (
          expectedPart !== null &&
          receipt.observedModelId === expectedPart &&
          receipt.metadataIntentId !== null &&
          receipt.verifiedDigest?.toString('hex') === transfer.version.blobDigest
        )
      })

    const unresolved = rows.some(
      (row) =>
        row.certainty !== 'none' &&
        !(row.certainty === 'confirmed' && !transfer) &&
        !positiveReceipt(row),
    )
    const confirmed = rows.find(
      (row) => (row.certainty === 'confirmed' && !transfer) || positiveReceipt(row),
    )
    const remotePks = [...new Set<string>(rows.flatMap((row) => row.remotePks ?? []))]
    const certainty = unresolved ? 'unknown' : confirmed ? 'confirmed' : 'none'
    const latest = rows.at(-1)
    const rejected =
      certainty !== 'confirmed' &&
      remotePks.length === 0 &&
      latest?.outcome === 'response' &&
      // Only a validation error refuses the value; 401, 403, 404 or 429 say nothing about it.
      latest.status === 400
    return {
      rejected,
      ...operation,
      certainty,
      remotePks,
      createIntentId: rows.find((row) => row.certainty !== 'none')?.id ?? null,
      verification: receipts.at(-1)?.outcome ?? null,
    }
  })
}
