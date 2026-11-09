import { lotRegrouped } from '../processing/regroup.ts'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type {
  CaptureEditDto,
  EvidenceRegionDto,
  LeadBatchViewDto,
  LotFormingConflictDto,
  ProposeLotArgsDto,
  RecordObservationArgsDto,
  RegroupArgsDto,
} from '@invimport/contracts'
import { lotItemCount } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { mediaPreviews, mediaVersions } from '../media/schema.ts'
import {
  captureEvidenceObservations,
  captureLotEvidenceObservations,
  captureLotRetirements,
  captureLots,
  captureParts,
  captureSubjects,
} from './schema.ts'
import { fail, lockCaptureForAgentWrite, type CaptureBinding } from './repository.ts'

/** The Examine lead session writing on its batch. */
export interface LeadWriter {
  config: CaptureBinding
  batchId: string
  sessionId: string
}

export type LotFormingResult =
  | { ok: true; revision: string; id: string; suggested: boolean; partSubjectId?: string }
  | { ok: false; error: 'stale'; revision: string; conflicts: LotFormingConflictDto[] }

const MAX_LOTS_AND_PARTS = 100
/** The snapshot's own limits: observations per batch (suggestions included) and per lot. */
const MAX_BATCH_OBSERVATIONS = 1000
const MAX_LOT_OBSERVATIONS = 100

async function requireObservationRoom(client: PoolClient, batchId: string) {
  const rows = await client.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM public.capture_evidence_observation WHERE batch_id=$1',
    [batchId],
  )
  if (Number(rows.rows[0].count) >= MAX_BATCH_OBSERVATIONS) {
    fail('capture_capacity', 409)
  }
}

async function requireLotRoom(client: PoolClient, lotId: string) {
  const rows = await client.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM public.capture_lot_evidence_observation WHERE lot_id=$1 AND status='active'",
    [lotId],
  )
  if (Number(rows.rows[0].count) > MAX_LOT_OBSERVATIONS) {
    fail('capture_capacity', 409)
  }
}

/** Pixels must fit the page's preview; a line range only needs a real page and ordered lines. */
export async function requireEvidenceRegion(
  client: PoolClient,
  batchId: string,
  versionId: string,
  page: number,
  region: EvidenceRegionDto,
) {
  const db = queryDatabase(client)
  const versions = await executeDatabaseQuery(
    db
      .select({ id: mediaVersions.id })
      .from(mediaVersions)
      .where(and(eq(mediaVersions.batchId, batchId), eq(mediaVersions.id, versionId))),
  )
  if (!versions[0]) {
    fail('evidence_version_not_found', 404)
  }
  const previews = await executeDatabaseQuery(
    db
      .select({
        page: mediaPreviews.page,
        width: mediaPreviews.width,
        height: mediaPreviews.height,
      })
      .from(mediaPreviews)
      .where(and(eq(mediaPreviews.batchId, batchId), eq(mediaPreviews.versionId, versionId)))
      .orderBy(asc(mediaPreviews.page)),
  )
  const preview = previews.find((row) => row.page === page)
  if (!preview) {
    fail('evidence_page_not_ready', 409)
  }
  if (region.kind === 'lines') {
    if (region.from_line > region.to_line) {
      fail('region_lines_out_of_order', 400)
    }
    return
  }
  if (
    region.source_width !== preview.width ||
    region.source_height !== preview.height ||
    region.x + region.width > region.source_width ||
    region.y + region.height > region.source_height
  ) {
    fail('region_outside_source', 400)
  }
}

interface LockedObservation {
  id: string
  status: 'active' | 'suggested'
  operatorEdited: boolean
  origin: 'agent' | 'operator'
  revision: bigint
  evidenceVersionId: string
  sameItemAs: string | null
  lotId: string | null
}

async function lockObservations(client: PoolClient, batchId: string, ids: readonly string[]) {
  if (!ids.length) {
    return new Map<string, LockedObservation>()
  }
  const db = queryDatabase(client)
  const rows = await executeDatabaseQuery(
    db
      .select({
        id: captureEvidenceObservations.id,
        status: captureEvidenceObservations.status,
        operatorEdited: captureEvidenceObservations.operatorEdited,
        origin: captureEvidenceObservations.origin,
        revision: captureEvidenceObservations.revision,
        evidenceVersionId: captureEvidenceObservations.evidenceVersionId,
        sameItemAs: captureEvidenceObservations.sameItemAs,
      })
      .from(captureEvidenceObservations)
      .where(
        and(
          eq(captureEvidenceObservations.batchId, batchId),
          inArray(captureEvidenceObservations.id, [...ids]),
        ),
      )
      .orderBy(asc(captureEvidenceObservations.id))
      .for('update'),
  )
  const members = await executeDatabaseQuery(
    db
      .select({
        observationId: captureLotEvidenceObservations.evidenceObservationId,
        lotId: captureLotEvidenceObservations.lotId,
      })
      .from(captureLotEvidenceObservations)
      .where(
        and(
          inArray(captureLotEvidenceObservations.evidenceObservationId, [...ids]),
          eq(captureLotEvidenceObservations.status, 'active'),
        ),
      ),
  )
  return new Map(
    rows.map((row) => [
      row.id,
      { ...row, lotId: members.find((m) => m.observationId === row.id)?.lotId ?? null },
    ]),
  )
}

