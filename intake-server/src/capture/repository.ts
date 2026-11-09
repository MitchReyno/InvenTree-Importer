import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { streams } from '../db/schema.ts'
import {
  captureBatches,
  captureSubjects,
  captureObservations,
  captureSources,
  captureParts,
  captureLots,
  captureNotes,
  captureSelections,
  captureRevisions,
  captureEditPublications,
  captureLotRetirements,
} from './schema.ts'
import {
  RecordEditError,
  applyRecordChange,
  validate,
  type CaptureEditDto,
  type CaptureLotContextDto,
  type CaptureListQueryDto,
  type CaptureSnapshotDto,
  type CaptureObservationDto,
} from '@invimport/contracts'
import { canonical, canonicalRecord } from '@invimport/contracts/json'
import type { DevConfig } from '../config.ts'
import { transaction } from '../db/database.ts'
import { validatePartSpec, PartSpecError } from './part-spec.ts'
import { readCaptureContexts, retainCaptureContext } from './context.ts'
import { applyGroupLocation, readGroupLocations } from './locations.ts'
import {
  applyBatchSettingsIntent,
  readReferenceDrafts,
  readSettingNotes,
  readSettingsIntent,
} from './settings-intent.ts'
import { appendEvent, idempotent, sha256 } from '../db/authority.ts'
import { readEvidenceObservations } from './evidence-observation-read.ts'
import {
  applyObservationEdit,
  currentLotItemCount,
  markLotEdited,
  observationLot,
} from './evidence-observations.ts'

export class CaptureError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
  ) {
    super(code)
  }
}

export function fail(code: string, status = 422): never {
  throw new CaptureError(status, code)
}

export type CaptureBinding = Pick<DevConfig, 'actorId' | 'targetId' | 'targetContextId'>
type Binding = CaptureBinding
type Batch = {
  id: string
  source_id: string
  actor_id: string
  target_id: string
  target_context_id: string
  title: string
  revision: string
  archived: boolean
  stream_id: string
  updated_at: Date
}
type Subject = { id: string; label: string; revision: string; kind: 'lot' | 'part' }
type Selection =
  | CaptureSnapshotDto['lots'][number]['location']
  | CaptureSnapshotDto['lots'][number]['quantity']
  | CaptureSnapshotDto['parts'][number]['choice']
const unset = { mode: 'unset' } as const
const inherit = { mode: 'inherit' } as const

const batchColumns = {
  id: captureBatches.id,
  source_id: captureBatches.sourceId,
  actor_id: captureBatches.actorId,
  target_id: captureBatches.targetId,
  target_context_id: captureBatches.targetContextId,
  title: captureBatches.title,
  revision: sql<string>`${captureBatches.revision}::text`,
  archived: captureBatches.archived,
  stream_id: captureBatches.streamId,
  updated_at: captureBatches.updatedAt,
}

/** Every lookup is actor AND fixed target/context scoped, including archived reads. */
async function batch(
  client: PoolClient,
  config: Binding,
  id: string,
  lock = false,
): Promise<Batch> {
  const query = queryDatabase(client)
    .select(batchColumns)
    .from(captureBatches)
    .where(
      and(
        eq(captureBatches.id, id),
        eq(captureBatches.actorId, config.actorId),
        eq(captureBatches.targetId, config.targetId),
        eq(captureBatches.targetContextId, config.targetContextId),
      ),
    )
  const rows = await executeDatabaseQuery(lock ? query.for('update') : query)
  return rows[0] ?? fail('not_found', 404)
}

const summary = (b: Batch) => ({
  id: b.id,
  source_id: b.source_id,
  title: b.title,
  revision: b.revision,
  archived: b.archived,
  updated_at: b.updated_at.toISOString(),
})

