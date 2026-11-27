import type { PoolClient } from 'pg'
import type { MatchKeyDto } from '@invimport/contracts'
import type { ProcessingConfig } from '#/processing/attempts.ts'
import { companiesAgree, mpnKey, strongKey } from './keys.ts'
import { decodeRequest, type MatchRequest } from './state.ts'

/** A stock operation that approved the lot's original contribution, and what came of it. */
export interface ContributionApproval {
  runId: string
  /** The batch the approving preparation belongs to, whose Changes list the run. */
  batchId: string
  /** The approver's actor and target context are this operator's, so the run can be read. */
  readable: boolean
  /** Confirmed remote stock PKs, and whether any create is still uncertain. */
  confirmedStock: string[]
  uncertain: boolean
}

/**
 * The approvals of the lot's original contribution anywhere on the target, from this app's
 * retained execution journal. Any approval is a hit, whatever became of its stock; the run is
 * readable only by the actor and target context that approved it.
 */
export async function contributionApprovals(
  client: PoolClient,
  config: ProcessingConfig,
  lotId: string,
): Promise<ContributionApproval[]> {
  const rows = await client.query<{
    run_id: string
    batch_id: string
    readable: boolean
    confirmed: string[] | null
    uncertain: boolean
  }>(
    `SELECT o.run_id, p.batch_id,
       (a.actor_id=$2 AND a.context_id=$3) AS readable,
       array_remove(array_cat(
         ARRAY(SELECT e.remote_pk FROM public.executor_effect e
               WHERE e.run_id=o.run_id AND e.operation_key=o.operation_key
                 AND e.certainty='confirmed' AND e.remote_pk IS NOT NULL),
         ARRAY(SELECT unnest(se.remote_pks) FROM public.executor_supported_effect se
               WHERE se.run_id=o.run_id AND se.operation_key=o.operation_key
                 AND se.certainty='confirmed')), NULL) AS confirmed,
       (EXISTS (SELECT 1 FROM public.executor_effect e
                WHERE e.run_id=o.run_id AND e.operation_key=o.operation_key AND e.certainty='unknown')
        OR EXISTS (SELECT 1 FROM public.executor_supported_effect se
                WHERE se.run_id=o.run_id AND se.operation_key=o.operation_key AND se.certainty='unknown'))
         AS uncertain
     FROM public.capture_lot l
     JOIN public.executor_operation o
       ON o.contribution_key=l.contribution_key AND o.target_id=$4
     JOIN public.executor_run r ON r.id=o.run_id
     JOIN public.executor_approval a ON a.id=r.approval_id
     JOIN public.manual_preparation p ON p.id=a.preparation_id
     WHERE l.id=$1
     ORDER BY o.run_id`,
    [lotId, config.actorId, config.targetContextId, config.targetId],
  )
  return rows.rows.map((row) => ({
    runId: row.run_id,
    batchId: row.batch_id,
    readable: row.readable,
    confirmedStock: [...new Set(row.confirmed ?? [])].sort(),
    uncertain: row.uncertain,
  }))
}

/** Another batch's lot whose own search keys share a strong key with this one. */
export interface CompetingLot {
  batchId: string
  batchTitle: string
  lotId: string
  lotLabel: string
  matched: {
    key: MatchKeyDto
    reason: 'mpn_and_manufacturer' | 'type_and_manufacturer' | 'nsn_stock_tag' | 'ipn' | 'sku'
  }[]
}

const MAX_MATCHED_BY = 16

/**
 * At most this many other lots are compared with each search; with more, the search reports
 * itself incomplete rather than finding no competing lot.
 */
const COMPETING_LOT_SCAN = 10_000

