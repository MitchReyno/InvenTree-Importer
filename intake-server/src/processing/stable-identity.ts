import type { PoolClient } from 'pg'
import { and, eq, inArray } from 'drizzle-orm'
import type { CaptureSnapshotDto, ProcessingProposalV5Dto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { captureLots } from '../capture/schema.ts'
import { appendSessionInbox } from '../agents/tools/inbox.ts'
import { prepareMediaTransaction } from '../media/transaction.ts'
import type { ProcessingConfig } from './attempts.ts'
import { checkJobCapacity, queueJob } from './jobs.ts'
import { reserveProcessingMedia, reservedMediaFor } from './media.ts'
import { processingAttempts, processingJobs, processingProposalStale } from './schema.ts'

/** The per-lot sessions a stable identity starts, in parallel. Inventory waits for both. */
export const SUCCESSOR_STAGES = ['research', 'images'] as const

/** Attempt states a revised identity reaches as an inbox item instead of a new attempt. */
const LIVE_STATES = [
  'queued',
  'running',
  'waiting_for_user',
  'waiting_for_login',
  'waiting_for_capacity',
  'interrupted',
] as const

/** The observation set version an identity proposal relies on for its own lot, if any. */
export function reliedObservationSet(proposal: ProcessingProposalV5Dto): string | null {
  if (!proposal.relies_on.fields.includes('identity')) {
    return null
  }
  for (const source of proposal.relies_on.sources) {
    if (source.kind === 'observation_set' && source.lot_id === proposal.subject_id) {
      return source.version
    }
  }
  return null
}

export { lotRegrouped } from './regroup.ts'

async function markStale(
  client: PoolClient,
  proposalIds: readonly string[],
  reason: 'lot_regrouped',
) {
  if (!proposalIds.length) {
    return
  }
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(processingProposalStale)
      .values(proposalIds.map((proposalId) => ({ proposalId, reason })))
      .onConflictDoNothing(),
  )
}

/**
 * The Examine lead session published an identity for a lot. Caller holds the capture lock and the
 * lot's subject head. When the identity relies on the lot's current observation set it is stable:
 * Research and Images are queued in this transaction, pinned to it, or told about the revision if
 * they are already live. An identity relying on an older set is stale at once.
 */
export async function onLeadIdentity(
  client: PoolClient,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  proposal: ProcessingProposalV5Dto,
  proposalId: string,
): Promise<'queued' | 'revised' | 'not_stable' | null> {
  const version = reliedObservationSet(proposal)
  if (version === null) {
    return null
  }
  const lotId = proposal.subject_id
  const lots = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ version: captureLots.observationSetVersion })
      .from(captureLots)
      .where(eq(captureLots.id, lotId))
      .for('update'),
  )
  if (!lots[0] || lots[0].version.toString() !== version) {
    await markStale(client, [proposalId], 'lot_regrouped')
    return 'not_stable'
  }
  // Media before job locks, as every queueing path does.
  await prepareMediaTransaction(client)
  const media = reservedMediaFor(
    await reserveProcessingMedia(client, config, snapshot, [lotId]),
    lotId,
  )
  const toQueue: (typeof SUCCESSOR_STAGES)[number][] = []
  for (const stage of SUCCESSOR_STAGES) {
    const jobs = await executeDatabaseQuery(
      queryDatabase(client)
        .select({ id: processingJobs.id, attemptState: processingAttempts.state })
        .from(processingJobs)
        .innerJoin(processingAttempts, eq(processingAttempts.id, processingJobs.currentAttemptId))
        .where(
          and(
            eq(processingJobs.batchId, snapshot.id),
            eq(processingJobs.subjectId, lotId),
            eq(processingJobs.stage, stage),
          ),
        )
        .for('update', { of: processingJobs }),
    )
    const job = jobs[0]
    if (job && (LIVE_STATES as readonly string[]).includes(job.attemptState)) {
      await appendSessionInbox(
        client,
        {
          binding: config,
          batchId: snapshot.id,
          lineageId: job.id,
          actorId: null,
          idempotencyKey: `identity:${proposalId}`,
          kind: 'revision',
          payload: {
            fields: ['identity'],
            reason: `The lot's identity was revised: ${proposal.summary}`.slice(0, 2048),
          },
        },
        { publish: false },
      )
    } else {
      toQueue.push(stage)
    }
  }
  if (!toQueue.length) {
    return 'revised'
  }
  await checkJobCapacity(client, snapshot.id, [lotId], [...toQueue])
  for (const stage of toQueue) {
    await queueJob(client, config, snapshot, lotId, stage, [], media, [proposalId])
  }
  return 'queued'
}

/** Claim-time check: every identity a successor was pinned to is still current. */
export async function pinnedIdentityCurrent(client: PoolClient, pinned: readonly string[]) {
  if (!pinned.length) {
    return true
  }
  const stale = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: processingProposalStale.proposalId })
      .from(processingProposalStale)
      .where(inArray(processingProposalStale.proposalId, [...pinned])),
  )
  return stale.length === 0
}

/** Inventory's gate: the lot's Research and Images each have a current (not stale) proposal. */
export async function successorsCurrent(client: PoolClient, batchId: string, lotId: string) {
  const rows = await client.query<{ stage: string }>(
    `SELECT DISTINCT j.stage FROM public.processing_job j
     JOIN public.processing_proposal p ON p.attempt_id=j.current_attempt_id
     WHERE j.batch_id=$1 AND j.subject_id=$2 AND j.stage IN ('research','images')
       AND NOT EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=p.id)`,
    [batchId, lotId],
  )
  return SUCCESSOR_STAGES.every((stage) => rows.rows.some((row) => row.stage === stage))
}
