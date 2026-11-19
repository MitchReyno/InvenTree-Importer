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
import { requireCurrentTargetContext } from './target-context.ts'

type SavedRow = { revision: bigint; locationPk: bigint | null; supplierPk: bigint | null }

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

/**
 * Catalogue lookups for these PKs, fenced on both sides so a rotated target context never
 * answers for, or with records from, the retired one.
 */
async function fencedLookups(
  pool: Pool,
  binding: Binding,
  catalogue: CatalogueReader | undefined,
  pks: { location: bigint | null; supplier: bigint | null },
) {
  await requireCurrentTargetContext(pool, binding)
  const [location, supplier] = await Promise.all([
    lookup(catalogue, 'location', pks.location),
    lookup(catalogue, 'supplier', pks.supplier),
  ])
  await requireCurrentTargetContext(pool, binding)
  return { location, supplier }
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

function defaultsResult(
  row: SavedRow,
  found: Awaited<ReturnType<typeof fencedLookups>>,
): BatchDefaultsDto {
  const result = {
    revision: row.revision.toString(),
    location: shown(row.locationPk, found.location),
    supplier: shown(row.supplierPk, found.supplier),
  }
  validate('BatchDefaults', result)
  return result
}

/** The saved defaults, each checked against InvenTree so Settings can name it or say it's gone. */
export async function readBatchDefaults(
  pool: Pool,
  binding: Binding,
  catalogue: CatalogueReader | undefined,
): Promise<BatchDefaultsDto> {
  const row = await savedRow(pool, binding)
  if (!row) {
    await requireCurrentTargetContext(pool, binding)
    return { revision: '0', location: null, supplier: null }
  }
  const found = await fencedLookups(pool, binding, catalogue, {
    location: row.locationPk,
    supplier: row.supplierPk,
  })
  return defaultsResult(row, found)
}

/** A newly chosen record must exist; an unchanged one may have gone missing since it was saved. */
function requireChosen(
  chosen: bigint | null,
  saved: bigint | null | undefined,
  found: CatalogueRecordLookup | undefined,
) {
  if (chosen === null || chosen === saved || found?.status === 'found') {
    return
  }
  if (found?.status === 'not_found') {
    fail('batch_default_not_found', 422)
  }
  fail('catalogue_unavailable', 503)
}

export async function saveBatchDefaults(
  pool: Pool,
  binding: Binding,
  input: BatchDefaultsUpdateDto,
  catalogue: CatalogueReader | undefined,
): Promise<BatchDefaultsDto> {
  validate('BatchDefaultsUpdate', input)
  const values = {
    locationPk: input.location_pk === null ? null : BigInt(input.location_pk),
    supplierPk: input.supplier_pk === null ? null : BigInt(input.supplier_pk),
  }
  const previous = await savedRow(pool, binding)
  // A stale save is a conflict, whatever the catalogue would say about its records.
  if ((previous?.revision.toString() ?? '0') !== input.expected_revision) {
    fail('revision_conflict', 412)
  }
  const found = await fencedLookups(pool, binding, catalogue, {
    location: values.locationPk,
    supplier: values.supplierPk,
  })
  requireChosen(values.locationPk, previous?.locationPk, found.location)
  requireChosen(values.supplierPk, previous?.supplierPk, found.supplier)
  const row = await transaction(pool, async (client) => {
    await requireCurrentTargetContext(client, binding)
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
    return written[0] ?? fail('revision_conflict', 412)
  })
  // The committed row, not a later read, so a save never reports another tab's values.
  return defaultsResult(row, found)
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
  const { location, supplier } = await fencedLookups(pool, binding, catalogue, {
    location: row?.locationPk ?? null,
    supplier: row?.supplierPk ?? null,
  })
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
