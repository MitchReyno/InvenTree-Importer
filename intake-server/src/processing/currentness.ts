import type { PoolClient } from 'pg'
import type { ProcessingFieldDto } from '@invimport/contracts'
import type { CaptureBinding } from '#/capture/model.ts'
import { appendSessionInbox } from '#/agents/tools/inbox.ts'

/** Why a proposal stopped being current; mirrors `processing_proposal_stale.reason`. */
export type StaleReason =
  'answer_received' | 'operator_correction' | 'evidence_removed' | 'lot_regrouped'

/** A system notice (no actor) on a session's inbox, bound to the session's own batch. */
async function notice(
  client: PoolClient,
  lineageId: string,
  idempotencyKey: string,
  kind: 'revision' | 'evidence',
  payload: Record<string, unknown>,
) {
  const owner = await client.query<{
    actor_id: string
    target_id: string
    target_context_id: string
  }>(
    `SELECT b.actor_id,b.target_id,b.target_context_id FROM public.processing_job j
     JOIN public.capture_batch b ON b.id=j.batch_id WHERE j.id=$1`,
    [lineageId],
  )
  const batch = owner.rows[0]
  if (!batch) {
    return
  }
  await appendSessionInbox(
    client,
    {
      binding: {
        actorId: batch.actor_id,
        targetId: batch.target_id,
        targetContextId: batch.target_context_id,
      } as CaptureBinding,
      lineageId,
      actorId: null,
      idempotencyKey,
      kind,
      payload: payload as never,
    },
    { publish: false },
  )
}

/**
 * Deployments without Processing (manual capture only) grant capture roles nothing on its
 * tables; there is then no session to tell and nothing to mark stale.
 */
async function processingVisible(client: PoolClient) {
  const rows = await client.query<{ visible: boolean }>(
    "SELECT has_table_privilege('public.processing_proposal', 'SELECT') AS visible",
  )
  return rows.rows[0]?.visible === true
}

/** Session lineages of a lot's Research and Images whose current attempt was not superseded. */
async function lotSessions(client: PoolClient, lotId: string) {
  const rows = await client.query<{ id: string }>(
    `SELECT j.id FROM public.processing_job j
     JOIN public.processing_attempt a ON a.id=j.current_attempt_id
     JOIN public.agent_session s ON s.attempt_id=a.id
     WHERE j.subject_id=$1 AND j.stage IN ('research','images')
       AND a.state NOT IN ('cancelled','superseded') AND s.session_state IS NOT NULL
     ORDER BY j.id`,
    [lotId],
  )
  return rows.rows.map((row) => row.id)
}

/**
 * A field of a subject changed (an answer or an operator correction). Every current proposal
 * for that subject relying on one of the fields, and every proposal relying on one of those, is
 * stale in this transaction. Each relying session gets a revision notice: owners of those
 * proposals, and sessions pinned to them even if they have published nothing yet. Proposals
 * relying on other fields stay current. `except` is the session already told (the asker).
 */
