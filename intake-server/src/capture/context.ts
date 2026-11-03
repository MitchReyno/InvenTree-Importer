import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import {
  validate,
  type CaptureContextRecordDto,
  type CaptureLotContextDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { captureContexts, captureObservations } from './schema.ts'
import { fail } from './repository.ts'

interface ContextOwner {
  batchId: string
  actorId: string
  targetId: string
  targetContextId: string
}

export async function readCaptureContexts(
  client: PoolClient,
  batchId: string,
): Promise<CaptureContextRecordDto[]> {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .selectDistinctOn([captureContexts.subjectId])
      .from(captureContexts)
      .where(eq(captureContexts.batchId, batchId))
      .orderBy(asc(captureContexts.subjectId), desc(captureContexts.version)),
  )
  return rows.map((row) => {
    const record = {
      id: row.id,
      subject_id: row.subjectId,
      version: row.version.toString(),
      value: row.value,
      actor_id: row.actorId,
      created_at: row.createdAt.toISOString(),
    }
    validate('CaptureContextRecord', record)
    return record as CaptureContextRecordDto
  })
}

async function validateSupplier(
  client: PoolClient,
  owner: ContextOwner,
  value: CaptureLotContextDto['supplier'],
) {
  if (value.mode !== 'set') {
    return
  }
  const ref = value.value
  if (ref.target_context_id !== owner.targetContextId) {
    fail('invalid_reference')
  }
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ mapping: captureObservations.mapping })
      .from(captureObservations)
      .where(
        and(
          eq(captureObservations.id, ref.observation_id),
          eq(captureObservations.batchId, owner.batchId),
          eq(captureObservations.targetId, owner.targetId),
          eq(captureObservations.targetContextId, owner.targetContextId),
          eq(captureObservations.model, 'company'),
          eq(captureObservations.pk, ref.pk),
        ),
      ),
  )
  const mapping = rows[0]?.mapping
  if (
    !mapping ||
    typeof mapping !== 'object' ||
    !('kind' in mapping) ||
    mapping.kind !== 'company' ||
    !('supplier' in mapping) ||
    mapping.supplier !== true
  ) {
    fail('invalid_supplier_reference')
  }
}

export async function retainCaptureContext(
  client: PoolClient,
  owner: ContextOwner,
  subjectId: string | null,
  version: string,
  value: CaptureLotContextDto,
) {
  validate(subjectId === null ? 'CaptureContext' : 'CaptureLotContext', value)
  if (value.purchase_date.mode === 'set') {
    const date = new Date(`${value.purchase_date.value}T00:00:00.000Z`)
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value.purchase_date.value
    ) {
      fail('invalid_calendar_date')
    }
  }
  await validateSupplier(client, owner, value.supplier)
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(captureContexts)
      .values({
        id: randomUUID(),
        batchId: owner.batchId,
        subjectId,
        version: BigInt(version),
        value,
        actorId: owner.actorId,
      }),
  )
}