interface LockedLot {
  id: string
  origin: 'agent' | 'operator'
  operatorEdited: boolean
  changedRevision: bigint
  retired: boolean
}

async function lockLots(client: PoolClient, batchId: string, ids: readonly string[]) {
  if (!ids.length) {
    return new Map<string, LockedLot>()
  }
  const db = queryDatabase(client)
  const rows = await executeDatabaseQuery(
    db
      .select({
        id: captureLots.id,
        origin: captureLots.origin,
        operatorEdited: captureLots.operatorEdited,
        changedRevision: captureLots.changedRevision,
      })
      .from(captureLots)
      .where(and(eq(captureLots.batchId, batchId), inArray(captureLots.id, [...ids])))
      .orderBy(asc(captureLots.id))
      .for('update'),
  )
  const retired = await executeDatabaseQuery(
    db
      .select({ lotId: captureLotRetirements.lotId })
      .from(captureLotRetirements)
      .where(
        and(
          eq(captureLotRetirements.batchId, batchId),
          inArray(captureLotRetirements.lotId, [...ids]),
        ),
      ),
  )
  return new Map(
    rows.map((row) => [row.id, { ...row, retired: retired.some((r) => r.lotId === row.id) }]),
  )
}

// A retired lot was split, merged or retired by the operator; it is theirs as well.
const editedLot = (lot: LockedLot) => lot.operatorEdited || lot.origin !== 'agent' || lot.retired

const editedObservation = (row: LockedObservation) => row.operatorEdited || row.origin !== 'agent'

function conflictsFor(
  base: bigint,
  observationIds: readonly string[],
  observations: Map<string, LockedObservation>,
  lotIds: readonly string[],
  lots: Map<string, LockedLot>,
) {
  const conflicts: LotFormingConflictDto[] = []
  for (const id of observationIds) {
    const row = observations.get(id)
    if (!row) {
      conflicts.push({ kind: 'observation', id, reason: 'missing', revision: null })
    } else if (row.revision > base) {
      // Its current state, so the agent can re-plan without guessing.
      conflicts.push({
        kind: 'observation',
        id,
        reason: row.operatorEdited ? 'operator_edited' : 'changed',
        revision: row.revision.toString(),
        lot_id: row.lotId,
        operator_edited: row.operatorEdited,
      })
    } else if (row.status !== 'active') {
      conflicts.push({
        kind: 'observation',
        id,
        reason: 'missing',
        revision: row.revision.toString(),
      })
    }
  }
  for (const id of lotIds) {
    const lot = lots.get(id)
    if (!lot) {
      conflicts.push({ kind: 'lot', id, reason: 'missing', revision: null })
    } else if (lot.retired) {
      conflicts.push({
        kind: 'lot',
        id,
        reason: 'retired',
        revision: lot.changedRevision.toString(),
      })
    } else if (lot.changedRevision > base) {
      conflicts.push({
        kind: 'lot',
        id,
        reason: lot.operatorEdited ? 'operator_edited' : 'changed',
        revision: lot.changedRevision.toString(),
        operator_edited: lot.operatorEdited,
      })
    }
  }
  return conflicts
}

/** Moves an observation's active membership, bumping both lots' observation sets. */
async function setActiveLot(
  client: PoolClient,
  batchId: string,
  observationId: string,
  from: string | null,
  to: string,
  revision: bigint,
  sessionId: string,
) {
  const db = queryDatabase(client)
  if (from === to) {
    return
  }
  if (from) {
    await executeDatabaseQuery(
      db
        .delete(captureLotEvidenceObservations)
        .where(
          and(
            eq(captureLotEvidenceObservations.lotId, from),
            eq(captureLotEvidenceObservations.evidenceObservationId, observationId),
          ),
        ),
    )
    await bumpObservationSet(client, from, revision, { removed: observationId })
  }
  await executeDatabaseQuery(
    db
      .insert(captureLotEvidenceObservations)
      .values({
        batchId,
        lotId: to,
        evidenceObservationId: observationId,
        status: 'active',
        agentSessionId: sessionId,
        revision,
      })
      .onConflictDoUpdate({
        target: [
          captureLotEvidenceObservations.lotId,
          captureLotEvidenceObservations.evidenceObservationId,
        ],
        set: { status: 'active', revision },
      }),
  )
  await bumpObservationSet(client, to, revision, { added: observationId })
}

