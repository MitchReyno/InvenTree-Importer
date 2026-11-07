import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { and, asc, desc, eq } from 'drizzle-orm'
import type {
  CaptureAssignedLocationChangeDto,
  CaptureGroupLocationDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { activeMediaGroups } from '../media/context.ts'
import { captureGroupLocations, captureObservations } from './schema.ts'
import { fail } from './repository.ts'

type Owner = { id: string; actor_id: string; target_id: string; target_context_id: string }

/** Latest set/clear assignment of each active group; removed or retired assignments are omitted. */
export async function readGroupLocations(
  client: PoolClient,
  batchId: string,
): Promise<CaptureGroupLocationDto[]> {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .selectDistinctOn([captureGroupLocations.groupId], {
        group_id: captureGroupLocations.groupId,
        version: captureGroupLocations.version,
        value: captureGroupLocations.value,
      })
      .from(captureGroupLocations)
      .where(eq(captureGroupLocations.batchId, batchId))
      .orderBy(asc(captureGroupLocations.groupId), desc(captureGroupLocations.version)),
  )
  if (!rows.length) {
    return []
  }
  const active = new Set((await activeMediaGroups(client, batchId)).map((group) => group.id))
  return rows.flatMap((row) => {
    const location = row.value as CaptureAssignedLocationChangeDto
    return location.mode === 'unset' || !active.has(row.group_id)
      ? []
      : [{ group_id: row.group_id, version: row.version.toString(), location }]
  })
}

/** Retains one group assignment; the group must be active and a set reference observed here. */
export async function applyGroupLocation(
  client: PoolClient,
  batch: Owner,
  groupId: string,
  location: CaptureAssignedLocationChangeDto,
  version: string,
) {
  const active = await activeMediaGroups(client, batch.id)
  if (!active.some((group) => group.id === groupId)) {
    fail('group_not_found', 404)
  }
  let observationId: string | null = null
  if (location.mode === 'set') {
    const ref = location.value
    if (ref.model !== 'location' || ref.target_context_id !== batch.target_context_id) {
      fail('invalid_reference')
    }
    const found = await executeDatabaseQuery(
      queryDatabase(client)
        .select({ id: captureObservations.id })
        .from(captureObservations)
        .where(
          and(
            eq(captureObservations.batchId, batch.id),
            eq(captureObservations.id, ref.observation_id),
            eq(captureObservations.targetId, batch.target_id),
            eq(captureObservations.targetContextId, ref.target_context_id),
            eq(captureObservations.model, 'location'),
            eq(captureObservations.pk, ref.pk),
          ),
        ),
    )
    if (!found.length) {
      fail('invalid_reference')
    }
    observationId = ref.observation_id
  }
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(captureGroupLocations)
      .values({
        id: randomUUID(),
        batchId: batch.id,
        groupId,
        version: BigInt(version),
        value: location,
        observationId,
        actorId: batch.actor_id,
      }),
  )
}