/** Whether two strong keys name the same Part. */
function sameKey(left: MatchKeyDto, right: MatchKeyDto) {
  if (left.kind === 'mpn' && right.kind === 'mpn') {
    const manufacturers =
      left.manufacturer_pk !== undefined && right.manufacturer_pk !== undefined
        ? left.manufacturer_pk === right.manufacturer_pk
        : left.manufacturer !== undefined &&
          right.manufacturer !== undefined &&
          companiesAgree(left.manufacturer, right.manufacturer)
    return mpnKey(left.mpn) === mpnKey(right.mpn) && manufacturers
  }
  if (left.kind === 'type' && right.kind === 'type') {
    return (
      mpnKey(left.type) === mpnKey(right.type) &&
      companiesAgree(left.manufacturer, right.manufacturer)
    )
  }
  if (left.kind === 'nsn' && right.kind === 'nsn') {
    return left.nsn === right.nsn
  }
  if (left.kind === 'ipn' && right.kind === 'ipn') {
    return mpnKey(left.ipn) === mpnKey(right.ipn)
  }
  if (left.kind === 'sku' && right.kind === 'sku') {
    return mpnKey(left.sku) === mpnKey(right.sku)
  }
  return false
}

function competingReason(key: MatchKeyDto) {
  switch (key.kind) {
    case 'mpn':
      return 'mpn_and_manufacturer' as const
    case 'type':
      return 'type_and_manufacturer' as const
    case 'nsn':
      return 'nsn_stock_tag' as const
    case 'ipn':
      return 'ipn' as const
    case 'sku':
    case 'batch_code':
      return 'sku' as const
  }
}

/**
 * Unapproved lots of this actor, target and context in other, unarchived batches whose latest
 * Match request, for an identity still current, shares a strong key with this lot's. Lots of the same batch are never competing:
 * two lots of one batch may well be the same Part.
 */
export async function competingLots(
  client: PoolClient,
  config: ProcessingConfig,
  request: MatchRequest,
): Promise<CompetingLot[] | 'incomplete'> {
  const strong = request.keys.filter(strongKey)
  if (!strong.length) {
    return []
  }
  const rows = await client.query<{
    batch_id: string
    title: string
    lot_id: string
    label: string
    request_bytes: Buffer
  }>(
    `SELECT b.id AS batch_id, b.title, l.id AS lot_id, s.label, q.request_bytes
     FROM public.processing_match m
     JOIN public.processing_match_search q
       ON q.lot_id=m.lot_id AND q.generation=m.search_generation
     JOIN public.capture_lot l ON l.id=m.lot_id
     JOIN public.capture_subject s ON s.id=l.id
     JOIN public.capture_batch b ON b.id=l.batch_id
     WHERE b.id<>$1 AND b.actor_id=$2 AND b.target_id=$3 AND b.target_context_id=$4
       AND NOT b.archived AND l.excluded_reason IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.capture_lot_retirement r WHERE r.lot_id=l.id)
       AND NOT EXISTS (SELECT 1 FROM public.executor_operation o
                       WHERE o.contribution_key=l.contribution_key AND o.target_id=b.target_id)
       -- An Examine identity since made stale no longer says what the other lot is.
       AND NOT EXISTS (SELECT 1 FROM public.processing_proposal_stale st
                       WHERE st.proposal_id::text=convert_from(m.identity_bytes,'UTF8')::jsonb->>'proposal_id')
     ORDER BY l.id
     LIMIT $5`,
    [
      request.batch_id,
      config.actorId,
      config.targetId,
      config.targetContextId,
      COMPETING_LOT_SCAN + 1,
    ],
  )
  // Every other lot is compared, or the search can't say none competes.
  if (rows.rows.length > COMPETING_LOT_SCAN) {
    return 'incomplete'
  }
  const found: CompetingLot[] = []
  for (const row of rows.rows) {
    const keys = decodeRequest(row.request_bytes).keys.filter(strongKey)
    const matched = strong
      .filter((key) => keys.some((theirs) => sameKey(key, theirs)))
      .map((key) => ({ key, reason: competingReason(key) }))
      // The contract quotes at most 16 reasons per candidate.
      .slice(0, MAX_MATCHED_BY)
    if (matched.length) {
      found.push({
        batchId: row.batch_id,
        batchTitle: row.title,
        lotId: row.lot_id,
        lotLabel: row.label,
        matched,
      })
    }
  }
  return found
}
