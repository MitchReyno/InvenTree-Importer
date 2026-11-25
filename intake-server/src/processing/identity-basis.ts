import type { PoolClient } from 'pg'
import { versionRemovedSql } from '#/media/removal.ts'

/**
 * The lot's members as Capture shows them now, in the shape a basis keeps: each active one not
 * on removed evidence, with its revision and same-item mark, ordered by id.
 */
const membersOf = (lot: string) => `COALESCE((
  SELECT jsonb_agg(jsonb_build_object('id',o.id,'revision',o.revision::text,'same_item_as',o.same_item_as)
                   ORDER BY o.id)
  FROM public.capture_lot_evidence_observation m
  JOIN public.capture_evidence_observation o ON o.id=m.evidence_observation_id
  JOIN public.media_version v ON v.id=o.evidence_version_id
  WHERE m.lot_id=${lot} AND m.status='active' AND o.status='active'
    AND NOT ${versionRemovedSql('v')}), '[]'::jsonb)`

/** Keeps the lot as a stable `/7` identity saw it, for the claim and Review gate to compare. */
export async function recordIdentityBasis(
  client: PoolClient,
  batchId: string,
  lotId: string,
  proposalId: string,
) {
  await client.query(
    `INSERT INTO public.processing_identity_basis(proposal_id,batch_id,lot_id,members)
     VALUES ($2,$3,$1,${membersOf('$1')})`,
    [lotId, proposalId, batchId],
  )
}

type Scope =
  { batchId: string; proposalIds?: readonly string[] } | { proposalIds: readonly string[] }

/**
 * For each proposal in scope, which of the proposals it rests on, itself included and at any
 * depth through `proposal` sources, fail: their kept lot no longer matches Capture, or an
 * observation or observation set they cite moved on, or, with `withStale`, the proposal itself
 * has a stale row.
 * A read only; nothing is written.
 */
async function failing(client: PoolClient, scope: Scope, withStale: boolean) {
  const batchId = 'batchId' in scope ? scope.batchId : null
  const proposalIds = scope.proposalIds ? [...scope.proposalIds] : null
  const rows = await client.query<{ root: string; id: string }>(
    `WITH RECURSIVE scoped(id) AS (
       SELECT p.id FROM public.processing_proposal p
       JOIN public.processing_attempt a ON a.id=p.attempt_id
       WHERE ($1::uuid IS NULL OR a.batch_id=$1) AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[]))
     ), rests(root, id) AS (
       SELECT id, id FROM scoped
       UNION
       -- UNION keeps each pair once, so a cycle ends.
       SELECT r.root, (src->>'proposal_id')::uuid FROM rests r
       JOIN public.processing_proposal p ON p.id=r.id
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.relies_on->'sources','[]'::jsonb)) src
       WHERE src->>'kind'='proposal'
     )
     SELECT r.root, r.id FROM rests r
     LEFT JOIN public.processing_identity_basis b ON b.proposal_id=r.id
     LEFT JOIN public.processing_proposal p ON p.id=r.id
     -- A stale row counts on the named proposal itself: further down, the stale write's own
     -- cascade decides, as for earlier inputs. A broken basis counts at any depth.
     WHERE ($3::boolean AND r.id=r.root
            AND EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=r.id))
        OR (b.proposal_id IS NOT NULL AND (
          b.members IS DISTINCT FROM ${membersOf('b.lot_id')}
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
              AND (l.id IS NULL OR l.observation_set_version::text<>src->>'version'))))`,
    [batchId, proposalIds, withStale],
  )
  return rows.rows
}

/**
 * The proposals in scope that rest, themselves or through what they rely on, on an identity
 * whose kept lot or citations no longer match Capture. Stale rows are written for every change
 * path known; this catches any they miss. A read only.
 */
export async function onBrokenBasis(client: PoolClient, scope: Scope) {
  return new Set((await failing(client, scope, false)).map((row) => row.root))
}

/**
 * The pinned proposals, or what they rest on, that are not current: stale, or on a broken basis.
 * A read only, so a read-only transaction may ask it.
 */
export async function notCurrent(client: PoolClient, proposalIds: readonly string[]) {
  return new Set((await failing(client, { proposalIds }, true)).map((row) => row.root))
}

/** The identities whose own basis no longer holds, among those the given proposals rest on. */
export async function brokenBases(client: PoolClient, proposalIds: readonly string[]) {
  const rows = await failing(client, { proposalIds }, false)
  return [...new Set(rows.map((row) => row.id))].sort()
}
