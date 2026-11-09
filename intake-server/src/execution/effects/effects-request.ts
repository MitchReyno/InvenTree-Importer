import { sha256 } from '../../db/authority.ts'
import { inventoryBody } from '../response.ts'
import type { ApplyDependencies } from '../apply.ts'
import { supportedResponseEvidence } from './effects-evidence.ts'
import {
  authorizeSupportedRequest,
  checkpointSupportedRequest,
  type SupportedJournalContext,
  type SupportedRecovery,
  type SupportedRequestKind,
} from './effects-journal.ts'
import type { EffectStep } from './effects-step.ts'

export interface SupportedRequest {
  status: number
  bytes: Buffer
  intentId: string
}

/** One committed intent, at most one physical send, then a result checkpoint. */
export async function performSupportedRequest(
  deps: ApplyDependencies,
  context: SupportedJournalContext,
  step: EffectStep,
  kind: SupportedRequestKind,
  specification: unknown,
  send: () => Promise<Response>,
  recovery: SupportedRecovery | undefined,
  maxBytes = 65536,
): Promise<SupportedRequest | null> {
  await deps.checkpoint?.('before_authorize', kind)
  await context.health()
  const accepted = await authorizeSupportedRequest(context, step, kind, specification, recovery)
  if (!accepted) {
    return null
  }
  const intent = accepted
  await deps.checkpoint?.('intent_committed', kind, intent.intentId)
  let received: { status: number; bytes: Buffer } | null = null
  let outcome: 'response' | 'transport_loss' | 'proven_not_sent' = 'proven_not_sent'
  try {
    await context.health()
  } catch {
    await retain(outcome, received)
    return null
  }
  if (kind === 'create') {
    await deps.gate.witness(
      intent.intentId,
      Buffer.from(intent.planDigest, 'hex'),
      sha256(intent.bytes),
      context.plan.deploymentId,
    )
    await context.health()
  }
  try {
    const response = await send()
    received = { status: response.status, bytes: await inventoryBody(response, maxBytes) }
    outcome = 'response'
  } catch {
    outcome = 'transport_loss'
  }
  await retain(outcome, received)
  return received ? { ...received, intentId: intent.intentId } : null

  async function retain(recorded: typeof outcome, body: { status: number; bytes: Buffer } | null) {
    let evidence = { pks: [] as string[], confirmed: false }
    if (kind === 'create' && body) {
      try {
        const spec = specification as { body: Record<string, string | string[] | null | boolean> }
        evidence = supportedResponseEvidence(body.status, body.bytes, spec.body)
        evidence = {
          pks: evidence.pks,
          confirmed: evidence.confirmed && !('kind' in step && step.kind === 'part_attachment'),
        }
      } catch {
        /* Retain uncertainty when complete output validation fails. */
      }
    }
    await checkpointSupportedRequest(context, step, kind, intent.intentId, recorded, body, evidence)
    await deps.checkpoint?.('result_committed', kind, intent.intentId)
  }
}
