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

/** Part and new-location outputs resolve only from a usable confirmed single-PK create. */
export async function resolvedStockOperation(
  client: Pool | PoolClient,
  runId: string,
  plan: ExecutablePlan,
  operation: StockOperation | EffectsStockOperation,
): Promise<StockOperation> {
  const locationKey = 'locationOperationKey' in operation ? operation.locationOperationKey : null
  if (operation.part !== null && !locationKey) {
    const { locationOperationKey: _key, ...fields } = operation as EffectsStockOperation
    return { ...fields, part: operation.part } as StockOperation
  }
  if (!isEffectsPlan(plan)) {
    throw new Error('part_output_unavailable')
  }
  const states = await supportedStates(client, runId, plan)

  const output = (key: string | null, usable: boolean) => {
    const state = states.find((item) => item.operationKey === key)
    const inspectedBad =
      usable &&
      (state?.verification === 'missing_or_changed' || state?.verification === 'unavailable')
    return state?.certainty === 'confirmed' && !inspectedBad && state.remotePks.length === 1
      ? state.remotePks[0]
      : null
  }

  const part =
    operation.part ??
    ('partOperationKey' in operation ? output(operation.partOperationKey, false) : null)
  if (!part) {
    throw new Error('part_output_unavailable')
  }
  const location = locationKey ? output(locationKey, true) : operation.location
  if (locationKey && !location) {
    throw new Error('location_output_unavailable')
  }
  const { locationOperationKey: _key, ...fields } = operation as EffectsStockOperation
  return { ...fields, part, location } as StockOperation
}
