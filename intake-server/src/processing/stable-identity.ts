import type { PoolClient } from 'pg'
import { and, eq, inArray, notExists } from 'drizzle-orm'
import type {
  CaptureSnapshotDto,
  RetainedSessionProposalDto,
  RevisionChangeDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '#/db/database.ts'
import { captureLots } from '#/capture/schema.ts'
import { agentSessions } from '#/agents/schema.ts'
import { cascadeAll, notifyRevision, staleChanges, type RevisionContext } from './currentness.ts'
import { brokenIdentities, recordIdentityBasis } from './identity-basis.ts'
import { prepareMediaTransaction } from '#/media/transaction.ts'
import type { ProcessingConfig } from './attempts.ts'
import { checkJobCapacity, queueJob } from './jobs.ts'
import { reserveProcessingMedia, reservedMediaFor } from './media.ts'
import {
  processingAttempts,
  processingJobs,
  processingProposals,
  processingProposalStale,
} from './schema.ts'
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
  reason: 'lot_regrouped' | 'source_superseded',
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
  // Successors follow the lead's sealed version, so a retained `/6` lead never queues `/7` ones.
  const inputVersion = await batchInputVersion(client, config, snapshot.id)
  const stageInput = inputVersion === 'bench-intake-input/7'
  // The lot as this identity sees it, for the claim and Review gate.
  if (stageInput) {
    await recordIdentityBasis(client, snapshot.id, lotId, proposalId)
  }
  const toQueue: (typeof SUCCESSOR_STAGES)[number][] = []
  /** `/7` successors that have run: their work rests on the old identity, so they start again. */
  const released = new Map<(typeof SUCCESSOR_STAGES)[number], string>()
  const revisedBy = {
    origin: { by: 'session' as const, attemptId: await proposalAttempt(client, proposalId) },
    briefRevision: snapshot.revision,
  }
  const published = {
    kind: 'proposal' as const,
    proposal_id: proposalId,
    proposal_kind: proposal.schema_version,
    state: 'published' as const,
  }
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
    // A successor that has not started yet is replaced, pinned to this identity. One that has run
    // gets the revision as a notice instead, except under `/7`, where it starts again.
    const unstarted = job?.attemptState === 'queued' && (job.turnCount ?? 0n) === 0n
    const live =
      job && !unstarted && !(ENDED_STATES as readonly string[]).includes(job.attemptState)
    if (live && stageInput) {
      released.set(stage, job.id)
      toQueue.push(stage)
    } else if (live) {
      await notifyRevision(
        client,
        job.id,
        `identity:${proposalId}`,
        {
          fields: ['identity'],
          reason: `The lot's identity was revised: ${proposal.summary}`,
          changes: [published],
        },
        revisedBy,
      )
    } else {
      toQueue.push(stage)
    }
  }
  if (!toQueue.length) {
    return 'revised'
  }
  // A `/7` lead under a configuration that doesn't seal `/7` can't queue its successors; the
  // identity stands, as it does with no provider on. Checked before any settings read.
  if (stageInput && configuredInputVersion(config) !== 'bench-intake-input/7') {
    return 'waiting'
  }
  // Under `/7` the new identity replaces the lot's earlier ones: they can't be the stable
  // identity again, whatever happens to this one.
  const retired = stageInput
    ? await retireEarlierIdentities(client, snapshot.id, lotId, proposalId)
    : []
  const retiredChanges = await staleChanges(client, retired, 'source_superseded')
  // What was built on them is stale too, by lineage; each is told once, below.
  const dependents = new Map<string, string[]>()
  await cascadeAll(client, retired, 'source_superseded', revisedBy, dependents)

  const tellDependents = async () => {
    for (const [lineage, ids] of [...dependents].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      await notifyRevision(
        client,
        lineage,
        `identity:${proposalId}:${lineage}`,
        {
          fields: ['identity'],
          reason: `Examine revised a lot's identity, which what this session published relied on: ${proposal.summary}`,
          changes: [
            published,
            ...retiredChanges,
            ...(await staleChanges(client, ids, 'source_superseded')),
          ],
        },
        revisedBy,
      )
    }
  }

  // One read decides what to queue and is sealed into every successor, so a save landing
  // meanwhile can neither roll back this proposal nor split the successors across revisions.
  const settings = await settingsForSuccessors(client, config)
  const queueable = settings
    ? toQueue.filter((stage) => resolveSelection(settings, stage))
    : [...toQueue]
  if (!queueable.length) {
    // With no provider on, the identity proposal still stands; its successors aren't queued.
    await tellDependents()
    return 'waiting'
  }
  await checkJobCapacity(client, snapshot.id, [lotId], [...queueable])
  for (const stage of queueable) {
    const releasedJob = released.get(stage)
    if (releasedJob) {
      // A released session is told once, with what the cascade made stale of its own work.
      const cascaded = dependents.get(releasedJob) ?? []
      dependents.delete(releasedJob)
      await releaseSuccessor(
        client,
        releasedJob,
        proposalId,
        proposal.summary,
        [
          published,
          ...retiredChanges,
          ...(await staleChanges(client, cascaded, 'source_superseded')),
        ],
        revisedBy,
      )
    }
    await queueJob(client, config, snapshot, lotId, stage, [], media, [proposalId], {
      lockSettings: false,
      settings,
      inputVersion,
    })
  }
  await tellDependents()
  return 'queued'
}

/**
 * A `/7` successor that has run, on a lot whose identity Examine republished: what it published
 * rests on the old identity, so its current proposals are stale (`source_superseded`), and it
 * is told so in a revision before it is queued again from the new identity, whose new attempt
 * reads that revision from the lineage's inbox. A lot in a group of several is released from
 * it instead once groups exist.
 */
