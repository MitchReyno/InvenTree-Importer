import type { PoolClient } from 'pg'
import type { ProcessingFieldDto } from '@invimport/contracts'
import type { CaptureBinding } from '../capture/repository.ts'
import { appendSessionInbox } from '../agents/tools/inbox.ts'

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
         AND ($2::uuid IS NULL OR COALESCE(j.subject_id,
               (convert_from(p.value_bytes,'UTF8')::jsonb->>'subject_id')::uuid)=$2::uuid)
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
  for (const lineage of lineages) {
    await notice(client, lineage, `observation:${observationId}:${lotId}`, 'evidence', {
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
     WHERE p.relies_on->'sources' @> jsonb_build_array(jsonb_build_object('kind','evidence_observation','evidence_observation_id',$1::text))
       AND NOT EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=p.id)`,
    [observationId],
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
  return citing.rows.map((row) => row.id)
}