export async function fieldsSuperseded(
  client: PoolClient,
  input: {
    batchId: string
    subjectId: string | null
    fields: readonly ProcessingFieldDto[]
    reason: 'answer_received' | 'operator_correction'
    message: string
    key: string
    except?: string
  },
) {
  if (!(await processingVisible(client))) {
    return { stale: [] as string[], notified: [] as string[] }
  }
  const affected = await client.query<{ id: string; lineage: string }>(
    `WITH direct AS (
       SELECT p.id, j.id AS lineage FROM public.processing_proposal p
       JOIN public.processing_attempt a ON a.id=p.attempt_id
       JOIN public.processing_job j ON j.id=a.job_id
       WHERE j.batch_id=$1 AND p.relies_on IS NOT NULL
         AND COALESCE(j.subject_id,
               (convert_from(p.value_bytes,'UTF8')::jsonb->>'subject_id')::uuid)=$2::uuid
         AND (p.relies_on->'fields') ?| $3::text[]
         AND NOT EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=p.id)
     ), downstream AS (
       SELECT p.id, j.id AS lineage FROM public.processing_proposal p
       JOIN public.processing_attempt a ON a.id=p.attempt_id
       JOIN public.processing_job j ON j.id=a.job_id
       JOIN direct d ON p.relies_on->'sources' @> jsonb_build_array(jsonb_build_object('kind','proposal','proposal_id',d.id::text))
       WHERE NOT EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=p.id)
     )
     SELECT id, lineage FROM direct UNION SELECT id, lineage FROM downstream`,
    [input.batchId, input.subjectId, [...input.fields]],
  )
  const ids = affected.rows.map((row) => row.id)
  if (ids.length) {
    await client.query(
      `INSERT INTO public.processing_proposal_stale(proposal_id,reason)
       SELECT unnest($1::uuid[]),$2 ON CONFLICT DO NOTHING`,
      [ids, input.reason],
    )
    // Deeper results relying on these are stale too, and their sessions are told.
    await cascadeAll(client, ids, input.reason)
  }
  // Sessions started from one of these proposals rely on it even before publishing anything.
  const pinned = ids.length
    ? await client.query<{ lineage: string }>(
        `SELECT j.id AS lineage FROM public.processing_job j
         JOIN public.processing_attempt a ON a.id=j.current_attempt_id
         JOIN public.processing_input i ON i.id=a.input_id
         WHERE j.batch_id=$1 AND a.state NOT IN ('cancelled','superseded')
           AND (convert_from(i.manifest_bytes,'UTF8')::jsonb->'pinned_proposal_ids') ?| $2::text[]`,
        [input.batchId, ids],
      )
    : { rows: [] }
  const lineages = new Set([
    ...affected.rows.map((row) => row.lineage),
    ...pinned.rows.map((row) => row.lineage),
  ])
  lineages.delete(input.except ?? '')
  for (const lineage of [...lineages].sort()) {
    await notice(client, lineage, `${input.key}:${lineage}`, 'revision', {
      fields: [...input.fields],
      reason: input.message.slice(0, 2048),
    })
  }
  return { stale: ids, notified: [...lineages].sort() }
}

/**
 * An observation joined a lot: its Research and Images sessions get a new-evidence notice for
 * the observation's photo. A finished session is resumed by the wake sweep, which picks up
 * unread inbox items.
 */
export async function observationAdded(client: PoolClient, lotId: string, observationId: string) {
  if (!(await processingVisible(client))) {
    return [] as string[]
  }
  const observation = await client.query<{ evidence_id: string; version_id: string }>(
    `SELECT v.evidence_id, o.evidence_version_id AS version_id
     FROM public.capture_evidence_observation o JOIN public.media_version v ON v.id=o.evidence_version_id
     WHERE o.id=$1`,
    [observationId],
  )
  if (!observation.rows[0]) {
    return []
  }
  const lineages = await lotSessions(client, lotId)
  // Keyed by the lot's set version, so an observation that leaves and returns is noticed again.
  const version = await setVersion(client, lotId)
  for (const lineage of lineages) {
    await notice(client, lineage, `observation:${observationId}:${lotId}:${version}`, 'evidence', {
      evidence_id: observation.rows[0].evidence_id,
      version_id: observation.rows[0].version_id,
    })
  }
  return lineages
}

/**
 * An observation left a lot: proposals citing it become stale, and their sessions are told to
 * revise them.
 */
export async function observationRemoved(client: PoolClient, lotId: string, observationId: string) {
  if (!(await processingVisible(client))) {
    return [] as string[]
  }
  const citing = await client.query<{ id: string; lineage: string; fields: string[] }>(
    `SELECT p.id, j.id AS lineage, ARRAY(SELECT jsonb_array_elements_text(p.relies_on->'fields')) AS fields
     FROM public.processing_proposal p
     JOIN public.processing_attempt a ON a.id=p.attempt_id JOIN public.processing_job j ON j.id=a.job_id
     WHERE j.batch_id=(SELECT l.batch_id FROM public.capture_lot l WHERE l.id=$2)
       AND p.relies_on->'sources' @> jsonb_build_array(jsonb_build_object('kind','evidence_observation','evidence_observation_id',$1::text))
       AND NOT EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=p.id)`,
    [observationId, lotId],
  )
  if (citing.rows.length) {
    await client.query(
      `INSERT INTO public.processing_proposal_stale(proposal_id,reason)
       SELECT unnest($1::uuid[]),'evidence_removed' ON CONFLICT DO NOTHING`,
      [citing.rows.map((row) => row.id)],
    )
  }
  for (const row of citing.rows) {
    await notice(client, row.lineage, `removed:${observationId}:${lotId}:${row.id}`, 'revision', {
      fields: row.fields.length ? row.fields : ['identity'],
      reason: 'An observation a proposal cited left the lot; revise the proposal.',
    })
  }
  const ids = citing.rows.map((row) => row.id)
  await cascadeAll(client, ids, 'evidence_removed')
  // The lot's own sessions hear about the change too, whether or not they cited it.
  const version = await setVersion(client, lotId)
  const told = new Set(citing.rows.map((row) => row.lineage))
  for (const lineage of await lotSessions(client, lotId)) {
    if (!told.has(lineage)) {
      await notice(client, lineage, `removed:${observationId}:${lotId}:${version}`, 'revision', {
        fields: ['identity'],
        reason: 'An observation left the lot; check what relied on it.',
      })
    }
  }
  return ids
}

