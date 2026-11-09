import type { AttachmentWire, inventoryTransport } from '../../inventory/transport.ts'
import type { ApplyDependencies } from '../apply.ts'
import { resolvedStockOperation } from '../effects/effects-output.ts'
import { loadRun, snapshot } from '../authority.ts'
import { attachmentOperations } from '../media-plan.ts'
import {
  authorizeAttachmentRequest,
  checkpointAttachment,
  recordAttachmentVerification,
  type AttachmentJournalContext,
  type AttachmentRequestKind,
} from './attachment-journal.ts'
import { attachmentReceipt, receiptMatches } from './attachment-response.ts'
import {
  ATTACHMENT_RESPONSE_BYTES,
  ATTACHMENT_HEADER_BYTES,
  verifiedAttachmentFrame,
} from './attachment-frame.ts'
import { inventoryBody, responseObject, responsePk, stockMatches } from '../response.ts'
import type { AttachmentRecovery } from './attachment-recovery.ts'
import { sha256 } from '../../db/authority.ts'

interface ReceivedAttachmentResponse {
  intentId: string
  status: number
  bytes: Buffer
}

type Transport = ReturnType<typeof inventoryTransport>

/** Every target read or write has one committed intent under the original run. */
async function performRequest(
  deps: ApplyDependencies,
  context: AttachmentJournalContext,
  kind: AttachmentRequestKind,
  request: unknown,
  send: () => Promise<Response>,
  expected?: AttachmentWire,
): Promise<ReceivedAttachmentResponse | null> {
  await deps.checkpoint?.('before_authorize', kind)
  const intent = await authorizeAttachmentRequest(context, kind, request)
  if (!intent) {
    return null
  }
  await deps.checkpoint?.('intent_committed', kind, intent.id)
  try {
    await context.health()
  } catch {
    await checkpointAttachment(context, intent.id, kind, {
      outcome: 'proven_not_sent',
      status: null,
      bytes: null,
      certainty: 'none',
      remotePk: null,
    })
    return null
  }
  if (kind === 'create_attachment') {
    const authority = await loadRun(context.pool, context.runId)
    await deps.gate.witness(
      intent.id,
      Buffer.from(authority.planDigest, 'hex'),
      sha256(intent.bytes),
      authority.plan.deploymentId,
    )
    await context.health()
  }
  let received: ReceivedAttachmentResponse
  try {
    const response = await send()
    received = {
      intentId: intent.id,
      status: response.status,
      bytes: await inventoryBody(
        response,
        kind === 'download_attachment' ? ATTACHMENT_RESPONSE_BYTES : ATTACHMENT_HEADER_BYTES,
      ),
    }
  } catch {
    await checkpointAttachment(context, intent.id, kind, {
      outcome: 'transport_loss',
      status: null,
      bytes: null,
      certainty: kind === 'create_attachment' ? 'unknown' : 'none',
      remotePk: null,
    })
    await deps.checkpoint?.('result_committed', kind, intent.id)
    return null
  }
  let remotePk: string | null = null
  let certainty: 'unknown' | 'none' = kind === 'create_attachment' ? 'unknown' : 'none'
  if (kind === 'create_attachment') {
    try {
      const receipt = attachmentReceipt(received.bytes)
      if ('pk' in receipt) {
        remotePk = receipt.pk
      } else if (receipt.effect === 'none' && expected && receiptMatches(receipt, expected)) {
        certainty = 'none'
      }
    } catch {
      // An incomplete acknowledgment cannot establish either successful creation or no effect.
    }
  }
  await checkpointAttachment(context, intent.id, kind, {
    outcome: 'response',
    status: received.status,
    bytes: received.bytes,
    certainty,
    remotePk,
  })
  await deps.checkpoint?.('result_committed', kind, intent.id)
  return received
}