async function snapshot(
  client: PoolClient,
  config: Binding,
  id: string,
): Promise<CaptureSnapshotDto> {
  const b = await batch(client, config, id)
  const subjects = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        id: captureSubjects.id,
        label: captureSubjects.label,
        revision: sql<string>`${captureSubjects.revision}::text`,
        kind: captureSubjects.kind,
      })
      .from(captureSubjects)
      .where(eq(captureSubjects.batchId, id))
      .orderBy(captureSubjects.id),
  )
  const selections = await executeDatabaseQuery(
    queryDatabase(client)
      .selectDistinctOn([captureSelections.subjectId, captureSelections.field], {
        subject_id: captureSelections.subjectId,
        field: captureSelections.field,
        value: captureSelections.value,
      })
      .from(captureSelections)
      .where(eq(captureSelections.batchId, id))
      .orderBy(
        captureSelections.subjectId,
        captureSelections.field,
        desc(captureSelections.version),
      ),
  )

  const value = (subject: string | null, field: string, fallback: Selection) =>
    selections.find((s) => s.subject_id === subject && s.field === field)?.value ?? fallback

  // A Part assignment is omitted unless set or cleared, so existing Part bytes are unchanged.
  const partLocation = (location: Selection) =>
    location.mode === 'set' || location.mode === 'clear' ? { location } : {}

  const lots = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        id: captureLots.id,
        contribution_key: captureLots.contributionKey,
        part_subject_id: captureLots.partSubjectId,
        origin: captureLots.origin,
        agent_session_id: captureLots.agentSessionId,
        operator_edited: captureLots.operatorEdited,
        reexamine: captureLots.reexamine,
        excluded_reason: captureLots.excludedReason,
        excluded_at: captureLots.excludedAt,
        formed_at: captureLots.formedAt,
        estimated_quantity: captureLots.estimatedQuantity,
        quantity_basis: captureLots.quantityBasis,
        observation_set_version: captureLots.observationSetVersion,
      })
      .from(captureLots)
      .where(eq(captureLots.batchId, id))
      .orderBy(captureLots.id),
  )
  const retiredResult = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ lot_id: captureLotRetirements.lotId })
      .from(captureLotRetirements)
      .where(eq(captureLotRetirements.batchId, id)),
  )
  const retiredLots = new Set(retiredResult.map((row) => row.lot_id))
  const notes = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        id: captureNotes.id,
        subject_id: captureNotes.subjectId,
        text: captureNotes.text,
        actor_id: captureNotes.actorId,
        created_at: captureNotes.createdAt,
      })
      .from(captureNotes)
      .where(eq(captureNotes.batchId, id))
      .orderBy(captureNotes.createdAt, captureNotes.id),
  )
  const observations = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        id: captureObservations.id,
        model: captureObservations.model,
        pk: captureObservations.pk,
        target_context_id: captureObservations.targetContextId,
        label: captureObservations.label,
        observed_at: captureObservations.observedAt,
        mapping: captureObservations.mapping,
      })
      .from(captureObservations)
      .where(eq(captureObservations.batchId, id))
      .orderBy(asc(captureObservations.observedAt), asc(captureObservations.id)),
  )
  const streamRows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ head: streams.head })
      .from(streams)
      .where(eq(streams.id, b.stream_id)),
  )
  const cursor = streamRows[0].head.toString()
  const context = await readCaptureContexts(client, id)
  const settingsIntent = await readSettingsIntent(client, id)
  const settingNotes = await readSettingNotes(client, id)
  const referenceDrafts = await readReferenceDrafts(client, id)
  const groupLocations = await readGroupLocations(client, id)
  const evidence = await readEvidenceObservations(client, id)
  const result = {
    ...summary(b),
    ...(context.length ? { context } : {}),
    // Optional additive fields are omitted when absent so legacy snapshot bytes are unchanged.
    ...(settingsIntent ? { settings_intent: settingsIntent } : {}),
    ...(settingNotes.length ? { setting_notes: settingNotes } : {}),
    ...(referenceDrafts.length ? { reference_drafts: referenceDrafts } : {}),
    ...(groupLocations.length ? { group_locations: groupLocations } : {}),
    actor_id: b.actor_id,
    target_context_id: b.target_context_id,
    defaults: {
      quantity: value(null, 'quantity', unset),
      location: value(null, 'location', unset),
    },
    parts: subjects
      .filter((s) => s.kind === 'part')
      .map((s) => ({
        id: s.id,
        label: s.label,
        revision: s.revision,
        choice: value(s.id, 'choice', unset),
        ...partLocation(value(s.id, 'location', unset) as Selection),
      })),
    lots: lots.map((l) => {
      const s = subjects.find((s) => s.id === l.id)!
      const {
        origin,
        agent_session_id,
        operator_edited,
        reexamine,
        excluded_reason,
        excluded_at,
        formed_at,
        estimated_quantity,
        quantity_basis,
        observation_set_version,
        ...lot
      } = l
      const members = evidence.activeByLot.get(l.id) ?? []
      // Lot-forming fields are omitted for operator lots so legacy snapshot bytes are unchanged.
      const forming = {
        ...(origin === 'agent' && agent_session_id
          ? { origin: 'agent' as const, agent_session_id }
          : {}),
        ...(operator_edited && origin === 'agent' ? { operator_edited: true as const } : {}),
        ...(reexamine ? { reexamine: true as const } : {}),
        ...(excluded_reason && excluded_at
          ? { excluded: { reason: excluded_reason, at: excluded_at.toISOString() } }
          : {}),
        ...(formed_at ? { formed_at: formed_at.toISOString() } : {}),
        ...(estimated_quantity ? { estimated_quantity } : {}),
        ...(quantity_basis ? { quantity_basis } : {}),
        ...(members.length ? { evidence_observation_ids: members } : {}),
        ...(observation_set_version > 0n
          ? { observation_set_version: observation_set_version.toString() }
          : {}),
      }
      return {
        ...lot,
        ...forming,
        label: s.label,
        revision: s.revision,
        quantity: value(l.id, 'quantity', inherit),
        location: value(l.id, 'location', inherit),
        // Active lots omit the field so their snapshot bytes are unchanged.
        ...(retiredLots.has(l.id) ? { retired: true as const } : {}),
      }
    }),
    notes: notes.map((n) => ({ ...n, created_at: n.created_at.toISOString(), producer: 'human' })),
    ...(evidence.observations.length ? { evidence_observations: evidence.observations } : {}),
    observations: observations.map(({ mapping, ...o }) => ({
      ...o,
      ...(mapping ? { mapping } : {}),
      observed_at: o.observed_at.toISOString(),
    })),
    cursor: { stream_id: b.stream_id, sequence: cursor },
  }
  validate('CaptureSnapshot', result)
  if (Buffer.byteLength(canonicalRecord(result)) > 245760) {
    fail('capture_capacity', 409)
  }
  // The complete runtime DTO check above is the narrowing boundary for SQL JSONB.
  return result as CaptureSnapshotDto
}

