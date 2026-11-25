import type { PoolClient } from 'pg'
import { and, eq, inArray } from 'drizzle-orm'
import type { CaptureSnapshotDto, RetainedSessionProposalDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { captureLots } from '#/capture/schema.ts'
import { agentSessions } from '#/agents/schema.ts'
import { notifyRevision } from './currentness.ts'
import { prepareMediaTransaction } from '#/media/transaction.ts'
import type { ProcessingConfig } from './attempts.ts'
import { checkJobCapacity, queueJob } from './jobs.ts'
import { reserveProcessingMedia, reservedMediaFor } from './media.ts'
import { processingAttempts, processingJobs, processingProposalStale } from './schema.ts'
import { SUCCESSOR_STAGES } from './supersede.ts'
import { isSessionProfile } from './session-policy.ts'
import { batchInputVersion, configuredInputVersion } from './stage-policy.ts'
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
export function reliedObservationSet(proposal: RetainedSessionProposalDto): string | null {
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
  proposal: RetainedSessionProposalDto,
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
      await notifyRevision(
        client,
        job.id,
        `identity:${proposalId}`,
        {
          fields: ['identity'],
          reason: `The lot's identity was revised: ${proposal.summary}`,
          changes: [
            {
              kind: 'proposal',
              proposal_id: proposalId,
              proposal_kind: proposal.schema_version,
              state: 'published',
            },
          ],
        },
        {
          origin: { by: 'session', attemptId: await proposalAttempt(client, proposalId) },
          briefRevision: snapshot.revision,
        },
      )
    } else {
      toQueue.push(stage)
    }
  }
  if (!toQueue.length) {
    return 'revised'
  }
  // Successors follow the lead's sealed version, so a retained `/6` lead never queues `/7` ones.
  // A `/7` lead under a configuration that doesn't seal `/7` can't queue its successors; the
  // identity stands, as it does with no provider on. Checked before any settings read.
  const inputVersion = await batchInputVersion(client, config, snapshot.id)
  if (
    inputVersion === 'bench-intake-input/7' &&
    configuredInputVersion(config) !== 'bench-intake-input/7'
  ) {
    return 'waiting'
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
      inputVersion,
    })
  }
  return 'queued'
}

/** The attempt that published a proposal. */
async function proposalAttempt(client: PoolClient, proposalId: string) {
  const rows = await client.query<{ attempt_id: string }>(
    'SELECT attempt_id FROM public.processing_proposal WHERE id=$1',
    [proposalId],
  )
  return rows.rows[0].attempt_id
}

/** The agent settings successors seal; none for profiles that need no provider. */
async function settingsForSuccessors(client: PoolClient, config: ProcessingConfig) {
  const profile = config.profileId
  if (!profile || !isSessionProfile(profile) || profile === 'synthetic-session/1') {
    return undefined
  }
  return readAgentSettings(client, config)
}

/**
 * The lot's stable identity: the lead's latest identity proposal about the lot relying on its
 * current observation set (`reliedObservationSet`'s rule) that hasn't gone stale. None for a lot
 * Examine hasn't identified.
 */
export async function stableIdentityOf(client: PoolClient, batchId: string, lotId: string) {
  const rows = await client.query<{ id: string }>(
    `SELECT p.id FROM public.processing_proposal p
     JOIN public.processing_attempt a ON a.id=p.attempt_id
     JOIN public.processing_job j ON j.id=a.job_id AND j.stage='examine' AND j.batch_id=$1
     JOIN public.processing_message m ON m.id=p.message_id
     JOIN public.capture_lot l ON l.id=$2
     WHERE p.relies_on->'fields' ? 'identity'
       AND convert_from(p.value_bytes,'UTF8')::jsonb->>'subject_id'=$2::text
       AND p.relies_on->'sources' @> jsonb_build_array(jsonb_build_object(
         'kind','observation_set','lot_id',$2::text,'version',l.observation_set_version::text))
       AND NOT EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=p.id)
     ORDER BY a.number DESC, m.sequence DESC
     LIMIT 1`,
    [batchId, lotId],
  )
  return rows.rows.map((row) => row.id)
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