async function bumpObservationSet(
  client: PoolClient,
  lotId: string,
  revision: bigint,
  change: { added?: string; removed?: string; operator?: boolean } = {},
) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(captureLots)
      .set({
        observationSetVersion: sql`${captureLots.observationSetVersion}+1`,
        changedRevision: revision,
      })
      .where(eq(captureLots.id, lotId)),
  )
  // Loaded on use: Processing depends on capture, so capture must not import it eagerly.
  const { observationAdded, observationRemoved, lotRegroupedNotices } =
    await import('../processing/currentness.ts')
  // Proposals citing a removed observation are stale for that reason, before the regroup.
  if (change.removed) {
    await observationRemoved(client, lotId, change.removed)
  }
  // Successors that have not started wait for the next stable identity.
  const regrouped = await lotRegrouped(client, lotId)
  await lotRegroupedNotices(client, regrouped.stale, { operator: change.operator === true })
  // Sessions already working on the lot hear about new evidence.
  if (change.added) {
    await observationAdded(client, lotId, change.added)
  }
}

/** A suggested membership row for the operator; it counts towards nothing until accepted. */
async function suggestMembership(
  client: PoolClient,
  batchId: string,
  lotId: string,
  observationId: string,
  revision: bigint,
  sessionId: string,
) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(captureLotEvidenceObservations)
      .values({
        batchId,
        lotId,
        evidenceObservationId: observationId,
        status: 'suggested',
        agentSessionId: sessionId,
        revision,
      })
      .onConflictDoNothing(),
  )
}

/** `record_observation`: a new observation, a revision of an AI one, or a suggested revision. */
export async function recordObservation(
  client: PoolClient,
  writer: LeadWriter,
  args: RecordObservationArgsDto,
): Promise<LotFormingResult> {
  const locked = await lockCaptureForAgentWrite(client, writer.config, writer.batchId)
  const base = BigInt(args.base_revision)
  const page = args.page ?? 1
  await requireEvidenceRegion(client, writer.batchId, args.evidence_version_id, page, args.region)
  const next = BigInt(locked.nextRevision)
  const db = queryDatabase(client)
  let id: string = randomUUID()
  let suggested = false
  const revising = args.observation_id !== undefined
  if (!revising) {
    await requireObservationRoom(client, writer.batchId)
  }
  if (args.observation_id) {
    const rows = await lockObservations(client, writer.batchId, [args.observation_id])
    const conflicts = conflictsFor(base, [args.observation_id], rows, [], new Map())
    if (conflicts.length) {
      return { ok: false, error: 'stale', revision: locked.revision, conflicts }
    }
    const row = rows.get(args.observation_id)!
    if (row.evidenceVersionId !== args.evidence_version_id) {
      fail('observation_version_mismatch', 400)
    }
    if (editedObservation(row)) {
      // The operator's observation stays as it is; the revision waits for their decision.
      await requireObservationRoom(client, writer.batchId)
      suggested = true
      await executeDatabaseQuery(
        db.insert(captureEvidenceObservations).values({
          id,
          batchId: writer.batchId,
          evidenceVersionId: args.evidence_version_id,
          page,
          region: args.region,
          readings: args.readings,
          visibleCount: args.visible_count ?? null,
          status: 'suggested',
          supersedesObservationId: row.id,
          origin: 'agent',
          agentSessionId: writer.sessionId,
          revision: next,
        }),
      )
    } else {
      id = row.id
      await executeDatabaseQuery(
        db
          .update(captureEvidenceObservations)
          .set({
            region: args.region,
            readings: args.readings,
            visibleCount: args.visible_count ?? null,
            revision: next,
          })
          .where(eq(captureEvidenceObservations.id, row.id)),
      )
    }
  } else {
    await executeDatabaseQuery(
      db.insert(captureEvidenceObservations).values({
        id,
        batchId: writer.batchId,
        evidenceVersionId: args.evidence_version_id,
        page,
        region: args.region,
        readings: args.readings,
        visibleCount: args.visible_count ?? null,
        origin: 'agent',
        agentSessionId: writer.sessionId,
        revision: next,
      }),
    )
  }
  const revision = await locked.finish(
    { tool: 'record_observation', ...args, id },
    writer.sessionId,
  )
  return { ok: true, revision, id, suggested }
}

async function proposedPart(
  client: PoolClient,
  writer: LeadWriter,
  part: NonNullable<ProposeLotArgsDto['part']>,
  subjects: { id: string; kind: string }[],
) {
  if ('part_subject_id' in part) {
    if (!subjects.some((s) => s.id === part.part_subject_id && s.kind === 'part')) {
      fail('subject_not_found', 404)
    }
    return part.part_subject_id
  }
  const id = randomUUID()
  const db = queryDatabase(client)
  await executeDatabaseQuery(
    db.insert(captureSubjects).values({
      batchId: writer.batchId,
      id,
      kind: 'part',
      label: part.label,
      agentSessionId: writer.sessionId,
    }),
  )
  await executeDatabaseQuery(db.insert(captureParts).values({ batchId: writer.batchId, id }))
  subjects.push({ id, kind: 'part' })
  return id
}