async function retainRevision(c: PoolClient, b: Batch, payload: unknown, publish = true) {
  const bytes = Buffer.from(canonicalRecord(payload))
  await executeDatabaseQuery(
    queryDatabase(c)
      .insert(captureRevisions)
      .values({
        batchId: b.id,
        revision: BigInt(b.revision),
        actorId: b.actor_id,
        commandBytes: bytes,
        commandDigest: sha256(bytes),
      }),
  )
  if (publish) {
    await appendEvent(c, b.stream_id, 'capture_changed', { batch_id: b.id, revision: b.revision })
  }
}

async function note(c: PoolClient, b: Batch, subject: string | null, text: string) {
  await executeDatabaseQuery(
    queryDatabase(c)
      .insert(captureNotes)
      .values({ id: randomUUID(), batchId: b.id, subjectId: subject, text, actorId: b.actor_id }),
  )
}

/** Transaction-bound public capture seam. Callers acquire target/source locks first.
 * The original key is derived only from retained native lineage, never caller aliases.
 */
export async function captureInTransaction(
  client: PoolClient,
  config: CaptureBinding,
  batchId: string,
  lock = false,
) {
  const retained = await batch(client, config, batchId, lock)
  const sourceResult = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ namespace_key: captureSources.namespaceKey, created_by: captureSources.createdBy })
      .from(captureSources)
      .where(eq(captureSources.id, retained.source_id)),
  )
  const source = sourceResult[0]
  if (
    !source ||
    source.namespace_key !== `native_batch:${retained.source_id}` ||
    source.created_by !== retained.actor_id
  ) {
    fail('native_source_binding_invalid', 409)
  }
  return {
    snapshot: await snapshot(client, config, batchId),
    sourceId: retained.source_id,
    originalSourceKey: retained.source_id,
    streamId: retained.stream_id,
  }
}

async function lockCaptureSubjectHeads(client: PoolClient, batchId: string): Promise<Subject[]> {
  return executeDatabaseQuery(
    queryDatabase(client)
      .select({
        id: captureSubjects.id,
        label: captureSubjects.label,
        revision: sql<string>`${captureSubjects.revision}::text`,
        kind: captureSubjects.kind,
      })
      .from(captureSubjects)
      .where(eq(captureSubjects.batchId, batchId))
      .orderBy(captureSubjects.id)
      .for('update'),
  )
}

/** Lock live capture facts before media or job locks without opening an edit/publication lifecycle. */
export async function lockCaptureForInputs(
  client: PoolClient,
  config: CaptureBinding,
  batchId: string,
  expectedRevision?: string,
) {
  const capture = await captureInTransaction(client, config, batchId, true)
  if (capture.snapshot.archived) {
    fail('batch_archived', 409)
  }
  if (expectedRevision !== undefined && capture.snapshot.revision !== expectedRevision) {
    fail('revision_conflict', 412)
  }
  await lockCaptureSubjectHeads(client, batchId)
  return capture
}

/** Archived work may settle its exact held lane; this seam grants no capture edit capability. */
export async function lockCaptureForInputSettlement(
  client: PoolClient,
  config: CaptureBinding,
  batchId: string,
) {
  const capture = await captureInTransaction(client, config, batchId, true)
  await lockCaptureSubjectHeads(client, batchId)
  return capture
}

type SelectionField = 'quantity' | 'location' | 'choice'

/** Omission is not unset, unknown, clear or inherit; references must match a retained observation. */
async function insertSelection(
  c: PoolClient,
  b: Batch,
  subjectId: string | null,
  field: SelectionField,
  value: Selection | undefined,
  version: string,
  /** Observations already read in this transaction, so a record edit reads them once. */
  known?: readonly CaptureObservationDto[],
) {
  if (value === undefined) {
    return
  }
  if (subjectId === null && value.mode === 'inherit') {
    fail('default_cannot_inherit')
  }
  if (value.mode === 'create') {
    if (field !== 'choice') {
      fail('invalid_part_creation')
    }
    const observations =
      known ??
      (
        await snapshot(
          c,
          { actorId: b.actor_id, targetId: b.target_id, targetContextId: b.target_context_id },
          b.id,
        )
      ).observations
    try {
      validatePartSpec(value.spec, b.target_context_id, observations)
    } catch (error) {
      if (error instanceof PartSpecError) {
        fail(error.code)
      }
      throw error
    }
  }
  let observation: string | null = null
  if (value.mode === 'set' && field !== 'quantity') {
    if (typeof value.value !== 'object' || value.value === null) {
      fail('invalid_reference')
    }
    const ref = value.value
    if (
      ref.model !== (field === 'choice' ? 'part' : 'location') ||
      ref.target_context_id !== b.target_context_id
    ) {
      fail('invalid_reference')
    }
    const found = await executeDatabaseQuery(
      queryDatabase(c)
        .select({ id: captureObservations.id })
        .from(captureObservations)
        .where(
          and(
            eq(captureObservations.batchId, b.id),
            eq(captureObservations.id, ref.observation_id),
            eq(captureObservations.targetId, b.target_id),
            eq(captureObservations.targetContextId, ref.target_context_id),
            eq(captureObservations.model, ref.model),
            eq(captureObservations.pk, ref.pk),
          ),
        ),
    )
    if (!found.length) {
      fail('invalid_reference')
    }
    observation = ref.observation_id
  }
  await executeDatabaseQuery(
    queryDatabase(c)
      .insert(captureSelections)
      .values({
        id: randomUUID(),
        batchId: b.id,
        subjectId,
        field,
        version: BigInt(version),
        value,
        observationId: observation,
        actorId: b.actor_id,
      }),
  )
}

