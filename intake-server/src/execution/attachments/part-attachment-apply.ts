import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { inventoryTransport } from '#/inventory/transport.ts'
import type { ApplyDependencies } from '#/execution/apply.ts'
import type { SupportedState } from '#/execution/effects/effects-state.ts'
import type { SupportedCreateBody } from '#/execution/effects/effects-body.ts'
import type {
  SupportedJournalContext,
  SupportedRecovery,
} from '#/execution/effects/effects-journal.ts'
import { performSupportedRequest } from '#/execution/effects/effects-request.ts'
import type { EffectStep } from '#/execution/effects/effects-step.ts'
import { effectStepKind } from '#/execution/effects/effects-step.ts'
import { partTransferKey, type PartTransfer } from './part-attachment-plan.ts'
import {
  partAttachmentMetadata,
  partAttachmentMultipart,
  samePartAttachmentBytes,
  type PartAttachmentWire,
} from './part-attachment-wire.ts'
import { executorTransaction } from '#/execution/transaction.ts'
import { lockRun } from '#/execution/authority.ts'
import { sha256 } from '#/db/authority.ts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { supportedAssessments } from '#/execution/schema.ts'
import { responseObject, responsePk } from '#/execution/response.ts'
import { supportedStates } from '#/execution/effects/effects-state.ts'

export interface PartAttachmentRequest {
  (
    kind: 'read' | 'verify',
    specification: unknown,
    send: () => Promise<Response>,
    maxBytes?: number,
  ): Promise<{ status: number; bytes: Buffer; intentId: string } | null>
}
interface VerificationContext {
  transfer: PartTransfer
  partPk: string
  remotePk: string
  artifactKey: string
  request: PartAttachmentRequest
  metadata: (pk: string) => Promise<Response>
  file: (input: { pk: string; partPk: string; path: string }) => Promise<Response>
}

/** File reads derive solely from the exact known metadata receipt, never discovery by name. */
export async function verifyPartAttachment(context: VerificationContext) {
  const wire: PartAttachmentWire = {
    artifactKey: context.artifactKey,
    partPk: context.partPk,
    version: context.transfer.version,
  }
  const metadata = await context.request(
    'verify',
    { kind: 'get_part_attachment', pk: context.remotePk, partPk: context.partPk },
    () => context.metadata(context.remotePk),
  )
  if (!metadata) {
    return null
  }
  let parsed: ReturnType<typeof partAttachmentMetadata>
  try {
    if (metadata.status !== 200) {
      throw new Error('part_attachment_missing')
    }
    parsed = partAttachmentMetadata(metadata.bytes, context.remotePk, wire)
  } catch {
    return {
      outcome:
        metadata.status === 404 || metadata.status === 200
          ? ('missing_or_changed' as const)
          : ('unavailable' as const),
      resultIntentId: metadata.intentId,
      metadataIntentId: metadata.intentId,
      verifiedDigest: null,
    }
  }
  const file = await context.request(
    'verify',
    {
      kind: 'download_part_attachment',
      pk: context.remotePk,
      partPk: context.partPk,
      path: parsed.path,
      metadataIntentId: metadata.intentId,
      blobDigest: context.transfer.version.blobDigest,
    },
    () => context.file({ pk: context.remotePk, partPk: context.partPk, path: parsed.path }),
    20971520,
  )
  if (!file) {
    return null
  }
  const matches = file.status === 200 && samePartAttachmentBytes(file.bytes, wire)
  return {
    outcome: matches
      ? ('matches' as const)
      : file.status === 200 || file.status === 404
        ? ('missing_or_changed' as const)
        : ('unavailable' as const),
    resultIntentId: file.intentId,
    metadataIntentId: metadata.intentId,
    verifiedDigest: matches ? sha256(file.bytes) : null,
  }
}

export async function recordPartAttachmentAssessment(
  pool: Pool,
  runId: string,
  operationKey: string,
  createIntentId: string,
  remotePk: string,
  partPk: string,
  verification: NonNullable<Awaited<ReturnType<typeof verifyPartAttachment>>>,
) {
  await executorTransaction(pool, async (client) => {
    await lockRun(client, runId)
    await executeDatabaseQuery(
      queryDatabase(client).insert(supportedAssessments).values({
        id: randomUUID(),
        intentId: verification.resultIntentId,
        createIntentId,
        runId,
        operationKey,
        outcome: verification.outcome,
        remotePk,
        metadataIntentId: verification.metadataIntentId,
        verifiedDigest: verification.verifiedDigest,
        observedModelId: partPk,
      }),
    )
  })
}

type Transport = ReturnType<typeof inventoryTransport>

/** File confirmation is required even after a successful metadata POST; it never retries the upload. */
export async function applyPartAttachmentEffect(
  deps: ApplyDependencies,
  context: SupportedJournalContext,
  transport: Transport,
  step: EffectStep,
  body: SupportedCreateBody,
  recovery: SupportedRecovery | undefined,
  current: SupportedState,
  states: SupportedState[],
): Promise<'continue' | 'stop'> {
  const transfer = context.plan.partAttachments.find(
    (item) => partTransferKey(item) === step.operationKey,
  )!
  const partPk = body.model_id as string

  const verify = async () => {
    const state = (await supportedStates(context.pool, context.runId, context.plan)).find(
      (item) => item.operationKey === step.operationKey,
    )!
    if (state.remotePks.length !== 1 || !state.createIntentId) {
      return
    }
    const verification = await verifyPartAttachment({
      transfer,
      partPk,
      remotePk: state.remotePks[0],
      artifactKey: transfer.artifactKey,
      request: (requestKind, spec, send, max) =>
        performSupportedRequest(deps, context, step, requestKind, spec, send, recovery, max),
      metadata: (pk) => transport.readPartAttachmentMetadata(context.plan, pk),
      file: (input) => transport.readPartAttachmentFile(context.plan, input),
    })
    if (verification) {
      await recordPartAttachmentAssessment(
        deps.pool,
        context.runId,
        step.operationKey,
        state.createIntentId,
        state.remotePks[0],
        partPk,
        verification,
      )
    }
  }

  if (recovery?.kind === 'verify_effect') {
    await verify()
    return 'continue'
  }
  if (current.certainty === 'confirmed') {
    return 'continue'
  }
  if (current.certainty === 'unknown' || states.some((state) => state.certainty === 'unknown')) {
    return 'stop'
  }
  const destination = await performSupportedRequest(
    deps,
    context,
    step,
    'read',
    { kind: 'get_part', pk: partPk },
    () => transport.read(context.plan, { kind: 'get_part', pk: partPk }),
    recovery,
  )
  try {
    if (
      !destination ||
      destination.status !== 200 ||
      responsePk(responseObject(destination.bytes).pk) !== partPk
    ) {
      return 'stop'
    }
  } catch {
    return 'stop'
  }
  if (!deps.mediaStore) {
    throw new Error('media_storage_unavailable')
  }
  const bytes = await deps.mediaStore.read(transfer.version.blobDigest)
  const multipart = partAttachmentMultipart(
    { artifactKey: transfer.artifactKey, partPk, version: transfer.version },
    bytes,
  )
  await performSupportedRequest(
    deps,
    context,
    step,
    'create',
    {
      kind: effectStepKind(step),
      partPk,
      artifactKey: transfer.artifactKey,
      versionId: transfer.version.versionId,
      blobDigest: transfer.version.blobDigest,
      multipartDigest: multipart.digest,
      contentType: multipart.contentType,
      body: {},
    },
    () => transport.sendPartAttachment(context.plan, multipart.body, multipart.contentType),
    recovery,
  )
  await verify()
  return 'continue'
}