async function releaseSuccessor(
  client: PoolClient,
  jobId: string,
  proposalId: string,
  summary: string,
  /** The new identity, and the earlier ones it retired. */
  identity: readonly RevisionChangeDto[],
  context: RevisionContext,
) {
  const stale = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: processingProposals.id })
      .from(processingProposals)
      .innerJoin(processingAttempts, eq(processingAttempts.id, processingProposals.attemptId))
      .where(
        and(
          eq(processingAttempts.jobId, jobId),
          notExists(
            queryDatabase(client)
              .select({ id: processingProposalStale.proposalId })
              .from(processingProposalStale)
              .where(eq(processingProposalStale.proposalId, processingProposals.id)),
          ),
        ),
      ),
  )
  const ids = stale.map((row) => row.id).sort()
  if (ids.length) {
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(processingProposalStale)
        .values(ids.map((id) => ({ proposalId: id, reason: 'source_superseded' as const })))
        .onConflictDoNothing(),
    )
  }
  await notifyRevision(
    client,
    jobId,
    `identity:${proposalId}`,
    {
      fields: ['identity'],
      reason: `Examine revised the lot's identity: ${summary} What this session published for the lot rests on the earlier identity, so it starts again from the new one.`,
      changes: [...identity, ...(await staleChanges(client, ids, 'source_superseded'))],
    },
    context,
  )
}

/**
 * The lot's other identities from the lead that are still current, made stale
 * (`source_superseded`) by the one just published. Returns their ids.
 */
async function retireEarlierIdentities(
  client: PoolClient,
  batchId: string,
  lotId: string,
  proposalId: string,
) {
  const ids = await earlierIdentities(client, batchId, lotId, proposalId)
  if (ids.length) {
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(processingProposalStale)
        .values(ids.map((id) => ({ proposalId: id, reason: 'source_superseded' as const })))
        .onConflictDoNothing(),
    )
  }
  return ids
}

/**
 * Every current proposal of the batch that rests on the identities given, at any depth through
 * `proposal` sources, the identities included: what retiring them makes stale.
 */
export async function builtOn(client: PoolClient, batchId: string, ids: readonly string[]) {
  if (!ids.length) {
    return []
  }
  const rows = await client.query<{ id: string }>(
    `WITH RECURSIVE built(id) AS (
       SELECT unnest($2::uuid[])
       UNION
       -- UNION keeps each proposal once, so a cycle ends and the closure is complete.
       SELECT p.id FROM built b
       JOIN public.processing_proposal p
         ON p.relies_on->'sources' @> jsonb_build_array(jsonb_build_object('kind','proposal','proposal_id',b.id::text))
       JOIN public.processing_attempt a ON a.id=p.attempt_id AND a.batch_id=$1
       WHERE NOT EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=p.id)
     )
     SELECT DISTINCT id FROM built`,
    [batchId, [...ids]],
  )
  return rows.rows.map((row) => row.id)
}

/** The lot's current identities from the lead, other than `proposalId`, which a new one retires. */
export async function earlierIdentities(
  client: PoolClient,
  batchId: string,
  lotId: string,
  proposalId: string,
) {
  const earlier = await client.query<{ id: string }>(
    `SELECT p.id FROM public.processing_proposal p
     JOIN public.processing_attempt a ON a.id=p.attempt_id
     JOIN public.processing_job j ON j.id=a.job_id AND j.stage='examine' AND j.batch_id=$1
     WHERE p.id<>$3 AND p.relies_on->'fields' ? 'identity'
       AND convert_from(p.value_bytes,'UTF8')::jsonb->>'subject_id'=$2::text
       AND NOT EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=p.id)
     ORDER BY p.id`,
    [batchId, lotId, proposalId],
  )
  return earlier.rows.map((row) => row.id)
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
  if (stale.length) {
    return false
  }
  return (await staleBrokenIdentities(client, pinned)) === 0
}

/**
 * The backstop behind every stale-row write: a pinned identity whose basis no longer holds is
 * made stale here, with what was built on it, and the session that published it is told to
 * publish the lot's identity again. Returns how many it found.
 */
async function staleBrokenIdentities(client: PoolClient, pinned: readonly string[]) {
  const broken = [...(await brokenIdentities(client, { proposalIds: pinned }))].sort()
  if (!broken.length) {
    return 0
  }
  await markStale(client, broken, 'source_superseded')
  const owners = await client.query<{ id: string; lineage: string; revision: string }>(
    `SELECT p.id, a.job_id AS lineage, b.revision::text AS revision
     FROM public.processing_proposal p JOIN public.processing_attempt a ON a.id=p.attempt_id
     JOIN public.processing_job j ON j.id=a.job_id JOIN public.capture_batch b ON b.id=j.batch_id
     WHERE p.id = ANY($1::uuid[]) ORDER BY p.id`,
    [broken],
  )
  for (const owner of owners.rows) {
    const context: RevisionContext = { origin: { by: 'operator' }, briefRevision: owner.revision }
    await cascadeAll(client, [owner.id], 'source_superseded', context)
    await notifyRevision(
      client,
      owner.lineage,
      `basis:${owner.id}`,
      {
        fields: ['identity'],
        reason:
          'Capture changed what this identity rested on since it was published; read the lot again and publish its identity.',
        changes: await staleChanges(client, [owner.id], 'source_superseded'),
      },
      context,
    )
  }
  return broken.length
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