async function applyLockedCaptureEdit(
  c: PoolClient,
  b: Batch,
  subjects: Subject[],
  input: CaptureEditDto,
) {
  const id = b.id
  const change = input.change
  if (b.archived && !(change.kind === 'batch' && change.archived === false)) {
    fail('batch_archived', 409)
  }

  const subject = (subjectId: string, kind?: Subject['kind']) =>
    subjects.find((s) => s.id === subjectId && (!kind || s.kind === kind)) ??
    fail('subject_not_found', 404)

  const retiredResult = await executeDatabaseQuery(
    queryDatabase(c)
      .select({ lot_id: captureLotRetirements.lotId })
      .from(captureLotRetirements)
      .where(eq(captureLotRetirements.batchId, id)),
  )
  const retired = new Set(retiredResult.map((row) => row.lot_id))
  let editedSubject: string | null = null
  if (change.kind === 'lot') {
    editedSubject = change.id
  } else if (change.kind === 'lot_exclusion') {
    editedSubject = change.lot_id
  } else if (change.kind === 'note') {
    editedSubject = change.subject_id
  } else if (change.kind === 'settings') {
    if (change.note_subject_id !== undefined && change.note === undefined) {
      fail('note_text_required', 400)
    }
    editedSubject = change.note_subject_id ?? null
    if (editedSubject !== null) {
      subject(editedSubject)
    }
  }
  if (editedSubject !== null && retired.has(editedSubject)) {
    fail('lot_retired', 409)
  }

  const checkPart = (partId: string | null) => {
    if (partId !== null) {
      subject(partId, 'part')
    }
  }

  const nextRevision = (BigInt(b.revision) + 1n).toString()

  const select = (subjectId: string | null, field: SelectionField, value: Selection | undefined) =>
    insertSelection(c, b, subjectId, field, value, nextRevision)

  const retainContext = (subjectId: string | null, value: CaptureLotContextDto) =>
    retainCaptureContext(
      c,
      {
        batchId: id,
        actorId: b.actor_id,
        targetId: b.target_id,
        targetContextId: b.target_context_id,
      },
      subjectId,
      nextRevision,
      value,
    )

  const intentRetained = (await readSettingsIntent(c, id)) !== undefined
  const legacyLocationWrite =
    (change.kind === 'settings' || change.kind === 'defaults') && change.location !== undefined
  const legacyContextWrite = change.kind === 'settings' && change.context !== undefined
  if (intentRetained && (legacyLocationWrite || legacyContextWrite)) {
    // Legacy clients cannot see intent; their batch-level writes would silently diverge from it.
    fail('settings_intent_superseded', 409)
  }

  switch (change.kind) {
    case 'batch_settings':
      await applyBatchSettings(c, b, change, nextRevision)
      break
    case 'settings':
      await executeDatabaseQuery(
        queryDatabase(c)
          .update(captureBatches)
          .set({ title: sql`coalesce(${change.title ?? null}, ${captureBatches.title})` })
          .where(eq(captureBatches.id, id)),
      )
      await select(null, 'quantity', change.quantity)
      await select(null, 'location', change.location)
      if (change.context !== undefined) {
        await retainContext(null, change.context)
      }
      if (change.note !== undefined) {
        await note(c, b, change.note_subject_id ?? null, change.note)
      }
      break
    case 'batch':
      await executeDatabaseQuery(
        queryDatabase(c)
          .update(captureBatches)
          .set({
            title: sql`coalesce(${change.title ?? null}, ${captureBatches.title})`,
            archived: sql`coalesce(${change.archived ?? null}, ${captureBatches.archived})`,
          })
          .where(eq(captureBatches.id, id)),
      )
      break
    case 'add_part':
    case 'add_lot': {
      if (subjects.length >= 100) {
        fail('capture_capacity', 409)
      }
      const sid = randomUUID()
      const kind = change.kind === 'add_part' ? 'part' : 'lot'
      await executeDatabaseQuery(
        queryDatabase(c)
          .insert(captureSubjects)
          .values({ batchId: id, id: sid, kind, label: change.label }),
      )
      if (change.kind === 'add_part') {
        await executeDatabaseQuery(
          queryDatabase(c).insert(captureParts).values({ batchId: id, id: sid }),
        )
      } else {
        checkPart(change.part_subject_id)
        await executeDatabaseQuery(
          queryDatabase(c).insert(captureLots).values({
            batchId: id,
            id: sid,
            sourceId: b.source_id,
            contributionKey: randomUUID(),
            partSubjectId: change.part_subject_id,
          }),
        )
        await note(c, b, sid, change.note)
      }
      break
    }
    case 'lot':
      subject(change.id, 'lot')
      // Any operator change to a lot keeps the lead session to suggestions for it.
      await markLotEdited(c, change.id, BigInt(nextRevision))
      if (change.part_subject_id !== undefined) {
        checkPart(change.part_subject_id)
        await executeDatabaseQuery(
          queryDatabase(c)
            .update(captureLots)
            .set({ partSubjectId: change.part_subject_id })
            .where(eq(captureLots.id, change.id)),
        )
      }
      if (change.context !== undefined) {
        await retainContext(change.id, change.context)
      }
      await select(change.id, 'quantity', change.quantity)
      await select(change.id, 'location', change.location)
      await executeDatabaseQuery(
        queryDatabase(c)
          .update(captureSubjects)
          .set({
            label: sql`coalesce(${change.label ?? null}, ${captureSubjects.label})`,
            revision: sql`${captureSubjects.revision}+1`,
          })
          .where(eq(captureSubjects.id, change.id)),
      )
      break
    case 'lot_exclusion':
      subject(change.lot_id, 'lot')
      // An approval may already be importing the lot, so it can no longer be excluded.
      if (change.reason !== null) {
        const [lot] = await executeDatabaseQuery(
          queryDatabase(c)
            .select({ key: captureLots.contributionKey })
            .from(captureLots)
            .where(eq(captureLots.id, change.lot_id)),
        )
        // A deployment that cannot read the executor's history has no executor, so no approvals.
        const privilege = await executeDatabaseQuery(
          queryDatabase(c).execute<{ executor: boolean }>(
            sql`SELECT has_table_privilege('executor_run', 'SELECT') AS executor`,
          ),
        )
        const executor = privilege.rows[0]?.executor === true
        if (executor) {
          // Loaded on use: execution depends on capture, so capture must not import it eagerly.
          const { stockSourceHistory } = await import('../execution/source.ts')
          const history = await stockSourceHistory(
            c,
            { targetId: b.target_id, sourceId: b.source_id, originalSourceKey: b.source_id },
            [lot.key],
          )
          if (history.contributions.length) {
            fail('lot_already_approved', 409)
          }
        }
      }
      await executeDatabaseQuery(
        queryDatabase(c)
          .update(captureLots)
          .set(
            change.reason === null
              ? { excludedReason: null, excludedAt: null }
              : { excludedReason: change.reason, excludedAt: sql`now()` },
          )
          .where(eq(captureLots.id, change.lot_id)),
      )
      break
    case 'part':
      subject(change.id, 'part')
      await select(change.id, 'choice', change.choice)
      await select(change.id, 'location', change.location)
      await executeDatabaseQuery(
        queryDatabase(c)
          .update(captureSubjects)
          .set({
            label: sql`coalesce(${change.label ?? null}, ${captureSubjects.label})`,
            revision: sql`${captureSubjects.revision}+1`,
          })
          .where(eq(captureSubjects.id, change.id)),
      )
      break
    case 'group_location':
      await applyGroupLocation(c, b, change.group_id, change.location, nextRevision)
      break
    case 'defaults':
      await select(null, 'quantity', change.quantity)
      await select(null, 'location', change.location)
      break
    case 'note':
      if (change.subject_id !== null) {
        subject(change.subject_id)
      }
      await note(c, b, change.subject_id, change.text)
      break
    case 'record':
      await applyRecordEdit(c, b, change, nextRevision)
      break
    case 'observation':
    case 'observation_move':
    case 'observation_suggestion':
      await applyObservationEdit(c, id, change, nextRevision)
      break
    case 'observation_same_item': {
      const lotId = await observationLot(c, id, change.observation_id)
      const before = lotId ? await currentLotItemCount(c, id, lotId) : null
      await applyObservationEdit(c, id, change, nextRevision)
      if (lotId && before !== null) {
        // A quantity equal to the counts was taken from them, so it follows them; any other
        // quantity is the operator's own and stays.
        const after = await currentLotItemCount(c, id, lotId)
        const quantity = await lotQuantity(c, id, lotId)
        if (after && after !== before && quantity?.mode === 'set' && Number(quantity.value) === before) {
          await select(lotId, 'quantity', { mode: 'set', value: String(after) })
        }
      }
      break
    }
  }
  b.revision = nextRevision
  await executeDatabaseQuery(
    queryDatabase(c)
      .update(captureBatches)
      .set({ revision: BigInt(b.revision), updatedAt: sql`now()` })
      .where(eq(captureBatches.id, id)),
  )
  await retainRevision(c, b, input, false)
}

