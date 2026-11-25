import type { PoolClient } from 'pg'
import type {
  EvidenceReadingsDto,
  EvidenceRegionDto,
  ProcessingFieldDto,
  RevisionChangeDto,
  RevisionSourceDto,
} from '@invimport/contracts'
import type { CaptureBinding } from '#/capture/model.ts'
import { appendSessionInbox } from '#/agents/tools/inbox.ts'

/** Why a proposal stopped being current; mirrors `processing_proposal_stale.reason`. */
export type StaleReason =
  | 'answer_received'
  | 'operator_correction'
  | 'evidence_removed'
  | 'lot_regrouped'
  | 'source_superseded'

/** Who made a change, and the brief revision a `/7` session sees it at. */
export interface RevisionContext {
  origin: { by: 'operator' } | { by: 'session'; attemptId: string }
  briefRevision: string
}

/**
 * A revision a session is told about. An earlier session gets its fields and reason; a `/7`
 * session also gets each change, who made it and the brief revision (`revision/2`).
 */
export interface RevisionNotice {
  fields: readonly ProcessingFieldDto[]
  reason: string
  changes: readonly RevisionChangeDto[]
}

/** A `revision/2` item names at most this many changes; a revision with more is split. */
const MAX_REVISION_CHANGES = 100

interface LineageFacts {
  binding: CaptureBinding
  actorId: string
  /** The input version of the lineage's current attempt, which decides the revision's shape. */
  inputVersion: string | null
}

async function lineageFacts(client: PoolClient, lineageId: string): Promise<LineageFacts | null> {
  const rows = await client.query<{
    actor_id: string
    target_id: string
    target_context_id: string
    input_version: string | null
  }>(
    `SELECT b.actor_id,b.target_id,b.target_context_id,
       convert_from(i.manifest_bytes,'UTF8')::jsonb->>'schema_version' AS input_version
     FROM public.processing_job j
     JOIN public.capture_batch b ON b.id=j.batch_id
     LEFT JOIN public.processing_attempt a ON a.id=j.current_attempt_id
     LEFT JOIN public.processing_input i ON i.id=a.input_id
     WHERE j.id=$1`,
    [lineageId],
  )
  const row = rows.rows[0]
  if (!row) {
    return null
  }
  return {
    binding: {
      actorId: row.actor_id,
      targetId: row.target_id,
      targetContextId: row.target_context_id,
    } as CaptureBinding,
    actorId: row.actor_id,
    inputVersion: row.input_version,
  }
}

/** A system notice (no actor) on a session's inbox, bound to the session's own batch. */
async function append(
  client: PoolClient,
  facts: LineageFacts,
  lineageId: string,
  idempotencyKey: string,
  kind: 'revision' | 'evidence',
  payload: Record<string, unknown>,
) {
  await appendSessionInbox(
    client,
    {
      binding: facts.binding,
      lineageId,
      actorId: null,
      idempotencyKey,
      kind,
      payload: payload as never,
    },
    { publish: false },
  )
}

async function evidenceNotice(
  client: PoolClient,
  lineageId: string,
  idempotencyKey: string,
  payload: { evidence_id: string; version_id: string },
) {
  const facts = await lineageFacts(client, lineageId)
  if (facts) {
    await append(client, facts, lineageId, idempotencyKey, 'evidence', payload)
  }
}

async function revisionSource(
  client: PoolClient,
  facts: LineageFacts,
  origin: RevisionContext['origin'],
): Promise<RevisionSourceDto> {
  if (origin.by === 'operator') {
    return { kind: 'operator', actor_id: facts.actorId }
  }
  const rows = await client.query<{ stage: 'examine' | 'research' | 'images' }>(
    `SELECT j.stage FROM public.processing_attempt a
     JOIN public.processing_job j ON j.id=a.job_id WHERE a.id=$1`,
    [origin.attemptId],
  )
  return { kind: 'session', stage: rows.rows[0].stage, attempt_id: origin.attemptId }
}

