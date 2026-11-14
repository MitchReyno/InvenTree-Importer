import type { SupportedMutationKind } from '#/inventory/transport.ts'
import type { EffectOperation, EffectsStockOperation } from './effects-plan.ts'

export type EffectStep = EffectOperation | EffectsStockOperation

export function effectStepKey(step: EffectStep) {
  return step.operationKey
}

export function effectStepKind(step: EffectStep): SupportedMutationKind {
  if (!('kind' in step)) {
    return 'create_stock'
  }
  return step.kind
}
