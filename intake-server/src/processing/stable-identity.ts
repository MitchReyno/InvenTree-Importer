import type { PoolClient } from 'pg'
import { and, eq, inArray } from 'drizzle-orm'
import type { CaptureSnapshotDto, SessionProposalDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { captureLots } from '#/capture/schema.ts'
import { agentSessions } from '#/agents/schema.ts'
import { appendSessionInbox } from '#/agents/tools/inbox.ts'
import { prepareMediaTransaction } from '#/media/transaction.ts'
import type { ProcessingConfig } from './attempts.ts'
import { checkJobCapacity, queueJob } from './jobs.ts'
import { reserveProcessingMedia, reservedMediaFor } from './media.ts'
import { processingAttempts, processingJobs, processingProposalStale } from './schema.ts'
import { SUCCESSOR_STAGES } from './supersede.ts'
import { isSessionProfile } from './session-policy.ts'
import { readAgentSettings } from '#/agents/settings.ts'
import { resolveSelection } from '#/agents/resolve-selection.ts'

export { SUCCESSOR_STAGES } from './supersede.ts'

/**
 * Attempt states that end a successor. A stable identity queues a fresh attempt for an ended or
 * missing successor, and replaces one that is queued but has never run; any other successor,
 * running or finished, gets the revision as an inbox item and is resumed.
 */
const ENDED_STATES = ['superseded', 'cancelled', 'failed'] as const

/** The observation set version an identity proposal relies on for its own lot, if any. */
export function reliedObservationSet(proposal: SessionProposalDto): string | null {
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
 * Research and Images are queued in this transaction, pinned to it; a successor that is queued but
 * has never run is replaced, and one that has run is told about the revision instead. An identity
 * relying on an older set is stale at once.
 */
export async function onLeadIdentity(
  client: PoolClient,
  config: ProcessingConfig,
  snapshot: CaptureSnapshotDto,
  proposal: SessionProposalDto,
  proposalId: string,
): Promise<'queued' | 'revised' | 'waiting' | 'not_stable' | null> {
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
        .select({
          id: processingJobs.id,
          attemptState: processingAttempts.state,
          turnCount: agentSessions.turnCount,
        })
        .from(processingJobs)
        .innerJoin(processingAttempts, eq(processingAttempts.id, processingJobs.currentAttemptId))
        .leftJoin(agentSessions, eq(agentSessions.attemptId, processingAttempts.id))
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
    // A successor that has not started yet is replaced, pinned to this identity; one that has
    // run gets the revision as a notice instead.
    const unstarted = job?.attemptState === 'queued' && (job.turnCount ?? 0n) === 0n
    if (job && !unstarted && !(ENDED_STATES as readonly string[]).includes(job.attemptState)) {
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
  // One read decides what to queue and is sealed into every successor, so a save landing
  // meanwhile can neither roll back this proposal nor split the successors across revisions.
  const settings = await settingsForSuccessors(client, config)
  const queueable = settings
    ? toQueue.filter((stage) => resolveSelection(settings, stage))
    : [...toQueue]
  if (!queueable.length) {
    // With no provider on, the identity proposal still stands; its successors aren't queued.
    return 'waiting'
  }
  await checkJobCapacity(client, snapshot.id, [lotId], [...queueable])
  for (const stage of queueable) {
    await queueJob(client, config, snapshot, lotId, stage, [], media, [proposalId], {
      lockSettings: false,
      settings,
    })
  }
  return 'queued'
}

/** The agent settings successors seal; none for profiles that need no provider. */
async function settingsForSuccessors(client: PoolClient, config: ProcessingConfig) {
  const profile = config.profileId
  if (!profile || !isSessionProfile(profile) || profile === 'synthetic-session/1') {
    return undefined
  }
  return readAgentSettings(client, config)
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