/** Tells one session about a revision, in the shape its current input reads. */
export async function notifyRevision(
  client: PoolClient,
  lineageId: string,
  idempotencyKey: string,
  notice: RevisionNotice,
  context: RevisionContext,
) {
  const facts = await lineageFacts(client, lineageId)
  if (!facts) {
    return
  }
  // Cut by code point, as the contract counts, so no surrogate pair is split.
  const reason = [...notice.reason].slice(0, 2048).join('')
  if (facts.inputVersion !== 'bench-intake-input/7') {
    await append(client, facts, lineageId, idempotencyKey, 'revision', {
      fields: [...notice.fields],
      reason,
    })
    return
  }
  const base = {
    schema_version: 'bench-intake-revision/2' as const,
    fields: [...notice.fields],
    reason,
    source: await revisionSource(client, facts, context.origin),
    brief_revision: context.briefRevision,
  }
  let changes = [...notice.changes]
  const valuesInBrief = jsonbBytes({ ...base, changes }) > MAX_REVISION_PAYLOAD_BYTES
  if (valuesInBrief) {
    changes = valuesLeftOut(changes, context.briefRevision)
  }
  const head = { ...base, ...(valuesInBrief ? { values_in_brief: true as const } : {}) }
  const parts = inParts(head, changes)
  for (const [index, part] of parts.entries()) {
    const split = parts.length > 1
    await append(
      client,
      facts,
      lineageId,
      split ? `${idempotencyKey}:part${index + 1}` : idempotencyKey,
      'revision',
      {
        ...head,
        changes: part,
        ...(split ? { part: { index: index + 1, count: parts.length } } : {}),
      },
    )
  }
}

/** The inbox keeps a revision of at most this many bytes, as PostgreSQL stores it (`0030`). */
const MAX_REVISION_PAYLOAD_BYTES = 32_768

/**
 * At least the bytes PostgreSQL stores for a value as jsonb text: its JSON, with the space jsonb
 * adds after every separator counted for every colon and comma, inside strings too.
 */
function jsonbBytes(value: object) {
  const json = JSON.stringify(value)
  const separators = json.match(/[:,]/g)?.length ?? 0
  return Buffer.byteLength(json, 'utf8') + separators
}

/**
 * A revision whose values would pass the inbox's bound points to the brief instead (Mitch's
 * decision): each change still names what changed, and the long values, a correction's readings
 * and an answer's steps, are left to the brief, where they stay: a correction's by its observation
 * and revision, an answer's by its question. Field changes stay inline.
 */
function valuesLeftOut(
  changes: readonly RevisionChangeDto[],
  correctedAt: string,
): RevisionChangeDto[] {
  return changes.map((change): RevisionChangeDto => {
    if (change.kind === 'reading') {
      return {
        kind: 'reading_in_brief',
        observation_id: change.observation_id,
        revision: correctedAt,
      }
    }
    if (change.kind === 'answer') {
      return {
        kind: 'answer_in_brief',
        question_id: change.question_id,
        answer_id: change.answer_id,
      }
    }
    // A field change carries only a short Capture value, such as a quantity, which no brief
    // keeps as it was before; it stays inline.
    return change
  })
}

/**
 * The changes in order, in as few items as fit the inbox: at most `MAX_REVISION_CHANGES` each,
 * and within its byte bound. Nothing is left out; a session reads the parts in sequence.
 */
function inParts(head: object, changes: readonly RevisionChangeDto[]) {
  const parts: RevisionChangeDto[][] = []
  let part: RevisionChangeDto[] = []
  // The part field and a key's suffix fit in this allowance.
  const room = MAX_REVISION_PAYLOAD_BYTES - 128
  for (const change of changes) {
    const candidate = [...part, change]
    const full =
      candidate.length > MAX_REVISION_CHANGES || jsonbBytes({ ...head, changes: candidate }) > room
    if (full && part.length) {
      parts.push(part)
      part = [change]
    } else {
      part = candidate
    }
  }
  if (part.length) {
    parts.push(part)
  }
  return parts
}

/** Each proposal's published kind; a runner proposal of `/1` names none. */
async function proposalKinds(client: PoolClient, ids: readonly string[]) {
  if (!ids.length) {
    return new Map<string, string>()
  }
  const rows = await client.query<{ id: string; kind: string }>(
    `SELECT p.id, COALESCE(convert_from(p.value_bytes,'UTF8')::jsonb->>'schema_version',
       'bench-intake-proposal/1') AS kind
     FROM public.processing_proposal p WHERE p.id = ANY($1::uuid[])`,
    [[...ids]],
  )
  return new Map(rows.rows.map((row) => [row.id, row.kind]))
}

