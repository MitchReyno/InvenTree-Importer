import { isEffectsPlan } from './effects-plan.ts'
import type { Pool, PoolClient } from 'pg'
import type { ExecutablePlan } from './media-plan.ts'
import type { StockOperation } from './plan.ts'
import type { EffectsStockOperation } from './effects-plan.ts'
import { supportedStates } from './effects-state.ts'

export function stockIndexBytes(
  operation: StockOperation | EffectsStockOperation,
  encode: (operation: StockOperation) => Buffer,
  canonical: (value: unknown) => string,
) {
  if ('partOperationKey' in operation) {
    return Buffer.from(canonical(operation))
  }
  return encode(operation)
}

export async function resolvedStockOperation(
  client: Pool | PoolClient,
  runId: string,
  plan: ExecutablePlan,
  operation: StockOperation | EffectsStockOperation,
): Promise<StockOperation> {
  if (operation.part !== null) {
    return { ...operation, part: operation.part }
  }
  if (!isEffectsPlan(plan) || !('partOperationKey' in operation)) {
    throw new Error('part_output_unavailable')
  }
  const state = (await supportedStates(client, runId, plan)).find(
    (item) => item.operationKey === operation.partOperationKey,
  )
  if (state?.certainty !== 'confirmed' || state.remotePks.length !== 1) {
    throw new Error('part_output_unavailable')
  }
  return { ...operation, part: state.remotePks[0] }
}