/** `propose_lot`: a new draft lot, or an extension of an AI lot. Edited targets get suggestions. */
export async function proposeLot(
  client: PoolClient,
  writer: LeadWriter,
  args: ProposeLotArgsDto,
): Promise<LotFormingResult> {
  const locked = await lockCaptureForAgentWrite(client, writer.config, writer.batchId)
  const base = BigInt(args.base_revision)
  if ((args.estimated_quantity === undefined) !== (args.quantity_basis === undefined)) {
    fail('quantity_basis_required', 400)
  }
  const observations = await lockObservations(client, writer.batchId, args.observation_ids)
  const currentLots = [...observations.values()].flatMap((row) => (row.lotId ? [row.lotId] : []))
  const lotIds = [...new Set([...(args.lot_id ? [args.lot_id] : []), ...currentLots])]
  const lots = await lockLots(client, writer.batchId, lotIds)
  const conflicts = conflictsFor(
    base,
    args.observation_ids,
    observations,
    args.lot_id ? [args.lot_id] : [],
    lots,
  )
  if (conflicts.length) {
    return { ok: false, error: 'stale', revision: locked.revision, conflicts }
  }
  // Proposing for a lot is the lead session looking at it again.
  if (args.lot_id) {
    await setReexamine(client, args.lot_id, false)
  }
  const next = BigInt(locked.nextRevision)
  const db = queryDatabase(client)
  const subjects = locked.subjects.map((s) => ({ id: s.id, kind: s.kind }))
  let lotId = args.lot_id
  let suggested = false
  let createdPartId: string | undefined

  const partFor = async (part: NonNullable<ProposeLotArgsDto['part']>) => {
    const id = await proposedPart(client, writer, part, subjects)
    if ('label' in part) {
      createdPartId = id
    }
    return id
  }

  if (lotId) {
    const target = lots.get(lotId)!
    if (editedLot(target)) {
      for (const observationId of args.observation_ids) {
        await suggestMembership(
          client,
          writer.batchId,
          lotId,
          observationId,
          next,
          writer.sessionId,
        )
      }
      const revision = await locked.finish({ tool: 'propose_lot', ...args }, writer.sessionId)
      return { ok: true, revision, id: lotId, suggested: true }
    }
    // A new draft Part counts towards the subject limit here too.
    if (args.part && 'label' in args.part && subjects.length + 1 > MAX_LOTS_AND_PARTS) {
      fail('capture_capacity', 409)
    }
    const partSubjectId = args.part ? await partFor(args.part) : undefined
    await executeDatabaseQuery(
      db
        .update(captureLots)
        .set({
          ...(partSubjectId !== undefined ? { partSubjectId } : {}),
          ...(args.estimated_quantity !== undefined
            ? { estimatedQuantity: args.estimated_quantity, quantityBasis: args.quantity_basis }
            : {}),
          changedRevision: next,
        })
        .where(eq(captureLots.id, lotId)),
    )
    if (args.label) {
      await executeDatabaseQuery(
        db
          .update(captureSubjects)
          .set({ label: args.label, revision: sql`${captureSubjects.revision}+1` })
          .where(eq(captureSubjects.id, lotId)),
      )
    }
  } else {
    if (!args.label) {
      fail('lot_label_required', 400)
    }
    // A new draft Part counts towards the same limit as the lot.
    const needed = 1 + (args.part && 'label' in args.part ? 1 : 0)
    if (subjects.length + needed > MAX_LOTS_AND_PARTS) {
      fail('capture_capacity', 409)
    }
    const partSubjectId = args.part ? await partFor(args.part) : null
    lotId = randomUUID()
    await executeDatabaseQuery(
      db.insert(captureSubjects).values({
        batchId: writer.batchId,
        id: lotId,
        kind: 'lot',
        label: args.label,
        agentSessionId: writer.sessionId,
      }),
    )
    await executeDatabaseQuery(
      db.insert(captureLots).values({
        batchId: writer.batchId,
        id: lotId,
        sourceId: locked.sourceId,
        contributionKey: randomUUID(),
        partSubjectId,
        origin: 'agent',
        agentSessionId: writer.sessionId,
        estimatedQuantity: args.estimated_quantity ?? null,
        quantityBasis: args.quantity_basis ?? null,
        changedRevision: next,
      }),
    )
  }
  for (const observationId of args.observation_ids) {
    const row = observations.get(observationId)!
    const from = row.lotId ? lots.get(row.lotId) : undefined
    if (editedObservation(row) || (from && editedLot(from))) {
      // An observation the operator placed stays put; the lead session can only suggest.
      suggested = true
      await suggestMembership(client, writer.batchId, lotId, observationId, next, writer.sessionId)
    } else {
      await setActiveLot(
        client,
        writer.batchId,
        observationId,
        row.lotId,
        lotId,
        next,
        writer.sessionId,
      )
    }
  }
  await requireLotRoom(client, lotId)
  const revision = await locked.finish(
    { tool: 'propose_lot', ...args, id: lotId },
    writer.sessionId,
  )
  return { ok: true, revision, id: lotId, suggested, partSubjectId: createdPartId }
}