/** A lot's current quantity selection; unset when it has none. */
async function lotQuantity(c: PoolClient, batchId: string, lotId: string): Promise<Selection> {
  const rows = await executeDatabaseQuery(
    queryDatabase(c)
      .select({ value: captureSelections.value })
      .from(captureSelections)
      .where(
        and(
          eq(captureSelections.batchId, batchId),
          eq(captureSelections.subjectId, lotId),
          eq(captureSelections.field, 'quantity'),
        ),
      )
      .orderBy(desc(captureSelections.version))
      .limit(1),
  )
  return (rows[0]?.value as Selection | undefined) ?? unset
}

type RecordChange = Extract<CaptureEditDto['change'], { kind: 'record' }>

/** One record edit rewrites every affected Part's spec as a new choice version, in one revision. */
async function applyRecordEdit(
  c: PoolClient,
  b: Batch,
  change: RecordChange,
  nextRevision: string,
) {
  const current = await snapshot(
    c,
    { actorId: b.actor_id, targetId: b.target_id, targetContextId: b.target_context_id },
    b.id,
  )
  let specs
  try {
    specs = applyRecordChange(current, change).specs
  } catch (error) {
    if (error instanceof RecordEditError) {
      fail(error.code)
    }
    throw error
  }
  for (const [partId, spec] of specs) {
    try {
      validate('InventoryPartSpec', spec)
    } catch {
      fail('invalid_part_spec')
    }
    await insertSelection(
      c,
      b,
      partId,
      'choice',
      { mode: 'create', spec },
      nextRevision,
      current.observations,
    )
    await executeDatabaseQuery(
      queryDatabase(c)
        .update(captureSubjects)
        .set({ revision: sql`${captureSubjects.revision}+1` })
        .where(eq(captureSubjects.id, partId)),
    )
  }
}