/** Changes naming each proposal that just went stale, for one session. */
export async function staleChanges(
  client: PoolClient,
  ids: readonly string[],
  reason: StaleReason,
): Promise<RevisionChangeDto[]> {
  const kinds = await proposalKinds(client, ids)
  return [...ids].sort().map((id) => ({
    kind: 'proposal',
    proposal_id: id,
    proposal_kind: kinds.get(id) ?? 'bench-intake-proposal/1',
    state: 'stale',
    reason,
  }))
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
 * Sessions started from one of these proposals rely on it even before publishing anything: each
 * live session pinned to one is added with the proposals it was pinned to.
 */
async function addPinned(
  client: PoolClient,
  batchId: string,
  ids: readonly string[],
  relied: Map<string, string[]>,
) {
  if (!ids.length) {
    return
  }
  const pinned = await client.query<{ lineage: string; pinned: string[] }>(
    `SELECT j.id AS lineage, ARRAY(
       SELECT jsonb_array_elements_text(convert_from(i.manifest_bytes,'UTF8')::jsonb->'pinned_proposal_ids')
     ) AS pinned
     FROM public.processing_job j
     JOIN public.processing_attempt a ON a.id=j.current_attempt_id
     JOIN public.processing_input i ON i.id=a.input_id
     WHERE j.batch_id=$1 AND a.state NOT IN ('cancelled','superseded')
       AND (convert_from(i.manifest_bytes,'UTF8')::jsonb->'pinned_proposal_ids') ?| $2::text[]`,
    [batchId, [...ids]],
  )
  for (const row of pinned.rows) {
    const reliedOn = row.pinned.filter((id) => ids.includes(id))
    relied.set(row.lineage, [...new Set([...(relied.get(row.lineage) ?? []), ...reliedOn])])
  }
}

/** The proposal ids of each lineage, from rows naming a proposal and the lineage holding it. */
function byLineage(rows: readonly { id: string; lineage: string }[]) {
  const lineages = new Map<string, string[]>()
  for (const row of rows) {
    lineages.set(row.lineage, [...(lineages.get(row.lineage) ?? []), row.id])
  }
  return lineages
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
    /** The fields' previous and new values, as a `/7` session is told them. */
    changes: readonly RevisionChangeDto[]
    context: RevisionContext
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
  }
  // Deeper results relying on these are stale too. Every session relying on any of them, pinned
  // ones included at any depth, is told once below with the change that caused it.
  const relied = byLineage(affected.rows)
  const cascaded = ids.length
    ? await cascadeAll(client, ids, input.reason, input.context, relied)
    : []
  await addPinned(client, input.batchId, [...ids, ...cascaded], relied)
  relied.delete(input.except ?? '')
  const lineages = [...relied.keys()].sort()
  for (const lineage of lineages) {
    await notifyRevision(
      client,
      lineage,
      `${input.key}:${lineage}`,
      {
        fields: input.fields,
        reason: input.message,
        changes: [
          ...input.changes,
          ...(await staleChanges(client, relied.get(lineage)!, input.reason)),
        ],
      },
      input.context,
    )
  }
  return { stale: ids, notified: lineages }
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
    await evidenceNotice(
      client,
      lineage,
      `observation:${observationId}:${lotId}:${version}`,
      observation.rows[0],
    )
  }
  return lineages
}

/**
 * An observation left a lot: proposals citing it become stale, and their sessions are told to
 * revise them. `lotTo` is the lot it moved to, if any.
 */