/** `regroup`: moves observations between AI lots; edited rows only receive suggestions. */
export async function regroup(
  client: PoolClient,
  writer: LeadWriter,
  args: RegroupArgsDto,
): Promise<LotFormingResult> {
  const locked = await lockCaptureForAgentWrite(client, writer.config, writer.batchId)
  const base = BigInt(args.base_revision)
  const observationIds = [...new Set(args.moves.map((move) => move.observation_id))]
  if (observationIds.length !== args.moves.length) {
    fail('regroup_duplicate_observation', 400)
  }
  const observations = await lockObservations(client, writer.batchId, observationIds)
  const targets = [...new Set(args.moves.map((move) => move.to_lot_id))]
  const sources = [...observations.values()].flatMap((row) => (row.lotId ? [row.lotId] : []))
  const lots = await lockLots(client, writer.batchId, [...new Set([...targets, ...sources])])
  const conflicts = conflictsFor(base, observationIds, observations, targets, lots)
  if (conflicts.length) {
    return { ok: false, error: 'stale', revision: locked.revision, conflicts }
  }
  const next = BigInt(locked.nextRevision)
  let suggested = false
  for (const move of args.moves) {
    const row = observations.get(move.observation_id)!
    const from = row.lotId ? lots.get(row.lotId) : undefined
    const to = lots.get(move.to_lot_id)!
    if (editedObservation(row) || editedLot(to) || (from && editedLot(from))) {
      suggested = true
      await suggestMembership(
        client,
        writer.batchId,
        move.to_lot_id,
        move.observation_id,
        next,
        writer.sessionId,
      )
    } else {
      await setActiveLot(
        client,
        writer.batchId,
        move.observation_id,
        row.lotId,
        move.to_lot_id,
        next,
        writer.sessionId,
      )
    }
  }
  for (const target of targets) {
    await requireLotRoom(client, target)
  }
  const revision = await locked.finish({ tool: 'regroup', ...args }, writer.sessionId)
  return { ok: true, revision, id: targets[0], suggested }
}

type ObservationChange = Extract<
  CaptureEditDto['change'],
  { kind: 'observation' | 'observation_move' | 'observation_suggestion' | 'observation_same_item' }
>

/** Marks a lot as changed by the operator, so the lead session only suggests for it from now on. */
/** Touches the row only when the mark changes, so the agent guard sees no idle writes. */
async function setReexamine(client: PoolClient, lotId: string, reexamine: boolean) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(captureLots)
      .set({ reexamine })
      .where(and(eq(captureLots.id, lotId), eq(captureLots.reexamine, !reexamine))),
  )
}

export async function markLotEdited(client: PoolClient, lotId: string, revision: bigint) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(captureLots)
      .set({ operatorEdited: true, changedRevision: revision })
      .where(eq(captureLots.id, lotId)),
  )
}

async function requireLiveLot(client: PoolClient, batchId: string, lotId: string) {
  const lots = await lockLots(client, batchId, [lotId])
  const lot = lots.get(lotId)
  if (!lot) {
    fail('subject_not_found', 404)
  }
  if (lot.retired) {
    fail('lot_retired', 409)
  }
}

async function moveByOperator(
  client: PoolClient,
  batchId: string,
  observationId: string,
  from: string | null,
  to: string | null,
  revision: bigint,
) {
  const db = queryDatabase(client)
  if (from === to) {
    return
  }
  if (from) {
    await executeDatabaseQuery(
      db
        .delete(captureLotEvidenceObservations)
        .where(
          and(
            eq(captureLotEvidenceObservations.lotId, from),
            eq(captureLotEvidenceObservations.evidenceObservationId, observationId),
          ),
        ),
    )
    await bumpObservationSet(client, from, revision, { removed: observationId, operator: true })
    await markLotEdited(client, from, revision)
  }
  if (to) {
    await requireLiveLot(client, batchId, to)
    await executeDatabaseQuery(
      db
        .insert(captureLotEvidenceObservations)
        .values({
          batchId,
          lotId: to,
          evidenceObservationId: observationId,
          status: 'active',
          revision,
        })
        .onConflictDoUpdate({
          target: [
            captureLotEvidenceObservations.lotId,
            captureLotEvidenceObservations.evidenceObservationId,
          ],
          set: { status: 'active', revision },
        }),
    )
    await bumpObservationSet(client, to, revision, { added: observationId, operator: true })
    await markLotEdited(client, to, revision)
  }
}

/** A same-item mark holds only while both observations are active in one lot; moves end it. */
async function dropBrokenSameItems(client: PoolClient, batchId: string) {
  await executeDatabaseQuery(
    queryDatabase(client).execute(sql`
      UPDATE capture_evidence_observation o SET same_item_as = NULL
      WHERE o.batch_id = ${batchId} AND o.same_item_as IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM capture_lot_evidence_observation a
        JOIN capture_lot_evidence_observation b ON b.batch_id = a.batch_id AND b.lot_id = a.lot_id
        WHERE a.batch_id = o.batch_id AND a.evidence_observation_id = o.id AND a.status = 'active'
          AND b.evidence_observation_id = o.same_item_as AND b.status = 'active')`),
  )
}