type BatchSettingsChange = Extract<CaptureEditDto['change'], { kind: 'batch_settings' }>

/** Complete-state settings: Default location selection here, retained intent in its owner. */
async function applyBatchSettings(
  c: PoolClient,
  b: Batch,
  change: BatchSettingsChange,
  nextRevision: string,
) {
  const binding = {
    actorId: b.actor_id,
    targetId: b.target_id,
    targetContextId: b.target_context_id,
  }
  const current = await snapshot(c, binding, b.id)
  await executeDatabaseQuery(
    queryDatabase(c)
      .update(captureBatches)
      .set({ title: change.title })
      .where(eq(captureBatches.id, b.id)),
  )

  const requested = change.default_location
  const selection: Selection = requested.mode === 'draft' ? unset : requested
  if (canonical(selection) !== canonical(current.defaults.location)) {
    await insertSelection(c, b, null, 'location', selection, nextRevision)
  }

  const batchContext = current.context?.find((record) => record.subject_id === null)
  await applyBatchSettingsIntent(
    c,
    { batchId: b.id, ...binding },
    change,
    batchContext,
    nextRevision,
  )
}

export interface LockedCaptureEdit {
  /** Internal pre-publication facts. Use readPublished for a public response cursor. */
  snapshot: CaptureSnapshotDto
  streamId: string
  apply(input: CaptureEditDto): Promise<CaptureSnapshotDto>
  publish(): Promise<void>
  readPublished(): Promise<CaptureSnapshotDto>
}

/** Acquire all capture locks before a consumer locks processing jobs, attempts or questions. */
export async function lockCaptureForEdit(
  client: PoolClient,
  config: CaptureBinding,
  batchId: string,
  expectedRevision: string,
): Promise<LockedCaptureEdit> {
  const retained = await batch(client, config, batchId, true)
  if (retained.revision !== expectedRevision) {
    fail('revision_conflict', 412)
  }
  const subjects = await lockCaptureSubjectHeads(client, batchId)
  const initialSnapshot = await snapshot(client, config, batchId)
  let phase: 'locked' | 'applied' | 'published' = 'locked'
  const publicationId = randomUUID()

  return {
    snapshot: initialSnapshot,
    streamId: retained.stream_id,

    async apply(input) {
      if (phase !== 'locked') {
        fail('capture_edit_already_applied')
      }
      validate('CaptureEdit', input)
      if (input.expected_revision !== expectedRevision) {
        fail('revision_conflict', 412)
      }
      await applyLockedCaptureEdit(client, retained, subjects, input)
      await executeDatabaseQuery(
        queryDatabase(client)
          .insert(captureEditPublications)
          .values({ id: publicationId, batchId }),
      )
      phase = 'applied'
      return snapshot(client, config, batchId)
    },

    async publish() {
      if (phase !== 'applied') {
        fail('capture_edit_publication_order')
      }
      await appendEvent(client, retained.stream_id, 'capture_changed', {
        batch_id: batchId,
        revision: retained.revision,
      })
      await executeDatabaseQuery(
        queryDatabase(client)
          .delete(captureEditPublications)
          .where(eq(captureEditPublications.id, publicationId)),
      )
      phase = 'published'
    },

    async readPublished() {
      if (phase !== 'published') {
        fail('capture_edit_publication_required')
      }
      return snapshot(client, config, batchId)
    },
  }
}

/** A locked agent write: the batch row is held until the caller's transaction ends. */
export interface AgentCaptureWrite {
  batchId: string
  sourceId: string
  revision: string
  nextRevision: string
  subjects: Subject[]
  /** Advances the batch revision, retains the command attributed to the session and publishes. */
  finish(payload: unknown, sessionId: string): Promise<string>
}

/**
 * Agent writes skip the batch-wide expected-revision check of operator edits: they lock the rows
 * they touch instead, so an unrelated operator edit does not make them stale (design D8).
 */
export async function lockCaptureForAgentWrite(
  client: PoolClient,
  config: CaptureBinding,
  batchId: string,
): Promise<AgentCaptureWrite> {
  const retained = await batch(client, config, batchId, true)
  if (retained.archived) {
    fail('batch_archived', 409)
  }
  const subjects = await lockCaptureSubjectHeads(client, batchId)
  const nextRevision = (BigInt(retained.revision) + 1n).toString()
  return {
    batchId,
    sourceId: retained.source_id,
    revision: retained.revision,
    nextRevision,
    subjects,
    async finish(payload, sessionId) {
      await executeDatabaseQuery(
        queryDatabase(client)
          .update(captureBatches)
          .set({ revision: BigInt(nextRevision), updatedAt: sql`now()` })
          .where(eq(captureBatches.id, batchId)),
      )
      // The same projection and size check as operator edits: a write that would make the
      // batch unreadable is refused and rolls back.
      try {
        await snapshot(client, config, batchId)
      } catch (error) {
        // Only an over-limit projection is capacity; anything else stays an unexpected failure.
        if (error instanceof Error && error.message === 'invalid_contract') {
          fail('capture_capacity', 409)
        }
        throw error
      }
      const bytes = Buffer.from(canonicalRecord(payload))
      await executeDatabaseQuery(
        queryDatabase(client)
          .insert(captureRevisions)
          .values({
            batchId,
            revision: BigInt(nextRevision),
            actorId: retained.actor_id,
            agentSessionId: sessionId,
            commandBytes: bytes,
            commandDigest: sha256(bytes),
          }),
      )
      await appendEvent(client, retained.stream_id, 'capture_changed', {
        batch_id: batchId,
        revision: nextRevision,
      })
      return nextRevision
    },
  }
}

