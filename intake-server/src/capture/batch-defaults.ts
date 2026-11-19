import type { Pool, PoolClient } from 'pg'
import { and, eq } from 'drizzle-orm'
import {
  validate,
  type BatchDefaultRecordDto,
  type BatchDefaultsDto,
  type BatchDefaultsUpdateDto,
  type CaptureCreationNoticeDto,
  type CatalogueModelDto,
  type CatalogueRecordDto,
} from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase, transaction } from '#/db/database.ts'
// Schema only: Capture reads the agent rows' batch fields without loading the agents runtime.
import { agentSettings } from '#/agents/schema.ts'
import type { CatalogueReader, CatalogueRecordLookup } from './catalogue.ts'
import { fail, type CaptureBinding as Binding } from './model.ts'
import { batchDefaults } from './schema.ts'

function defaultsScope(binding: Binding) {
  return and(
    eq(batchDefaults.actorId, binding.actorId),
    eq(batchDefaults.targetId, binding.targetId),
    eq(batchDefaults.targetContextId, binding.targetContextId),
  )
}

async function savedRow(client: Pool | PoolClient, binding: Binding) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client).select().from(batchDefaults).where(defaultsScope(binding)),
  )
  return rows[0]
}

async function lookup(
  catalogue: CatalogueReader | undefined,
  model: CatalogueModelDto,
  pk: bigint | null,
): Promise<CatalogueRecordLookup | undefined> {
  if (pk === null) {
    return undefined
  }
  return catalogue ? catalogue.record(model, pk.toString()) : { status: 'unavailable' }
}

function shown(
  pk: bigint | null,
  found: CatalogueRecordLookup | undefined,
): BatchDefaultRecordDto | null {
  if (pk === null || !found) {
    return null
  }
  return {
    pk: pk.toString(),
    label: found.status === 'found' ? found.record.name : null,
    status: found.status,
  }
}

/** The saved defaults, each checked against InvenTree so Settings can name it or say it's gone. */
export async function readBatchDefaults(
  pool: Pool,
  binding: Binding,
  catalogue: CatalogueReader | undefined,
): Promise<BatchDefaultsDto> {
  const row = await savedRow(pool, binding)
  if (!row) {
    return { revision: '0', location: null, supplier: null }
  }
  const [location, supplier] = await Promise.all([
    lookup(catalogue, 'location', row.locationPk),
    lookup(catalogue, 'supplier', row.supplierPk),
  ])
  const result = {
    revision: row.revision.toString(),
    location: shown(row.locationPk, location),
    supplier: shown(row.supplierPk, supplier),
  }
  validate('BatchDefaults', result)
  return result
}

export async function saveBatchDefaults(
  pool: Pool,
  binding: Binding,
  input: BatchDefaultsUpdateDto,
  catalogue: CatalogueReader | undefined,
) {
  validate('BatchDefaultsUpdate', input)
  const values = {
    locationPk: input.location_pk === null ? null : BigInt(input.location_pk),
    supplierPk: input.supplier_pk === null ? null : BigInt(input.supplier_pk),
  }
  await transaction(pool, async (client) => {
    const db = queryDatabase(client)
    const written =
      input.expected_revision === '0'
        ? await executeDatabaseQuery(
            db
              .insert(batchDefaults)
              .values({
                actorId: binding.actorId,
                targetId: binding.targetId,
                targetContextId: binding.targetContextId,
                ...values,
                revision: 1n,
              })
              .onConflictDoNothing()
              .returning(),
          )
        : await executeDatabaseQuery(
            db
              .update(batchDefaults)
              .set({ ...values, revision: BigInt(input.expected_revision) + 1n })
              .where(
                and(
                  defaultsScope(binding),
                  eq(batchDefaults.revision, BigInt(input.expected_revision)),
                ),
              )
              .returning(),
          )
    if (!written.length) {
      fail('revision_conflict', 412)
    }
  })
  return readBatchDefaults(pool, binding, catalogue)
}

/** What a new batch copies at creation, resolved before its transaction opens. */
export interface CreationDefaults {
  location?: Extract<CatalogueRecordDto, { kind: 'location' }>
  supplier?: Extract<CatalogueRecordDto, { kind: 'supplier' }>
  autoTags: boolean
  instructions: string
  notices: CaptureCreationNoticeDto[]
}

function notice(
  field: CaptureCreationNoticeDto['field'],
  found: CatalogueRecordLookup | undefined,
): CaptureCreationNoticeDto[] {
  if (!found || found.status === 'found') {
    return []
  }
  return [
    { field, code: found.status === 'not_found' ? 'default_not_found' : 'default_unavailable' },
  ]
}

/**
 * Reads the app-level defaults and checks the saved records against InvenTree. A record that
 * can't be found or checked is left out and noted. Runs outside the creation transaction, so a
 * record deleted in between is still copied; the batch's review freshness catches it later.
 */
export async function resolveCreationDefaults(
  pool: Pool,
  binding: Binding,
  catalogue: CatalogueReader | undefined,
): Promise<CreationDefaults> {
  const [row, agentRows] = await Promise.all([
    savedRow(pool, binding),
    executeDatabaseQuery(
      queryDatabase(pool)
        .select({
          autoTags: agentSettings.autoTagsDefault,
          instructions: agentSettings.newBatchInstructions,
        })
        .from(agentSettings)
        .where(
          and(
            eq(agentSettings.actorId, binding.actorId),
            eq(agentSettings.targetId, binding.targetId),
            eq(agentSettings.targetContextId, binding.targetContextId),
          ),
        ),
    ),
  ])
  const [location, supplier] = await Promise.all([
    lookup(catalogue, 'location', row?.locationPk ?? null),
    lookup(catalogue, 'supplier', row?.supplierPk ?? null),
  ])
  return {
    ...(location?.status === 'found' && location.record.kind === 'location'
      ? { location: location.record }
      : {}),
    ...(supplier?.status === 'found' && supplier.record.kind === 'supplier'
      ? { supplier: supplier.record }
      : {}),
    autoTags: agentRows[0]?.autoTags ?? false,
    instructions: agentRows[0]?.instructions ?? '',
    notices: [...notice('location', location), ...notice('supplier', supplier)],
  }
}