async function lockActiveObservation(client: PoolClient, batchId: string, id: string) {
  const rows = await lockObservations(client, batchId, [id])
  const row = rows.get(id)
  if (!row || row.status !== 'active') {
    fail('observation_not_found', 404)
  }
  return row
}

/**
 * Marks an observation as showing the same physical item as another of its lot, or clears the mark.
 * Groups stay flat: every mark names the group's first observation. Both rows become operator-edited,
 * so the lead session cannot move either out from under the mark.
 */
async function markSameItem(
  client: PoolClient,
  batchId: string,
  change: Extract<ObservationChange, { kind: 'observation_same_item' }>,
  revision: bigint,
) {
  const db = queryDatabase(client)
  if (change.same_as === change.observation_id) {
    fail('same_item_self', 400)
  }
  const rows = await lockObservations(
    client,
    batchId,
    change.same_as ? [change.observation_id, change.same_as] : [change.observation_id],
  )
  const row = rows.get(change.observation_id)
  const target = change.same_as ? rows.get(change.same_as) : undefined
  if (row?.status !== 'active' || (change.same_as && target?.status !== 'active')) {
    fail('observation_not_found', 404)
  }

  const edited = (ids: string[], sameItemAs?: string | null) =>
    executeDatabaseQuery(
      db
        .update(captureEvidenceObservations)
        .set({
          operatorEdited: true,
          revision,
          ...(sameItemAs !== undefined ? { sameItemAs } : {}),
        })
        .where(inArray(captureEvidenceObservations.id, ids)),
    )

  if (!target) {
    await edited([row.id], null)
  } else {
    if (!row.lotId || row.lotId !== target.lotId) {
      fail('same_item_different_lots', 409)
    }
    const root = target.sameItemAs ?? target.id
    if (root !== row.id) {
      const followers = await executeDatabaseQuery(
        db
          .select({ id: captureEvidenceObservations.id })
          .from(captureEvidenceObservations)
          .where(
            and(
              eq(captureEvidenceObservations.batchId, batchId),
              eq(captureEvidenceObservations.sameItemAs, row.id),
            ),
          ),
      )
      await edited([row.id, ...followers.map((follower) => follower.id)], root)
    }
    await edited([target.id])
  }
  if (row.lotId) {
    await markLotEdited(client, row.lotId, revision)
    // The lot's count changed, so the lead session re-estimates it counting the item once.
    await setReexamine(client, row.lotId, true)
  }
}

/**
 * An estimate equal to the lot's count before a same-item mark came from those counts, so it
 * follows them; any other estimate waits for the lead session to look again.
 */
export async function followItemCountEstimate(
  client: PoolClient,
  lotId: string,
  before: number,
  after: number,
) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .update(captureLots)
      .set({
        estimatedQuantity: String(after),
        quantityBasis: 'Counted from the lot’s observations, each item once.',
      })
      .where(and(eq(captureLots.id, lotId), eq(captureLots.estimatedQuantity, String(before)))),
  )
}

/** The lot an active observation is in, if any. */
export async function observationLot(client: PoolClient, batchId: string, observationId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ lotId: captureLotEvidenceObservations.lotId })
      .from(captureLotEvidenceObservations)
      .where(
        and(
          eq(captureLotEvidenceObservations.batchId, batchId),
          eq(captureLotEvidenceObservations.evidenceObservationId, observationId),
          eq(captureLotEvidenceObservations.status, 'active'),
        ),
      ),
  )
  return rows[0]?.lotId ?? null
}

/** The items a lot's active observations count now, each physical item once (`lotItemCount`). */
export async function currentLotItemCount(client: PoolClient, batchId: string, lotId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({
        id: captureEvidenceObservations.id,
        same_item_as: captureEvidenceObservations.sameItemAs,
        visible_count: captureEvidenceObservations.visibleCount,
      })
      .from(captureEvidenceObservations)
      .innerJoin(
        captureLotEvidenceObservations,
        and(
          eq(captureLotEvidenceObservations.evidenceObservationId, captureEvidenceObservations.id),
          eq(captureLotEvidenceObservations.status, 'active'),
        ),
      )
      .where(
        and(
          eq(captureEvidenceObservations.batchId, batchId),
          eq(captureLotEvidenceObservations.lotId, lotId),
          eq(captureEvidenceObservations.status, 'active'),
        ),
      ),
  )
  return lotItemCount(
    rows.map((row) => ({ ...row, status: 'active', lot_id: lotId })) as never,
    lotId,
  )
}

/** Operator observation edits; each marks the observation and the lots it touches as edited. */
export async function applyObservationEdit(
  client: PoolClient,
  batchId: string,
  change: ObservationChange,
  nextRevision: string,
) {
  await applyOneObservationEdit(client, batchId, change, nextRevision)
  await dropBrokenSameItems(client, batchId)
}