/** Facts an operator command may change while it holds the batch and subject locks. */
export interface OperatorCommandScope {
  batchId: string
  sourceId: string
  actorId: string
  streamId: string
  nextRevision: string
  snapshot: CaptureSnapshotDto
  retiredLotIds: ReadonlySet<string>
  /** Every subject, including retired lots, counts toward the batch capacity. */
  subjectCount: number
  setSelection(
    subjectId: string,
    field: 'quantity' | 'location',
    value: Selection | undefined,
  ): Promise<void>
  addLot(label: string, partSubjectId: string | null): Promise<string>
  addPart(label: string): Promise<string>
  setContext(lotId: string, value: CaptureLotContextDto): Promise<void>
  setLotPart(lotId: string, partSubjectId: string | null): Promise<void>
  touchSubject(subjectId: string): Promise<void>
  /** Bumps the batch revision, retains exact command bytes and publishes one event. */
  commit(command: unknown): Promise<CaptureSnapshotDto>
}

const MAX_CAPTURE_SUBJECTS = 100

/** Lock a batch for a T08 operator command with the same revision and archive rules as edits. */
export async function lockCaptureForOperatorCommand(
  client: PoolClient,
  config: CaptureBinding,
  batchId: string,
  expectedRevision: string,
): Promise<OperatorCommandScope> {
  const retained = await batch(client, config, batchId, true)
  if (retained.revision !== expectedRevision) {
    fail('revision_conflict', 412)
  }
  if (retained.archived) {
    fail('batch_archived', 409)
  }
  const subjects = await lockCaptureSubjectHeads(client, batchId)
  const retiredResult = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ lot_id: captureLotRetirements.lotId })
      .from(captureLotRetirements)
      .where(eq(captureLotRetirements.batchId, batchId)),
  )
  const nextRevision = (BigInt(retained.revision) + 1n).toString()
  let subjectCount = subjects.length

  async function addSubject(kind: 'lot' | 'part', label: string) {
    if (subjectCount >= MAX_CAPTURE_SUBJECTS) {
      fail('capture_capacity', 409)
    }
    const id = randomUUID()
    await executeDatabaseQuery(
      queryDatabase(client).insert(captureSubjects).values({ batchId, id, kind, label }),
    )
    subjectCount += 1
    return id
  }

  return {
    batchId,
    sourceId: retained.source_id,
    actorId: retained.actor_id,
    streamId: retained.stream_id,
    nextRevision,
    snapshot: await snapshot(client, config, batchId),
    retiredLotIds: new Set(retiredResult.map((row) => row.lot_id)),
    get subjectCount() {
      return subjectCount
    },

    setSelection: (subjectId, field, value) =>
      insertSelection(client, retained, subjectId, field, value, nextRevision),

    async addLot(label, partSubjectId) {
      const id = await addSubject('lot', label)
      await executeDatabaseQuery(
        queryDatabase(client).insert(captureLots).values({
          batchId,
          id,
          sourceId: retained.source_id,
          contributionKey: randomUUID(),
          partSubjectId,
        }),
      )
      return id
    },

    async addPart(label) {
      const id = await addSubject('part', label)
      await executeDatabaseQuery(queryDatabase(client).insert(captureParts).values({ batchId, id }))
      return id
    },

    setContext: (lotId, value) =>
      retainCaptureContext(
        client,
        {
          batchId,
          actorId: retained.actor_id,
          targetId: retained.target_id,
          targetContextId: retained.target_context_id,
        },
        lotId,
        nextRevision,
        value,
      ),

    async setLotPart(lotId, partSubjectId) {
      await executeDatabaseQuery(
        queryDatabase(client)
          .update(captureLots)
          .set({ partSubjectId })
          .where(and(eq(captureLots.id, lotId), eq(captureLots.batchId, batchId))),
      )
    },

    async touchSubject(subjectId) {
      await executeDatabaseQuery(
        queryDatabase(client)
          .update(captureSubjects)
          .set({ revision: sql`${captureSubjects.revision}+1` })
          .where(and(eq(captureSubjects.id, subjectId), eq(captureSubjects.batchId, batchId))),
      )
      // Every operator command that changes a lot also keeps the lead session to suggestions.
      await markLotEdited(client, subjectId, BigInt(nextRevision))
    },

    async commit(command) {
      retained.revision = nextRevision
      await executeDatabaseQuery(
        queryDatabase(client)
          .update(captureBatches)
          .set({ revision: BigInt(nextRevision), updatedAt: sql`now()` })
          .where(eq(captureBatches.id, batchId)),
      )
      await retainRevision(client, retained, command)
      return snapshot(client, config, batchId)
    },
  }
}

