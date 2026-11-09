import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import {
  captureIntentFromLegacy,
  nextLegacyContext,
  validate,
  type CaptureBatchSettingsChangeDto,
  type CaptureContextRecordDto,
  type CaptureReferenceDraftDto,
  type CaptureReferenceDraftRecordDto,
  type CaptureSettingNoteRecordDto,
  type CaptureSettingNoteScopeDto,
  type CaptureSettingsIntentDto,
} from '@invimport/contracts'
import { canonical } from '@invimport/contracts/json'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { retainedImageVersion } from '../media/context.ts'
import {
  captureObservations,
  captureReferenceDraftIdentities,
  captureReferenceDrafts,
  captureSettingNotes,
  captureSettingsIntents,
} from './schema.ts'
import { retainCaptureContext, validateSupplierReference } from './context.ts'
import { fail } from './model.ts'

export interface SettingsOwner {
  batchId: string
  actorId: string
  targetId: string
  targetContextId: string
}

export type SettingsIntentRecord = {
  value: CaptureSettingsIntentDto
  default_location_draft: string | null
  version: string
  actor_id: string
  created_at: string
}

const NOTE_SCOPES: readonly CaptureSettingNoteScopeDto[] = ['batch', 'order']

export async function readSettingsIntent(
  client: PoolClient,
  batchId: string,
): Promise<SettingsIntentRecord | undefined> {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select()
      .from(captureSettingsIntents)
      .where(eq(captureSettingsIntents.batchId, batchId))
      .orderBy(desc(captureSettingsIntents.version))
      .limit(1),
  )
  const row = rows[0]
  if (!row) {
    return undefined
  }
  const record = {
    value: row.value,
    default_location_draft: row.defaultLocationDraftId,
    version: row.version.toString(),
    actor_id: row.actorId,
    created_at: row.createdAt.toISOString(),
  }
  validate('CaptureSettingsIntentRecord', record)
  return record as SettingsIntentRecord
}

/** Current text (or Remove tombstone) per scope; earlier versions stay in retained history. */
export async function readSettingNotes(
  client: PoolClient,
  batchId: string,
): Promise<CaptureSettingNoteRecordDto[]> {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .selectDistinctOn([captureSettingNotes.scope])
      .from(captureSettingNotes)
      .where(eq(captureSettingNotes.batchId, batchId))
      .orderBy(asc(captureSettingNotes.scope), desc(captureSettingNotes.version)),
  )
  return rows.map((row) => {
    const record = {
      scope: row.scope,
      text: row.text,
      version: row.version.toString(),
      actor_id: row.actorId,
      created_at: row.createdAt.toISOString(),
    }
    validate('CaptureSettingNoteRecord', record)
    return record as CaptureSettingNoteRecordDto
  })
}

type DraftHead = CaptureReferenceDraftRecordDto & { retired: boolean }

async function readDraftHeads(client: PoolClient, batchId: string): Promise<DraftHead[]> {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .selectDistinctOn([captureReferenceDrafts.draftId])
      .from(captureReferenceDrafts)
      .where(eq(captureReferenceDrafts.batchId, batchId))
      .orderBy(asc(captureReferenceDrafts.draftId), desc(captureReferenceDrafts.version)),
  )
  return rows.map((row) => {
    const record = {
      draft_id: row.draftId,
      kind: row.kind,
      value: row.value,
      version: row.version.toString(),
      actor_id: row.actorId,
      created_at: row.createdAt.toISOString(),
    }
    validate('CaptureReferenceDraftRecord', record)
    return { ...(record as CaptureReferenceDraftRecordDto), retired: row.retired }
  })
}

/** Active (non-retired) drafts in stable draft-ID order. */
export async function readReferenceDrafts(
  client: PoolClient,
  batchId: string,
): Promise<CaptureReferenceDraftRecordDto[]> {
  const heads = await readDraftHeads(client, batchId)
  return heads.filter((head) => !head.retired).map(({ retired: _retired, ...record }) => record)
}

export async function hasSettingsIntent(client: PoolClient, batchId: string) {
  return (await readSettingsIntent(client, batchId)) !== undefined
}

async function requireLocationObservation(
  client: PoolClient,
  owner: SettingsOwner,
  reference: { observation_id: string; target_context_id: string; pk: string },
) {
  if (reference.target_context_id !== owner.targetContextId) {
    fail('invalid_reference')
  }
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: captureObservations.id })
      .from(captureObservations)
      .where(
        and(
          eq(captureObservations.id, reference.observation_id),
          eq(captureObservations.batchId, owner.batchId),
          eq(captureObservations.targetId, owner.targetId),
          eq(captureObservations.targetContextId, owner.targetContextId),
          eq(captureObservations.model, 'location'),
          eq(captureObservations.pk, reference.pk),
        ),
      ),
  )
  if (!rows.length) {
    fail('invalid_reference')
  }
}

async function validateDraft(
  client: PoolClient,
  owner: SettingsOwner,
  draft: CaptureReferenceDraftDto,
  retainedKind: string | undefined,
) {
  if (retainedKind !== undefined && retainedKind !== draft.kind) {
    fail('reference_draft_kind_changed', 409)
  }
  if (draft.kind === 'location' && draft.value.parent !== null) {
    await requireLocationObservation(client, owner, draft.value.parent)
  }
  if (draft.kind === 'company' && draft.value.logo !== null) {
    const logo = draft.value.logo
    const image = await retainedImageVersion(
      client,
      owner.batchId,
      logo.evidence_id,
      logo.version_id,
    )
    if (!image) {
      fail('invalid_logo_reference')
    }
  }
}

function requireDraftKind(
  drafts: ReadonlyMap<string, CaptureReferenceDraftDto>,
  draftId: string,
  kind: CaptureReferenceDraftDto['kind'],
  code: string,
) {
  if (drafts.get(draftId)?.kind !== kind) {
    fail(code)
  }
}