async function setVersion(client: PoolClient, lotId: string) {
  const rows = await client.query<{ version: string }>(
    'SELECT observation_set_version::text AS version FROM public.capture_lot WHERE id=$1',
    [lotId],
  )
  return rows.rows[0]?.version ?? '0'
}

/**
 * Proposals relying on newly stale ones through a `proposal` source are stale for the same
 * reason, in the same transaction, and their sessions are told; Inventory then waits.
 */
async function cascadeStale(client: PoolClient, ids: readonly string[], reason: StaleReason) {
  if (!ids.length) {
    return []
  }
  const downstream = await client.query<{ id: string; lineage: string; fields: string[] }>(
    `SELECT p.id, j.id AS lineage,
       ARRAY(SELECT jsonb_array_elements_text(p.relies_on->'fields')) AS fields
     FROM public.processing_proposal p
     JOIN public.processing_attempt a ON a.id=p.attempt_id JOIN public.processing_job j ON j.id=a.job_id
     WHERE j.batch_id=(SELECT j2.batch_id FROM public.processing_proposal p2
                       JOIN public.processing_attempt a2 ON a2.id=p2.attempt_id
                       JOIN public.processing_job j2 ON j2.id=a2.job_id WHERE p2.id=$1::uuid)
       AND EXISTS (SELECT 1 FROM unnest($2::uuid[]) AS stale(id)
         WHERE p.relies_on->'sources' @> jsonb_build_array(jsonb_build_object('kind','proposal','proposal_id',stale.id::text)))
       AND NOT EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=p.id)`,
    [ids[0], [...ids]],
  )
  if (downstream.rows.length) {
    await client.query(
      `INSERT INTO public.processing_proposal_stale(proposal_id,reason)
       SELECT unnest($1::uuid[]),$2 ON CONFLICT DO NOTHING`,
      [downstream.rows.map((row) => row.id), reason],
    )
  }
  for (const row of downstream.rows) {
    await notice(client, row.lineage, `cascade:${row.id}`, 'revision', {
      fields: row.fields.length ? row.fields : ['identity'],
      reason: 'A proposal this one relied on is no longer current; revise it.',
    })
  }
  return downstream.rows.map((row) => row.id)
}

/** Every proposal downstream of newly stale ones, level by level. */
async function cascadeAll(client: PoolClient, ids: readonly string[], reason: StaleReason) {
  let level = ids
  // Real chains are a few levels (identity, then Research or Images, then what cites them);
  // the bound only guards against a pathological one.
  for (let depth = 0; level.length && depth < 8; depth += 1) {
    level = await cascadeStale(client, level, reason)
  }
}

/**
 * After a regroup: results relying on the lot's stale identities are stale too. When the operator
 * regrouped, the session that published those identities is told, so it can publish again.
 */
export async function lotRegroupedNotices(
  client: PoolClient,
  staleIds: readonly string[],
  { operator }: { operator: boolean },
) {
  if (!staleIds.length || !(await processingVisible(client))) {
    return
  }
  await cascadeAll(client, staleIds, 'lot_regrouped')
  if (!operator) {
    return
  }
  const owners = await client.query<{ id: string; lineage: string; lead: boolean }>(
    `SELECT p.id, j.id AS lineage, (j.subject_id IS NULL) AS lead FROM public.processing_proposal p
     JOIN public.processing_attempt a ON a.id=p.attempt_id JOIN public.processing_job j ON j.id=a.job_id
     WHERE p.id = ANY($1::uuid[])`,
    [[...staleIds]],
  )
  for (const row of owners.rows) {
    await notice(client, row.lineage, `regrouped:${row.id}`, 'revision', {
      fields: ['identity'],
      // Only the lead session publishes identities; a lot session revises what it found.
      reason: row.lead
        ? 'The operator changed this lot’s observations; publish its identity again.'
        : 'The operator changed this lot’s observations; revise what relied on them.',
    })
  }
}