/** A positive receipt requires the destination and the downloaded bytes together. */
async function verifyAttachment(
  deps: ApplyDependencies,
  context: AttachmentJournalContext,
  transport: Transport,
  wire: AttachmentWire,
  createIntentId: string,
  knownPk: string | null,
) {
  const authority = await loadRun(context.pool, context.runId)
  let remotePk = knownPk
  if (!remotePk) {
    const lookup = await performRequest(
      deps,
      context,
      'lookup_attachment',
      { kind: 'lookup_attachment', artifactKey: wire.artifactKey },
      () =>
        transport.readAttachment(authority.plan, {
          kind: 'lookup_attachment',
          artifactKey: wire.artifactKey,
        }),
    )
    if (!lookup) {
      return
    }
    try {
      const receipt = attachmentReceipt(lookup.bytes)
      if (lookup.status !== 200 || !('pk' in receipt) || !receiptMatches(receipt, wire)) {
        throw new Error('attachment_lookup_not_attributed')
      }
      remotePk = receipt.pk
    } catch {
      await recordAttachmentVerification(
        context,
        lookup.intentId,
        createIntentId,
        lookup.status === 404 ? 'missing_or_changed' : 'unavailable',
        null,
        null,
        null,
      )
      return
    }
  }
  const pk = remotePk
  const downloaded = await performRequest(
    deps,
    context,
    'download_attachment',
    { kind: 'download_attachment', pk },
    () => transport.readAttachment(authority.plan, { kind: 'download_attachment', pk }),
  )
  if (!downloaded) {
    return
  }
  let verified: ReturnType<typeof verifiedAttachmentFrame> | null = null
  if (downloaded.status === 200) {
    try {
      verified = verifiedAttachmentFrame(downloaded.bytes, wire, pk)
    } catch {
      // The returned file cannot establish exact domain and content identity.
    }
  }
  if (verified) {
    await recordAttachmentVerification(
      context,
      downloaded.intentId,
      createIntentId,
      'matches',
      pk,
      wire,
      verified.digest,
    )
  } else {
    await recordAttachmentVerification(
      context,
      downloaded.intentId,
      createIntentId,
      downloaded.status === 404 || downloaded.status === 200 ? 'missing_or_changed' : 'unavailable',
      pk,
      null,
      null,
    )
  }
}

/** Attachment recovery never enters the stock-create loop or consults current media selection. */
export async function applyAttachments(
  deps: ApplyDependencies,
  runId: string,
  transport: Transport,
  recoveries: readonly AttachmentRecovery[],
  selectedRecovery: boolean,
  health: () => Promise<void>,
) {
  const authority = await loadRun(deps.pool, runId)
  for (const operation of attachmentOperations(authority.plan)) {
    const recovery = recoveries.find((row) => row.artifact_key === operation.artifactKey)
    if (selectedRecovery && !recovery) {
      continue
    }
    const state = await snapshot(deps.pool, runId)
    const child = state.attachments.find((row) => row.artifactKey === operation.artifactKey)!
    const stock = state.operations.find((row) => row.operationKey === operation.stockOperationKey)
    if (stock?.certainty !== 'confirmed' || !stock.remotePk) {
      continue
    }
    if (!recovery && child.certainty !== 'none') {
      continue
    }
    const context: AttachmentJournalContext = {
      pool: deps.pool,
      runId,
      operation,
      recoveryId: recovery?.id ?? null,
      health,
    }
    const wire: AttachmentWire = {
      artifactKey: operation.artifactKey,
      stockPk: stock.remotePk,
      digest: operation.blobDigest,
      byteSize: operation.byteSize,
      mediaType: operation.mediaType,
    }
    if (recovery?.kind === 'verify_attachment') {
      if (!recovery.create_intent_id) {
        throw new Error('attachment_create_authority_missing')
      }
      await verifyAttachment(
        deps,
        context,
        transport,
        wire,
        recovery.create_intent_id,
        child.remotePk,
      )
      continue
    }
    if (!deps.mediaStore) {
      throw new Error('media_storage_unavailable')
    }
    const stockOperation = authority.plan.operations.find(
      (row) => row.operationKey === operation.stockOperationKey,
    )!
    const destination = await performRequest(
      deps,
      context,
      'get_stock',
      { kind: 'get_stock', pk: stock.remotePk },
      () => transport.read(authority.plan, { kind: 'get_stock', pk: stock.remotePk! }),
    )
    if (!destination || destination.status !== 200) {
      continue
    }
    try {
      const value = responseObject(destination.bytes)
      if (
        responsePk(value.pk) !== stock.remotePk ||
        !stockMatches(
          value,
          await resolvedStockOperation(deps.pool, runId, authority.plan, stockOperation),
        )
      ) {
        continue
      }
    } catch {
      continue
    }
    const bytes = await deps.mediaStore.read(operation.blobDigest)
    const created = await performRequest(
      deps,
      context,
      'create_attachment',
      wire,
      () => transport.sendAttachment(authority.plan, wire, bytes),
      wire,
    )
    if (!created) {
      continue
    }
    const updated = await snapshot(deps.pool, runId)
    const retained = updated.attachments.find((row) => row.artifactKey === operation.artifactKey)!
    if (retained.certainty === 'unknown') {
      await verifyAttachment(deps, context, transport, wire, created.intentId, retained.remotePk)
    }
  }
}