async function retainDraft(
  client: PoolClient,
  owner: SettingsOwner,
  draft: CaptureReferenceDraftDto,
  version: string,
  retired: boolean,
) {
  const logo = draft.kind === 'company' ? draft.value.logo : null
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(captureReferenceDrafts)
      .values({
        id: randomUUID(),
        batchId: owner.batchId,
        draftId: draft.draft_id,
        kind: draft.kind,
        version: BigInt(version),
        value: draft.value,
        retired,
        logoEvidenceId: logo?.evidence_id ?? null,
        logoVersionId: logo?.version_id ?? null,
        actorId: owner.actorId,
      }),
  )
}

/** Writes new, changed and retired draft versions; unchanged drafts keep their version. */
async function applyDrafts(
  client: PoolClient,
  owner: SettingsOwner,
  requested: CaptureBatchSettingsChangeDto['drafts'],
  version: string,
) {
  const heads = new Map((await readDraftHeads(client, owner.batchId)).map((h) => [h.draft_id, h]))
  const requestedById = new Map<string, CaptureReferenceDraftDto>()
  for (const draft of requested) {
    if (requestedById.has(draft.draft_id)) {
      fail('duplicate_reference_draft')
    }
    requestedById.set(draft.draft_id, draft)
  }

  for (const draft of requested) {
    const head = heads.get(draft.draft_id)
    await validateDraft(client, owner, draft, head?.kind)
    if (!head) {
      await executeDatabaseQuery(
        queryDatabase(client).insert(captureReferenceDraftIdentities).values({
          batchId: owner.batchId,
          draftId: draft.draft_id,
          kind: draft.kind,
          actorId: owner.actorId,
        }),
      )
    }
    const unchanged = head && !head.retired && canonical(head.value) === canonical(draft.value)
    if (!unchanged) {
      await retainDraft(client, owner, draft, version, false)
    }
  }

  for (const head of heads.values()) {
    if (!head.retired && !requestedById.has(head.draft_id)) {
      const retiring = { draft_id: head.draft_id, kind: head.kind, value: head.value }
      await retainDraft(client, owner, retiring as CaptureReferenceDraftDto, version, true)
    }
  }
  return requestedById
}

async function applyNotes(
  client: PoolClient,
  owner: SettingsOwner,
  notes: CaptureBatchSettingsChangeDto['notes'],
  version: string,
) {
  const current = new Map(
    (await readSettingNotes(client, owner.batchId)).map((note) => [note.scope, note.text]),
  )
  for (const scope of NOTE_SCOPES) {
    const requested = notes[scope]
    const retained = current.get(scope) ?? null
    if (requested === retained) {
      continue
    }
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(captureSettingNotes)
        .values({
          id: randomUUID(),
          batchId: owner.batchId,
          scope,
          version: BigInt(version),
          text: requested,
          actorId: owner.actorId,
        }),
    )
  }
}

async function validateIntentReferences(
  client: PoolClient,
  owner: SettingsOwner,
  change: CaptureBatchSettingsChangeDto,
  drafts: ReadonlyMap<string, CaptureReferenceDraftDto>,
) {
  const selection = change.intent.supplier.selection
  if (selection.mode === 'existing') {
    await validateSupplierReference(client, owner, { mode: 'set', value: selection.reference })
  } else if (selection.mode === 'draft') {
    requireDraftKind(drafts, selection.draft_id, 'company', 'invalid_supplier_draft')
  }
  if (change.default_location.mode === 'draft') {
    requireDraftKind(drafts, change.default_location.draft_id, 'location', 'invalid_location_draft')
  }
}

async function applyIntent(
  client: PoolClient,
  owner: SettingsOwner,
  change: CaptureBatchSettingsChangeDto,
  batchContext: CaptureContextRecordDto | undefined,
  version: string,
) {
  const defaultDraft =
    change.default_location.mode === 'draft' ? change.default_location.draft_id : null
  const current = await readSettingsIntent(client, owner.batchId)
  const intentChanged =
    !current ||
    canonical(current.value) !== canonical(change.intent) ||
    current.default_location_draft !== defaultDraft
  if (intentChanged) {
    await executeDatabaseQuery(
      queryDatabase(client)
        .insert(captureSettingsIntents)
        .values({
          id: randomUUID(),
          batchId: owner.batchId,
          version: BigInt(version),
          value: change.intent,
          defaultLocationDraftId: defaultDraft,
          defaultLocationDraftKind: defaultDraft === null ? null : 'location',
          actorId: owner.actorId,
        }),
    )
  }

  // Consumers of legacy context (Processing, Review fingerprints, lot inheritance) stay current;
  // fields whose intent did not change keep their retained legacy mode.
  const previous = current?.value ?? captureIntentFromLegacy(batchContext?.value)
  const nextContext = nextLegacyContext(batchContext?.value, previous, change.intent)
  if (nextContext && (!batchContext || canonical(batchContext.value) !== canonical(nextContext))) {
    await retainCaptureContext(client, owner, null, version, nextContext)
  }
}

/**
 * Applies a complete-state batch_settings change inside the caller's locked edit transaction.
 * Selection of the Default location remains the caller's responsibility.
 */
export async function applyBatchSettingsIntent(
  client: PoolClient,
  owner: SettingsOwner,
  change: CaptureBatchSettingsChangeDto,
  batchContext: CaptureContextRecordDto | undefined,
  version: string,
) {
  const drafts = await applyDrafts(client, owner, change.drafts, version)
  await validateIntentReferences(client, owner, change, drafts)
  await applyIntent(client, owner, change, batchContext, version)
  await applyNotes(client, owner, change.notes, version)
}