export async function observationRemoved(
  client: PoolClient,
  lotId: string,
  observationId: string,
  lotTo: string | null,
  context: RevisionContext,
) {
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
  const moved: RevisionChangeDto = {
    kind: 'observation',
    observation_id: observationId,
    lot_from: lotId,
    lot_to: lotTo,
  }
  for (const row of citing.rows) {
    await notifyRevision(
      client,
      row.lineage,
      `removed:${observationId}:${lotId}:${row.id}`,
      {
        fields: row.fields.length ? (row.fields as ProcessingFieldDto[]) : ['identity'],
        reason: 'An observation a proposal cited left the lot; revise the proposal.',
        changes: [moved, ...(await staleChanges(client, [row.id], 'evidence_removed'))],
      },
      context,
    )
  }
  const ids = citing.rows.map((row) => row.id)
  await cascadeAll(client, ids, 'evidence_removed', context)
  // The lot's own sessions hear about the change too, whether or not they cited it.
  const version = await setVersion(client, lotId)
  const told = new Set(citing.rows.map((row) => row.lineage))
  for (const lineage of await lotSessions(client, lotId)) {
    if (!told.has(lineage)) {
      await notifyRevision(
        client,
        lineage,
        `removed:${observationId}:${lotId}:${version}`,
        {
          fields: ['identity'],
          reason: 'An observation left the lot; check what relied on it.',
          changes: [moved],
        },
        context,
      )
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
async function cascadeStale(
  client: PoolClient,
  ids: readonly string[],
  reason: StaleReason,
  context: RevisionContext,
  /** When given, each newly stale proposal is added to its lineage here instead of told. */
  collect?: Map<string, string[]>,
) {
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
    if (collect) {
      collect.set(row.lineage, [...(collect.get(row.lineage) ?? []), row.id])
      continue
    }
    await notifyRevision(
      client,
      row.lineage,
      `cascade:${row.id}`,
      {
        fields: row.fields.length ? (row.fields as ProcessingFieldDto[]) : ['identity'],
        reason: 'A proposal this one relied on is no longer current; revise it.',
        changes: await staleChanges(client, [row.id], reason),
      },
      context,
    )
  }
  return downstream.rows.map((row) => row.id)
}

/** Every proposal downstream of newly stale ones, level by level. */
export async function cascadeAll(
  client: PoolClient,
  ids: readonly string[],
  reason: StaleReason,
  context: RevisionContext,
  collect?: Map<string, string[]>,
) {
  let level = ids
  const all: string[] = []
  // Each level stales only proposals not yet stale, so the walk ends, cycles included, and
  // reaches everything built on them however deep.
  while (level.length) {
    level = await cascadeStale(client, level, reason, context, collect)
    all.push(...level)
  }
  return all
}

/**
 * After a regroup: results relying on the lot's stale identities are stale too. When the operator
 * regrouped, the session that published those identities is told, so it can publish again.
 */
export async function lotRegroupedNotices(
  client: PoolClient,
  staleIds: readonly string[],
  context: RevisionContext,
) {
  if (!staleIds.length || !(await processingVisible(client))) {
    return
  }
  await cascadeAll(client, staleIds, 'lot_regrouped', context)
  if (context.origin.by !== 'operator') {
    return
  }
  const owners = await client.query<{ id: string; lineage: string; lead: boolean }>(
    `SELECT p.id, j.id AS lineage, (j.subject_id IS NULL) AS lead FROM public.processing_proposal p
     JOIN public.processing_attempt a ON a.id=p.attempt_id JOIN public.processing_job j ON j.id=a.job_id
     WHERE p.id = ANY($1::uuid[])`,
    [[...staleIds]],
  )
  for (const row of owners.rows) {
    await notifyRevision(
      client,
      row.lineage,
      `regrouped:${row.id}`,
      {
        fields: ['identity'],
        // Only the lead session publishes identities; a lot session revises what it found.
        reason: row.lead
          ? 'The operator changed this lot’s observations; publish its identity again.'
          : 'The operator changed this lot’s observations; revise what relied on them.',
        changes: await staleChanges(client, [row.id], 'lot_regrouped'),
      },
      context,
    )
  }
}

/** The batch's Examine lead lineage while its session can still be told, if any. */
async function leadSession(client: PoolClient, batchId: string) {
  const rows = await client.query<{ id: string }>(
    `SELECT j.id FROM public.processing_job j
     JOIN public.processing_attempt a ON a.id=j.current_attempt_id
     JOIN public.agent_session s ON s.attempt_id=a.id
     WHERE j.batch_id=$1 AND j.stage='examine' AND j.subject_id IS NULL
       AND a.state NOT IN ('cancelled','superseded') AND s.session_state IS NOT NULL
     ORDER BY j.id LIMIT 1`,
    [batchId],
  )
  return rows.rows[0]?.id ?? null
}

async function captureRevision(client: PoolClient, batchId: string) {
  const rows = await client.query<{ revision: string }>(
    'SELECT revision::text AS revision FROM public.capture_batch WHERE id=$1',
    [batchId],
  )
  return rows.rows[0].revision
}

/**
 * Evidence items were removed at media `revision`. Every current proposal relying on one of them, through
 * a cited version, an observation on one of its versions or one of its evidence notes, wherever the
 * proposal names it (its sources, its catalogue values or `relies_on`), is stale
 * with `evidence_removed`, and so is everything built on those. The Examine lead gets a batch
 * notice and the affected lots' Research and Images sessions a notice each, keyed by the revision
 * so a later removal after a restore is told again.
 */
export async function evidenceRemoved(
  client: PoolClient,
  input: {
    batchId: string
    evidenceIds: readonly string[]
    lotIds: readonly string[]
    revision: string
  },
) {
  if (!(await processingVisible(client))) {
    return { stale: [] as string[], notified: [] as string[] }
  }
  // `revision` is the media revision; a session's brief names the capture revision.
  const context: RevisionContext = {
    origin: { by: 'operator' },
    briefRevision: await captureRevision(client, input.batchId),
  }
  const cited = await client.query<{ versions: string[]; observations: string[]; notes: string[] }>(
    `SELECT
       ARRAY(SELECT v.id::text FROM public.media_version v
             WHERE v.batch_id=$1 AND v.evidence_id = ANY($2::uuid[])) AS versions,
       ARRAY(SELECT o.id::text FROM public.capture_evidence_observation o
             JOIN public.media_version v ON v.id=o.evidence_version_id
             WHERE v.batch_id=$1 AND v.evidence_id = ANY($2::uuid[])) AS observations,
       ARRAY(SELECT n.id::text FROM public.media_evidence_note n
             WHERE n.batch_id=$1 AND n.evidence_id = ANY($2::uuid[])) AS notes`,
    [input.batchId, [...input.evidenceIds]],
  )
  const { versions, observations, notes } = cited.rows[0]
  // A session proposal cites in its value (every value's sources, and a research/1 datasheet's
  // retained version, as `proposalCitations` lists them) and relies through `relies_on`; any of
  // them counts.
  const affected = await client.query<{ id: string; lineage: string }>(
    `SELECT p.id, j.id AS lineage FROM public.processing_proposal p
     JOIN public.processing_attempt a ON a.id=p.attempt_id
     JOIN public.processing_job j ON j.id=a.job_id
     WHERE j.batch_id=$1 AND p.relies_on IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=p.id)
       AND EXISTS (
         SELECT 1 FROM (
           SELECT jsonb_array_elements(p.relies_on->'sources') AS source
           UNION ALL
           SELECT jsonb_path_query(convert_from(p.value_bytes,'UTF8')::jsonb, 'lax $.**.sources[*]')
           UNION ALL
           -- research/1 names a retained datasheet PDF outside any sources list.
           SELECT jsonb_path_query(convert_from(p.value_bytes,'UTF8')::jsonb, 'lax $.datasheet.version')
           UNION ALL
           -- examine-identity/1's markings rest on their observations.
           SELECT jsonb_build_object('kind','evidence_observation','evidence_observation_id',m)
           FROM jsonb_path_query(convert_from(p.value_bytes,'UTF8')::jsonb, 'lax $.markings[*].observation_id') AS m
         ) cited
         WHERE (cited.source->>'kind'='media_version'
                AND cited.source->>'version_id' = ANY($2::text[]))
            OR (cited.source->>'kind'='evidence_observation'
                AND cited.source->>'evidence_observation_id' = ANY($3::text[]))
            OR (cited.source->>'kind'='note' AND cited.source->>'note_id' = ANY($4::text[])))
     ORDER BY p.id`,
    [input.batchId, versions, observations, notes],
  )
  const ids = affected.rows.map((row) => row.id)
  if (ids.length) {
    await client.query(
      `INSERT INTO public.processing_proposal_stale(proposal_id,reason)
       SELECT unnest($1::uuid[]),'evidence_removed' ON CONFLICT DO NOTHING`,
      [ids],
    )
    await cascadeAll(client, ids, 'evidence_removed', context)
  }
  const lead = await leadSession(client, input.batchId)
  const relied = byLineage(affected.rows)
  for (const lotId of input.lotIds) {
    for (const lineage of await lotSessions(client, lotId)) {
      relied.set(lineage, relied.get(lineage) ?? [])
    }
  }
  if (lead) {
    relied.set(lead, relied.get(lead) ?? [])
  }
  const removed: RevisionChangeDto[] = input.evidenceIds.map((evidenceId) => ({
    kind: 'evidence',
    evidence_id: evidenceId,
    removed: true,
  }))
  const lineages = [...relied.keys()].sort()
  for (const lineage of lineages) {
    await notifyRevision(
      client,
      lineage,
      `evidence_removed:${input.revision}:${lineage}`,
      {
        fields: ['identity'],
        reason:
          lineage === lead
            ? 'The operator deleted evidence from this batch; observations on it no longer count. Revise the lots that relied on them.'
            : 'The operator deleted evidence this lot used; revise what relied on it.',
        changes: [
          ...removed,
          ...(await staleChanges(client, relied.get(lineage)!, 'evidence_removed')),
        ],
      },
      context,
    )
  }
  return { stale: ids, notified: lineages }
}

/**
 * The operator corrected an observation's reading at `revision`. For `/7` work, every current
 * `/7` proposal relying on the observation is stale (`operator_correction`), with what relies on
 * it, and the batch's `/7` lead, the observation's lot's sessions and those proposals' sessions
 * are each told once, naming the reading before and after. A `/7` lead is woken by it, as by any
 * unread item. Earlier inputs' proposals and sessions are left as they were.
 */
export async function observationCorrected(
  client: PoolClient,
  input: {
    batchId: string
    observationId: string
    /** The reading before and after, when it changed. */
    reading?: { before: EvidenceReadingsDto; after: EvidenceReadingsDto }
    /** The region on its page before and after, when it moved. */
    region?: { before: EvidenceRegionDto; after: EvidenceRegionDto }
    /** How many items it shows before and after, when that changed. */
    count?: { before: number | null; after: number | null }
    /** A same-item mark set or cleared, on this observation or on one now marked the same as it. */
    sameItem?: { observationId: string; before: string | null; after: string | null }
    /** The lot it joined, when it had none before. */
    joined?: string
    revision: string
    /** The operator's correction, or the Examine session revising its own observation. */
    origin?: RevisionContext['origin']
  },
) {
  if (!(await processingVisible(client))) {
    return { stale: [] as string[], notified: [] as string[] }
  }
  const origin = input.origin ?? { by: 'operator' as const }
  const reason: StaleReason = origin.by === 'operator' ? 'operator_correction' : 'source_superseded'
  const context: RevisionContext = { origin, briefRevision: input.revision }
  const relying = await client.query<{ id: string; lineage: string }>(
    `SELECT p.id, j.id AS lineage FROM public.processing_proposal p
     JOIN public.processing_attempt a ON a.id=p.attempt_id
     JOIN public.processing_input i ON i.id=a.input_id
     JOIN public.processing_job j ON j.id=a.job_id
     WHERE j.batch_id=$1
       AND convert_from(i.manifest_bytes,'UTF8')::jsonb->>'schema_version'='bench-intake-input/7'
       AND (p.relies_on->'sources' @> jsonb_build_array(jsonb_build_object(
              'kind','evidence_observation','evidence_observation_id',$2::text))
            -- Examine's markings of the observation, verbatim, rest on its reading too.
            OR jsonb_path_exists(convert_from(p.value_bytes,'UTF8')::jsonb,
              '$.markings[*] ? (@.observation_id == $id)', jsonb_build_object('id', $2::text)))
       AND NOT EXISTS (SELECT 1 FROM public.processing_proposal_stale s WHERE s.proposal_id=p.id)
     ORDER BY p.id`,
    [input.batchId, input.observationId],
  )
  const ids = relying.rows.map((row) => row.id)
  if (ids.length) {
    await client.query(
      `INSERT INTO public.processing_proposal_stale(proposal_id,reason)
       SELECT unnest($1::uuid[]),$2 ON CONFLICT DO NOTHING`,
      [ids, reason],
    )
  }
  // Everything built on them is stale too; each session is told once, below, with all of it.
  const relied = byLineage(relying.rows)
  const cascaded = ids.length ? await cascadeAll(client, ids, reason, context, relied) : []
  await addPinned(client, input.batchId, [...ids, ...cascaded], relied)
  const lot = await client.query<{ lot_id: string }>(
    `SELECT lot_id FROM public.capture_lot_evidence_observation
     WHERE evidence_observation_id=$1 AND status='active'`,
    [input.observationId],
  )
  for (const row of lot.rows) {
    for (const lineage of await lotSessions(client, row.lot_id)) {
      relied.set(lineage, relied.get(lineage) ?? [])
    }
  }
  const lead = await leadSession(client, input.batchId)
  if (lead) {
    relied.set(lead, relied.get(lead) ?? [])
  }
  const corrected: RevisionChangeDto[] = [
    ...(input.reading
      ? [
          {
            kind: 'reading' as const,
            observation_id: input.observationId,
            reading_from: input.reading.before,
            reading_to: input.reading.after,
          },
        ]
      : []),
    ...(input.region
      ? [
          {
            kind: 'region' as const,
            observation_id: input.observationId,
            region_from: input.region.before,
            region_to: input.region.after,
          },
        ]
      : []),
    ...(input.sameItem
      ? [
          {
            kind: 'same_item' as const,
            observation_id: input.sameItem.observationId,
            same_as_from: input.sameItem.before,
            same_as_to: input.sameItem.after,
          },
        ]
      : []),
    ...(input.joined
      ? [
          {
            kind: 'observation' as const,
            observation_id: input.observationId,
            lot_from: null,
            lot_to: input.joined,
          },
        ]
      : []),
    ...(input.count
      ? [
          {
            kind: 'count' as const,
            observation_id: input.observationId,
            count_from: input.count.before,
            count_to: input.count.after,
          },
        ]
      : []),
  ]
  const notified: string[] = []
  for (const lineage of [...relied.keys()].sort()) {
    // Only `/7` sessions are told of a corrected reading; earlier ones keep today's notices.
    const facts = await lineageFacts(client, lineage)
    if (facts?.inputVersion !== 'bench-intake-input/7') {
      continue
    }
    await notifyRevision(
      client,
      lineage,
      `reading:${input.observationId}:${input.revision}:${lineage}`,
      {
        fields: ['markings', 'identity'],
        reason: correctionReason(origin, lineage === lead),
        changes: [...corrected, ...(await staleChanges(client, relied.get(lineage)!, reason))],
      },
      context,
    )
    notified.push(lineage)
  }
  return { stale: ids, notified }
}

function correctionReason(origin: RevisionContext['origin'], lead: boolean) {
  if (origin.by === 'session') {
    return 'Examine revised an observation’s reading; revise what relied on its earlier reading.'
  }
  return lead
    ? 'The operator corrected an observation’s reading; look at its lot again.'
    : 'The operator corrected a reading this lot relies on; revise what relied on it.'
}

/**
 * Restored items reach the Examine lead as new evidence, keyed by the restore revision: the
 * Examine trigger skips versions the lead has already seen, observed or pinned.
 */
export async function evidenceRestored(
  client: PoolClient,
  input: {
    batchId: string
    versions: readonly { evidenceId: string; versionId: string }[]
    revision: string
  },
) {
  if (!(await processingVisible(client))) {
    return [] as string[]
  }
  const lead = await leadSession(client, input.batchId)
  if (!lead) {
    return []
  }
  for (const version of input.versions) {
    await evidenceNotice(client, lead, `restored:${version.evidenceId}:${input.revision}`, {
      evidence_id: version.evidenceId,
      version_id: version.versionId,
    })
  }
  return [lead]
}