async function applyOneObservationEdit(
  client: PoolClient,
  batchId: string,
  change: ObservationChange,
  nextRevision: string,
) {
  const revision = BigInt(nextRevision)
  const db = queryDatabase(client)
  if (change.kind === 'observation') {
    const page = change.page ?? 1
    await requireEvidenceRegion(client, batchId, change.evidence_version_id, page, change.region)
    let id: string = randomUUID()
    let from: string | null = null
    if (change.observation_id) {
      const row = await lockActiveObservation(client, batchId, change.observation_id)
      if (row.evidenceVersionId !== change.evidence_version_id) {
        fail('observation_version_mismatch', 400)
      }
      id = row.id
      from = row.lotId
      await executeDatabaseQuery(
        db
          .update(captureEvidenceObservations)
          .set({
            region: change.region,
            ...(change.readings ? { readings: change.readings } : {}),
            ...(change.visible_count !== undefined ? { visibleCount: change.visible_count } : {}),
            operatorEdited: true,
            revision,
          })
          .where(eq(captureEvidenceObservations.id, id)),
      )
      if (from) {
        await markLotEdited(client, from, revision)
        // The lot used the reading the operator corrected, so the lead session looks again.
        await setReexamine(client, from, true)
      }
    } else {
      await executeDatabaseQuery(
        db.insert(captureEvidenceObservations).values({
          id,
          batchId,
          evidenceVersionId: change.evidence_version_id,
          page,
          region: change.region,
          readings: change.readings ?? { markings: [] },
          visibleCount: change.visible_count ?? null,
          origin: 'operator',
          operatorEdited: true,
          revision,
        }),
      )
    }
    if (change.lot_id !== undefined) {
      await moveByOperator(client, batchId, id, from, change.lot_id, revision)
    }
    return
  }
  if (change.kind === 'observation_same_item') {
    await markSameItem(client, batchId, change, revision)
    return
  }
  if (change.kind === 'observation_move') {
    const row = await lockActiveObservation(client, batchId, change.observation_id)
    await executeDatabaseQuery(
      db
        .update(captureEvidenceObservations)
        .set({ operatorEdited: true, revision })
        .where(eq(captureEvidenceObservations.id, row.id)),
    )
    await moveByOperator(client, batchId, row.id, row.lotId, change.lot_id, revision)
    return
  }
  if (change.lot_id) {
    const members = await executeDatabaseQuery(
      db
        .select({ status: captureLotEvidenceObservations.status })
        .from(captureLotEvidenceObservations)
        .where(
          and(
            eq(captureLotEvidenceObservations.batchId, batchId),
            eq(captureLotEvidenceObservations.lotId, change.lot_id),
            eq(captureLotEvidenceObservations.evidenceObservationId, change.observation_id),
          ),
        ),
    )
    if (members[0]?.status !== 'suggested') {
      fail('suggestion_not_found', 404)
    }
    if (change.decision === 'dismiss') {
      await executeDatabaseQuery(
        db
          .delete(captureLotEvidenceObservations)
          .where(
            and(
              eq(captureLotEvidenceObservations.lotId, change.lot_id),
              eq(captureLotEvidenceObservations.evidenceObservationId, change.observation_id),
            ),
          ),
      )
      return
    }
    const row = await lockActiveObservation(client, batchId, change.observation_id)
    await executeDatabaseQuery(
      db
        .update(captureEvidenceObservations)
        .set({ operatorEdited: true, revision })
        .where(eq(captureEvidenceObservations.id, row.id)),
    )
    await moveByOperator(client, batchId, row.id, row.lotId, change.lot_id, revision)
    return
  }
  const suggestions = await executeDatabaseQuery(
    db
      .select()
      .from(captureEvidenceObservations)
      .where(
        and(
          eq(captureEvidenceObservations.batchId, batchId),
          eq(captureEvidenceObservations.id, change.observation_id),
          eq(captureEvidenceObservations.status, 'suggested'),
        ),
      )
      .for('update'),
  )
  const suggestion = suggestions[0] ?? fail('suggestion_not_found', 404)
  if (change.decision === 'accept') {
    // The edited observation keeps its ID and memberships and takes the suggested content.
    const target = await lockActiveObservation(client, batchId, suggestion.supersedesObservationId!)
    await executeDatabaseQuery(
      db
        .update(captureEvidenceObservations)
        .set({
          region: suggestion.region,
          readings: suggestion.readings,
          visibleCount: suggestion.visibleCount,
          operatorEdited: true,
          revision,
        })
        .where(eq(captureEvidenceObservations.id, target.id)),
    )
    if (target.lotId) {
      await markLotEdited(client, target.lotId, revision)
    }
  }
  await executeDatabaseQuery(
    db.delete(captureEvidenceObservations).where(eq(captureEvidenceObservations.id, suggestion.id)),
  )
}

/** Active observations of a lot, for operator split and merge. */
export async function activeObservationIds(client: PoolClient, batchId: string, lotId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: captureLotEvidenceObservations.evidenceObservationId })
      .from(captureLotEvidenceObservations)
      .where(
        and(
          eq(captureLotEvidenceObservations.batchId, batchId),
          eq(captureLotEvidenceObservations.lotId, lotId),
          eq(captureLotEvidenceObservations.status, 'active'),
        ),
      )
      .orderBy(asc(captureLotEvidenceObservations.evidenceObservationId)),
  )
  return rows.map((row) => row.id)
}

