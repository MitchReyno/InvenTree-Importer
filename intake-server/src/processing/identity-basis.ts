import type { PoolClient } from 'pg'

/**
 * The lot's active members as Capture holds them now, in the shape a basis keeps: each one's
 * revision and same-item mark, ordered by id.
 */
const MEMBERS_SQL = `COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id',o.id,'revision',o.revision::text,'same_item_as',o.same_item_as)
                   ORDER BY o.id)
  FROM public.capture_lot_evidence_observation m
  JOIN public.capture_evidence_observation o ON o.id=m.evidence_observation_id
  WHERE m.lot_id=$1 AND m.status='active' AND o.status='active'), '[]'::jsonb)`

/** Keeps the lot as a stable `/7` identity saw it, for the claim and Review gate to compare. */
export async function recordIdentityBasis(
  client: PoolClient,
  batchId: string,
  lotId: string,
  proposalId: string,
) {
  await client.query(
    `INSERT INTO public.processing_identity_basis(proposal_id,batch_id,lot_id,members)
     VALUES ($2,$3,$1,${MEMBERS_SQL})`,
    [lotId, proposalId, batchId],
  )
}

/**
 * The identities of a batch, or only the named ones, whose basis no longer holds: a member of
 * their lot changed, joined or left, or an observation or observation set they cite moved on.
 * Stale rows are written for every change path known; this catches any they miss.
 */
export async function brokenIdentities(
  client: PoolClient,
  scope: { batchId: string; proposalIds?: readonly string[] } | { proposalIds: readonly string[] },
) {
  const batchId = 'batchId' in scope ? scope.batchId : null
  const proposalIds = scope.proposalIds ?? null
  const rows = await client.query<{ id: string }>(
    `SELECT b.proposal_id AS id
     FROM public.processing_identity_basis b
     JOIN public.processing_proposal p ON p.id=b.proposal_id
     WHERE ($1::uuid IS NULL OR b.batch_id=$1) AND ($2::uuid[] IS NULL OR b.proposal_id = ANY($2::uuid[]))
       AND NOT EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=b.proposal_id)
       AND (
         b.members IS DISTINCT FROM ${MEMBERS_SQL.replaceAll('$1', 'b.lot_id')}
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(p.relies_on->'sources') src
           LEFT JOIN public.capture_evidence_observation o
             ON src->>'kind'='evidence_observation' AND o.id=(src->>'evidence_observation_id')::uuid
           WHERE src->>'kind'='evidence_observation'
             AND (o.id IS NULL OR o.status<>'active' OR o.revision::text<>src->>'revision'))
         OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(p.relies_on->'sources') src
           LEFT JOIN public.capture_lot l
             ON src->>'kind'='observation_set' AND l.id=(src->>'lot_id')::uuid
           WHERE src->>'kind'='observation_set'
             AND (l.id IS NULL OR l.observation_set_version::text<>src->>'version'))
       )`,
    [batchId, proposalIds ? [...proposalIds] : null],
  )
  return new Set(rows.rows.map((row) => row.id))
}