/** Capture has no dependency on execution SQL. Consumers use retained source/lot snapshots. */
export function captureRepository(pool: Pool, config: Binding) {
  const command = (
    action: string,
    resource: string,
    key: string,
    payload: unknown,
    work: (c: PoolClient) => Promise<unknown>,
  ) => {
    // A retained key must not bypass current target/context scope after operator reconfiguration.
    const resourceKey = `${config.targetId}:${config.targetContextId}:${resource}`
    return transaction(pool, (c) =>
      idempotent(c, { actorId: config.actorId, action, resourceKey, key }, payload, () => work(c)),
    )
  }

  return {
    list(options: CaptureListQueryDto = {}) {
      return listCaptureBatches(pool, config, options)
    },
    async read(id: string) {
      return transaction(pool, async (c) => {
        await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        return snapshot(c, config, id)
      })
    },
    async create(key: string, input: { title: string; note: string }) {
      return command('capture_create', 'batches', key, input, async (c) => {
        const id = randomUUID()
        const source = randomUUID()
        const stream = randomUUID()
        await executeDatabaseQuery(
          queryDatabase(c)
            .insert(captureSources)
            .values({
              id: source,
              namespaceKey: `native_batch:${source}`,
              createdBy: config.actorId,
            }),
        )
        await executeDatabaseQuery(
          queryDatabase(c)
            .insert(streams)
            .values({ id: stream, streamKey: `capture:${id}` }),
        )
        await executeDatabaseQuery(
          queryDatabase(c).insert(captureBatches).values({
            id,
            sourceId: source,
            actorId: config.actorId,
            targetId: config.targetId,
            targetContextId: config.targetContextId,
            streamId: stream,
            title: input.title,
          }),
        )
        const b = await batch(c, config, id)
        await note(c, b, null, input.note)
        await retainRevision(c, b, input)
        return snapshot(c, config, id)
      })
    },
    async edit(id: string, key: string, input: CaptureEditDto) {
      return command('capture_edit', id, key, input, async (c) => {
        const locked = await lockCaptureForEdit(c, config, id, input.expected_revision)
        await locked.apply(input)
        // An operator correction of a lot's identity or quantity reaches every relying session.
        if (input.change.kind === 'lot') {
          const fields = [
            ...(input.change.part_subject_id !== undefined ? (['identity'] as const) : []),
            ...(input.change.quantity !== undefined ? (['quantity'] as const) : []),
          ]
          if (fields.length) {
            // Loaded on use: Processing depends on capture, so capture must not import it eagerly.
            const { fieldsSuperseded } = await import('../processing/currentness.ts')
            await fieldsSuperseded(c, {
              batchId: id,
              subjectId: input.change.id,
              fields,
              reason: 'operator_correction',
              message: `The operator corrected this lot's ${fields.join(' and ')}.`,
              key: `correction:${key}`,
            })
          }
        }
        await locked.publish()
        return locked.readPublished()
      })
    },
    async observe(id: string, key: string, observation: CaptureObservationDto) {
      // Network read already completed outside this transaction. Key binds requested model/PK.
      return command(
        'capture_observe',
        id,
        key,
        { model: observation.model, pk: observation.pk },
        async (c) => {
          const b = await batch(c, config, id, true)
          if (b.archived) {
            fail('batch_archived', 409)
          }
          const count = await executeDatabaseQuery(
            queryDatabase(c)
              .select({ count: sql<string>`count(*)::text` })
              .from(captureObservations)
              .where(eq(captureObservations.batchId, id)),
          )
          if (BigInt(count[0].count) >= 100n) {
            fail('capture_capacity', 409)
          }
          await executeDatabaseQuery(
            queryDatabase(c)
              .insert(captureObservations)
              .values({
                id: observation.id,
                batchId: id,
                targetId: b.target_id,
                targetContextId: b.target_context_id,
                model: observation.model,
                pk: observation.pk,
                label: observation.label,
                observedAt: sql`${observation.observed_at}::timestamptz`,
                mapping: observation.mapping ?? null,
              }),
          )
          await appendEvent(c, b.stream_id, 'capture_observation', {
            batch_id: id,
            observation_id: observation.id,
          })
          await snapshot(c, config, id) // Enforce the same retained-response budget before publication.
          return observation
        },
      )
    },
  }
}

/** Scoped retained listing; callers may supply their repeatable-read transaction. */
export async function listCaptureBatches(
  client: Pool | PoolClient,
  config: Binding,
  options: CaptureListQueryDto = {},
  limit = 100,
) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select(batchColumns)
      .from(captureBatches)
      .where(
        and(
          eq(captureBatches.actorId, config.actorId),
          eq(captureBatches.targetId, config.targetId),
          eq(captureBatches.targetContextId, config.targetContextId),
          options.archived === 'exclude' ? eq(captureBatches.archived, false) : undefined,
          options.q
            ? sql`strpos(lower(${captureBatches.title}), lower(${options.q})) > 0`
            : undefined,
        ),
      )
      .orderBy(desc(captureBatches.updatedAt), captureBatches.id)
      .offset(Number(options.offset ?? 0))
      .limit(limit + 1),
  )
  return { batches: rows.slice(0, limit).map(summary), truncated: rows.length > limit }
}
