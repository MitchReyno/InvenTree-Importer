import { activeMediaGroups } from '../media/context.ts'
import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { and, eq } from 'drizzle-orm'
import type {
  CaptureLotContextDto,
  BulkEditDto,
  InstructionEditDto,
  OperatorImpactDto,
  RestructureDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import type { OperatorCommandScope } from './repository.ts'
import { fail } from './model.ts'
import {
  activeObservationIds,
  markLotEdited,
  moveObservationsByOperator,
} from './evidence-observations.ts'
import {
  captureInstructions,
  captureIssueDispositions,
  captureLotEvidenceObservations,
  captureLotLineages,
  captureLotRetirements,
} from './schema.ts'

type RestructureChange = RestructureDto['change']
type SplitLot = Extract<RestructureChange, { kind: 'split_lot' }>
type MergeLots = Extract<RestructureChange, { kind: 'merge_lots' }>
type MoveLots = Extract<RestructureChange, { kind: 'move_lots' }>
/** The scope fields a retained-row insert stamps on each row. */
type RevisionScope = Pick<OperatorCommandScope, 'batchId' | 'actorId' | 'nextRevision'>

export interface StructuralOutcome {
  retiredLotIds: string[]
  createdLots: OperatorImpactDto['created_lots']
  createdPart: OperatorImpactDto['created_part']
}

const NO_STRUCTURE: StructuralOutcome = { retiredLotIds: [], createdLots: [], createdPart: null }

/** Active, same-batch lots only; retired lots keep history but accept no further edits. */
function requireActiveLots(scope: OperatorCommandScope, lotIds: readonly string[]) {
  for (const lotId of lotIds) {
    if (!scope.snapshot.lots.some((lot) => lot.id === lotId)) {
      fail('subject_not_found', 404)
    }
    if (scope.retiredLotIds.has(lotId)) {
      fail('lot_retired', 409)
    }
  }
}

function requirePart(scope: OperatorCommandScope, partId: string) {
  if (!scope.snapshot.parts.some((part) => part.id === partId)) {
    fail('subject_not_found', 404)
  }
}

function lot(scope: OperatorCommandScope, lotId: string) {
  return scope.snapshot.lots.find((value) => value.id === lotId)!
}

export async function applyBulkEdit(scope: OperatorCommandScope, input: BulkEditDto) {
  requireActiveLots(scope, input.lot_ids)
  for (const lotId of input.lot_ids) {
    await scope.setSelection(lotId, 'quantity', input.change.quantity)
    await scope.setSelection(lotId, 'location', input.change.location)
    await scope.touchSubject(lotId)
  }
  return NO_STRUCTURE
}

async function recordLineage(
  client: PoolClient,
  scope: RevisionScope,
  predecessors: readonly string[],
  successors: readonly string[],
  action: 'split' | 'merge',
) {
  const revision = BigInt(scope.nextRevision)
  for (const predecessor of predecessors) {
    for (const successor of successors) {
      await executeDatabaseQuery(
        queryDatabase(client).insert(captureLotLineages).values({
          batchId: scope.batchId,
          predecessorLotId: predecessor,
          successorLotId: successor,
          action,
          revision,
          actorId: scope.actorId,
        }),
      )
    }
  }
  for (const predecessor of predecessors) {
    // A split, merged or retired lot is the operator's; observations left on it stay put, and
    // suggestions aimed at it can no longer be accepted.
    await markLotEdited(client, predecessor, revision)
    await executeDatabaseQuery(
      queryDatabase(client)
        .delete(captureLotEvidenceObservations)
        .where(
          and(
            eq(captureLotEvidenceObservations.lotId, predecessor),
            eq(captureLotEvidenceObservations.status, 'suggested'),
          ),
        ),
    )
    await executeDatabaseQuery(
      queryDatabase(client).insert(captureLotRetirements).values({
        batchId: scope.batchId,
        lotId: predecessor,
        revision,
        actorId: scope.actorId,
      }),
    )
  }
}

/** Children keep the Part proposal and location selection; each quantity is an explicit human value. */
async function splitLot(client: PoolClient, scope: OperatorCommandScope, change: SplitLot) {
  requireActiveLots(scope, [change.lot_id])
  const original = lot(scope, change.lot_id)
  const created: OperatorImpactDto['created_lots'] = []
  for (const child of change.children) {
    const childId = await scope.addLot(child.label, original.part_subject_id)
    await scope.setSelection(childId, 'quantity', { mode: 'set', value: child.quantity })
    if (original.location.mode !== 'inherit') {
      await scope.setSelection(childId, 'location', original.location)
    }
    const inheritedContext = scope.snapshot.context?.find(
      (record) => record.subject_id === change.lot_id,
    )
    if (inheritedContext) {
      await scope.setContext(childId, inheritedContext.value)
    }
    if (child.observation_ids?.length) {
      await moveObservationsByOperator(
        client,
        scope.batchId,
        child.observation_ids,
        change.lot_id,
        childId,
        scope.nextRevision,
      )
    }
    created.push({ lot_id: childId, label: child.label })
  }
  const successorIds = created.map((value) => value.lot_id!)
  await recordLineage(client, scope, [change.lot_id], successorIds, 'split')
  return { retiredLotIds: [change.lot_id], createdLots: created, createdPart: null }
}

async function mergeLots(client: PoolClient, scope: OperatorCommandScope, change: MergeLots) {
  requireActiveLots(scope, change.lot_ids)
  if (change.part_subject_id !== null) {
    requirePart(scope, change.part_subject_id)
  }
  const mergedId = await scope.addLot(change.label, change.part_subject_id)
  await scope.setSelection(mergedId, 'quantity', { mode: 'set', value: change.quantity })
  const locations = change.lot_ids.map((lotId) => JSON.stringify(lot(scope, lotId).location))
  const sharedLocation =
    new Set(locations).size === 1 ? lot(scope, change.lot_ids[0]).location : null
  if (sharedLocation && sharedLocation.mode !== 'inherit') {
    await scope.setSelection(mergedId, 'location', sharedLocation)
  }
  const contexts = change.lot_ids.map(
    (id) => scope.snapshot.context?.find((record) => record.subject_id === id)?.value,
  )
  if (contexts.some((value) => value !== undefined)) {
    const inherited: CaptureLotContextDto = {
      supplier: { mode: 'inherit' },
      purchase_date: { mode: 'inherit' },
      tags: { mode: 'inherit' },
    }
    const values = contexts.map((value) => value ?? inherited)

    const shared = <K extends keyof CaptureLotContextDto>(field: K): CaptureLotContextDto[K] =>
      values.every((value) => JSON.stringify(value[field]) === JSON.stringify(values[0][field]))
        ? values[0][field]
        : { mode: 'unknown' }

    await scope.setContext(mergedId, {
      supplier: shared('supplier'),
      purchase_date: shared('purchase_date'),
      tags: shared('tags'),
    })
  }
  // The merged lot holds every source lot's active observations.
  for (const lotId of change.lot_ids) {
    const observationIds = await activeObservationIds(client, scope.batchId, lotId)
    await moveObservationsByOperator(
      client,
      scope.batchId,
      observationIds,
      lotId,
      mergedId,
      scope.nextRevision,
    )
  }
  await recordLineage(client, scope, change.lot_ids, [mergedId], 'merge')
  return {
    retiredLotIds: [...change.lot_ids],
    createdLots: [{ lot_id: mergedId, label: change.label }],
    createdPart: null,
  }
}

async function moveLots(scope: OperatorCommandScope, change: MoveLots) {
  requireActiveLots(scope, change.lot_ids)
  let destination: string | null = null
  let createdPart: OperatorImpactDto['created_part'] = null
  if (change.destination.kind === 'existing') {
    requirePart(scope, change.destination.part_subject_id)
    destination = change.destination.part_subject_id
  } else if (change.destination.kind === 'new') {
    destination = await scope.addPart(change.destination.label)
    createdPart = { part_id: destination, label: change.destination.label }
  }
  for (const lotId of change.lot_ids) {
    await scope.setLotPart(lotId, destination)
    await scope.touchSubject(lotId)
  }
  return { retiredLotIds: [], createdLots: [], createdPart }
}

export async function applyRestructure(
  client: PoolClient,
  scope: OperatorCommandScope,
  input: RestructureDto,
): Promise<StructuralOutcome> {
  switch (input.change.kind) {
    case 'split_lot':
      return splitLot(client, scope, input.change)
    case 'merge_lots':
      return mergeLots(client, scope, input.change)
    case 'move_lots':
      return moveLots(scope, input.change)
  }
}

export async function recordDisposition(
  client: PoolClient,
  scope: RevisionScope,
  input: { subjectId: string; code: string; dependencyDigest: string; reason: string },
) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(captureIssueDispositions)
      .values({
        id: randomUUID(),
        batchId: scope.batchId,
        subjectId: input.subjectId,
        code: input.code,
        dependencyDigest: Buffer.from(input.dependencyDigest, 'hex'),
        reason: input.reason,
        revision: BigInt(scope.nextRevision),
        actorId: scope.actorId,
      }),
  )
}

export async function recordInstruction(
  client: PoolClient,
  scope: RevisionScope,
  input: InstructionEditDto,
) {
  if (input.group_id !== null) {
    const active = await activeMediaGroups(client, scope.batchId)
    if (!active.some((group) => group.id === input.group_id)) {
      fail('group_not_found', 404)
    }
  }
  try {
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(captureInstructions)
        .values({
          id: randomUUID(),
          batchId: scope.batchId,
          groupId: input.group_id,
          version: BigInt(scope.nextRevision),
          text: input.text,
          actorId: scope.actorId,
        }),
    )
  } catch (error) {
    // The composite FK proves the evidence group belongs to this batch without reading media tables.
    if (input.group_id !== null && isForeignKeyViolation(error)) {
      fail('group_not_found', 404)
    }
    throw error
  }
}

function isForeignKeyViolation(error: unknown) {
  return error instanceof Error && (error as Error & { code?: string }).code === '23503'
}