/** Operator split or merge: the observations move with the physical items and become edited. */
export async function moveObservationsByOperator(
  client: PoolClient,
  batchId: string,
  observationIds: readonly string[],
  from: string,
  to: string,
  nextRevision: string,
) {
  const revision = BigInt(nextRevision)
  for (const observationId of observationIds) {
    const row = await lockActiveObservation(client, batchId, observationId)
    if (row.lotId !== from) {
      fail('observation_not_in_lot', 409)
    }
    await executeDatabaseQuery(
      queryDatabase(client)
        .update(captureEvidenceObservations)
        .set({ operatorEdited: true, revision })
        .where(eq(captureEvidenceObservations.id, observationId)),
    )
    await moveByOperator(client, batchId, observationId, from, to, revision)
  }
  // After every move, so a marked pair that moves together keeps its mark.
  await dropBrokenSameItems(client, batchId)
}

/** The lead session's view of its batch: what `read_batch` returns and its messages carry. */
export async function leadBatchView(
  client: PoolClient,
  batchId: string,
): Promise<LeadBatchViewDto> {
  const batch = await client.query<{ revision: string }>(
    'SELECT revision::text AS revision FROM public.capture_batch WHERE id=$1',
    [batchId],
  )
  const subjects = await client.query<{
    id: string
    kind: 'lot' | 'part'
    label: string
    origin: 'agent' | 'operator' | null
    operator_edited: boolean | null
    reexamine: boolean | null
    part_subject_id: string | null
    estimated_quantity: string | null
    observation_set_version: string | null
    retired: boolean
  }>(
    `SELECT s.id,s.kind,s.label,l.origin,l.operator_edited,l.reexamine,l.part_subject_id,l.estimated_quantity,
       l.observation_set_version::text AS observation_set_version,
       EXISTS (SELECT 1 FROM public.capture_lot_retirement r WHERE r.lot_id=s.id) AS retired
     FROM public.capture_subject s LEFT JOIN public.capture_lot l ON l.id=s.id
     WHERE s.batch_id=$1 ORDER BY s.id`,
    [batchId],
  )
  const observations = await client.query<{
    id: string
    evidence_version_id: string
    page: number
    region: EvidenceRegionDto
    readings: { markings: string[] }
    visible_count: number | null
    status: 'active' | 'suggested'
    supersedes_observation_id: string | null
    operator_edited: boolean
    same_item_as: string | null
  }>(
    `SELECT id,evidence_version_id,page,region,readings,visible_count,status,supersedes_observation_id,operator_edited,same_item_as
     FROM public.capture_evidence_observation WHERE batch_id=$1 ORDER BY created_at,id`,
    [batchId],
  )
  const members = await client.query<{ lot_id: string; observation_id: string; status: string }>(
    `SELECT lot_id,evidence_observation_id AS observation_id,status
     FROM public.capture_lot_evidence_observation WHERE batch_id=$1 ORDER BY lot_id,evidence_observation_id`,
    [batchId],
  )
  const activeLot = new Map(
    members.rows.filter((m) => m.status === 'active').map((m) => [m.observation_id, m.lot_id]),
  )
  return {
    revision: batch.rows[0].revision,
    lots: subjects.rows
      .filter((row) => row.kind === 'lot')
      .map((row) => ({
        id: row.id,
        label: row.label,
        origin: row.origin ?? 'operator',
        operator_edited: row.operator_edited === true,
        reexamine: row.reexamine === true,
        retired: row.retired,
        part_subject_id: row.part_subject_id,
        estimated_quantity: row.estimated_quantity,
        observation_set_version: row.observation_set_version ?? '0',
        observation_ids: members.rows
          .filter((m) => m.lot_id === row.id && m.status === 'active')
          .map((m) => m.observation_id),
        suggested_observation_ids: members.rows
          .filter((m) => m.lot_id === row.id && m.status === 'suggested')
          .map((m) => m.observation_id),
      })),
    parts: subjects.rows
      .filter((row) => row.kind === 'part')
      .map((row) => ({ id: row.id, label: row.label })),
    observations: observations.rows.map((row) => ({
      id: row.id,
      evidence_version_id: row.evidence_version_id,
      page: row.page,
      region: row.region,
      markings: row.readings.markings,
      visible_count: row.visible_count,
      status: row.status,
      supersedes_observation_id: row.supersedes_observation_id,
      lot_id: activeLot.get(row.id) ?? null,
      operator_edited: row.operator_edited,
      // Only a mark whose two observations are active in one lot holds.
      ...(row.same_item_as &&
      activeLot.get(row.id) &&
      activeLot.get(row.id) === activeLot.get(row.same_item_as)
        ? { same_item_as: row.same_item_as }
        : {}),
    })),
  }
}
