import { activeMediaGroups, retainGroupHistory, retainEvidenceNote } from './context.ts'
import { requireMediaRecipeBounds, MediaEvidence, MediaSnapshot } from '@invimport/contracts/media'
import { and, count, eq } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  validate,
  type CaptureSnapshotDto,
  type MediaEditDto,
  type MediaEvidenceDto,
  type MediaSnapshotDto,
} from '@invimport/contracts'
import { canonicalMedia, idempotentMedia } from './encoding.ts'
import { appendEvent, sha256 } from '../db/authority.ts'
import { executeDatabaseQuery, queryDatabase, transaction } from '../db/database.ts'
import {
  mediaAttachmentSelections,
  mediaDecodeCommands,
  mediaDerivations,
  mediaEvidence,
  mediaGroups,
  mediaLinks,
  mediaMemberships,
} from './schema.ts'
import { fail, type CaptureBinding } from '../capture/model.ts'
import { advanceMediaRevision, lockMediaBatch } from './commands.ts'
import { mediaSnapshot } from './read.ts'
import { DECODER_BUILD } from './repository.ts'

type Change = MediaEditDto['change']

async function requireEvidence(client: PoolClient, batchId: string, evidenceId: string) {
  const rows = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ id: mediaEvidence.id })
      .from(mediaEvidence)
      .where(and(eq(mediaEvidence.batchId, batchId), eq(mediaEvidence.id, evidenceId))),
  )
  if (!rows.length) {
    fail('not_found', 404)
  }
}

async function createGroup(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  label: string,
) {
  const db = queryDatabase(client)
  const groups = await executeDatabaseQuery(
    db.select({ count: count() }).from(mediaGroups).where(eq(mediaGroups.batchId, batchId)),
  )
  if (groups[0].count >= 100) {
    fail('media_capacity', 409)
  }
  await executeDatabaseQuery(
    db.insert(mediaGroups).values({ id: randomUUID(), batchId, label, actorId: binding.actorId }),
  )
}

async function moveEvidence(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  revision: string,
  change: Extract<Change, { kind: 'move' }>,
) {
  await requireEvidence(client, batchId, change.evidence_id)
  if (change.group_id !== null) {
    const groups = await activeMediaGroups(client, batchId)
    if (!groups.some((group) => group.id === change.group_id)) {
      fail('not_found', 404)
    }
  }
  await executeDatabaseQuery(
    queryDatabase(client).insert(mediaMemberships).values({
      id: randomUUID(),
      batchId,
      evidenceId: change.evidence_id,
      groupId: change.group_id,
      revision,
      actorId: binding.actorId,
    }),
  )
}

async function linkEvidence(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  revision: string,
  change: Extract<Change, { kind: 'link' }>,
  capture: CaptureSnapshotDto,
) {
  await requireEvidence(client, batchId, change.evidence_id)
  const subjects = [...capture.parts, ...capture.lots]
  if (!subjects.some((subject) => subject.id === change.subject_id)) {
    fail('not_found', 404)
  }
  requireActiveLot(capture, change.subject_id)
  await executeDatabaseQuery(
    queryDatabase(client).insert(mediaLinks).values({
      id: randomUUID(),
      batchId,
      evidenceId: change.evidence_id,
      subjectId: change.subject_id,
      linked: change.linked,
      revision,
      actorId: binding.actorId,
    }),
  )
}

/** Completed versions consume one slot; only explicit non-publishing outcomes release a reservation. */
function reservedVersionCount(evidence: MediaEvidenceDto, snapshot: MediaSnapshotDto) {
  const publishedVersions = new Set(evidence.versions.map((version) => version.id))
  const nonPublishingOutcomes = new Set([
    'unsupported',
    'encrypted',
    'malformed',
    'limit_exceeded',
    'interrupted',
  ])
  const pending = snapshot.derivations.filter((derivation) => {
    if (derivation.evidence_id !== evidence.id) {
      return false
    }
    if (derivation.version_id && publishedVersions.has(derivation.version_id)) {
      return false
    }
    return !nonPublishingOutcomes.has(derivation.state)
  })
  return evidence.versions.length + pending.length
}

async function requestDerivation(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  change: Extract<Change, { kind: 'derive' }>,
) {
  const snapshot = await mediaSnapshot(client, binding, batchId)
  const evidence = snapshot.evidence.find((item) => item.id === change.evidence_id)
  const source = evidence?.versions.find(
    (version) => version.id === change.recipe.source_version_id,
  )
  const page = source?.pages.find((item) => item.page === change.recipe.page)
  const recipe = change.recipe
  if (
    !source ||
    source.kind !== 'original' ||
    source.state !== 'ready' ||
    source.digest !== recipe.source_digest ||
    !page ||
    page.width !== recipe.source_width ||
    page.height !== recipe.source_height
  ) {
    fail('invalid_recipe_source', 409)
  }
  try {
    requireMediaRecipeBounds(recipe)
  } catch {
    fail('invalid_recipe_source', 409)
  }
  if (
    snapshot.derivations.length >= MediaSnapshot.properties.derivations.maxItems! ||
    reservedVersionCount(evidence!, snapshot) >= MediaEvidence.properties.versions.maxItems!
  ) {
    fail('media_capacity', 409)
  }
  const derivationId = change.derivation_id ?? randomUUID()
  const bytes = Buffer.from(canonicalMedia(recipe))
  const db = queryDatabase(client)
  const inserted = await executeDatabaseQuery(
    db
      .insert(mediaDerivations)
      .values({
        id: derivationId,
        batchId,
        evidenceId: change.evidence_id,
        sourceVersionId: source.id,
        recipeBytes: bytes,
        recipeDigest: sha256(bytes),
        actorId: binding.actorId,
      })
      .onConflictDoNothing({ target: mediaDerivations.id })
      .returning({ id: mediaDerivations.id }),
  )
  if (!inserted.length) {
    fail('media_resource_conflict', 409)
  }
  await executeDatabaseQuery(
    db.insert(mediaDecodeCommands).values({
      id: randomUUID(),
      batchId,
      versionId: source.id,
      derivationId,
      build: DECODER_BUILD,
    }),
  )
}

/** Retired lots are frozen history: evidence links and attachments no longer change. */
function requireActiveLot(capture: CaptureSnapshotDto, subjectId: string) {
  const lot = capture.lots.find((subject) => subject.id === subjectId)
  if (lot?.retired === true) {
    fail('lot_retired', 409)
  }
}

async function selectAttachment(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  revision: string,
  change: Extract<Change, { kind: 'select_attachment' }>,
  capture: CaptureSnapshotDto,
) {
  const subjects = change.destination === 'lot_attachment' ? capture.lots : capture.parts
  if (!subjects.some((subject) => subject.id === change.subject_id)) {
    fail('not_found', 404)
  }
  if (change.destination === 'lot_attachment') {
    requireActiveLot(capture, change.subject_id)
  }
  if ((change.mode === 'selected') !== (change.version_id !== null)) {
    fail('invalid_attachment_selection')
  }
  if (change.version_id) {
    const snapshot = await mediaSnapshot(client, binding, batchId)
    const version = snapshot.evidence
      .flatMap((item) => item.versions)
      .find((item) => item.id === change.version_id)
    if (!version || version.state !== 'ready') {
      fail('media_not_ready', 409)
    }
  }
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(mediaAttachmentSelections)
      .values({
        id: randomUUID(),
        batchId,
        subjectId: change.subject_id,
        subjectKind: change.destination === 'part_attachment' ? 'part' : 'lot',
        mode: change.mode,
        versionId: change.version_id,
        destination: change.destination,
        revision,
        actorId: binding.actorId,
      }),
  )
}

/** Every media edit retains its own semantic command and exact optimistic revision. */
export async function editMedia(
  pool: Pool,
  binding: CaptureBinding,
  batchId: string,
  key: string,
  input: MediaEditDto,
) {
  validate('MediaEdit', input)
  return transaction(pool, (client) =>
    idempotentMedia(
      client,
      {
        actorId: binding.actorId,
        action: 'media_edit',
        resourceKey: `${binding.targetId}:${binding.targetContextId}:${batchId}`,
        key,
      },
      input,
      async () => {
        const capture = await lockMediaBatch(client, binding, batchId, input.expected_revision)
        const revision = (BigInt(input.expected_revision) + 1n).toString()
        const change = input.change
        switch (change.kind) {
          case 'rename_group':
          case 'ungroup': {
            const group = (await activeMediaGroups(client, batchId)).find(
              (value) => value.id === change.group_id,
            )
            if (!group) {
              fail('not_found', 404)
            }
            if (change.kind === 'ungroup') {
              const current = await mediaSnapshot(client, binding, batchId)
              for (const evidence of current.evidence.filter(
                (item) => item.group_id === group.id,
              )) {
                await moveEvidence(client, binding, batchId, revision, {
                  kind: 'move',
                  evidence_id: evidence.id,
                  group_id: null,
                })
              }
            }
            await retainGroupHistory(
              client,
              batchId,
              binding.actorId,
              group.id,
              revision,
              change.kind === 'rename_group' ? change.label : group.label,
              change.kind === 'ungroup',
            )
            break
          }
          case 'move_many':
            for (const evidenceId of change.evidence_ids) {
              await requireEvidence(client, batchId, evidenceId)
            }
            for (const evidenceId of change.evidence_ids) {
              await moveEvidence(client, binding, batchId, revision, {
                kind: 'move',
                evidence_id: evidenceId,
                group_id: change.group_id,
              })
            }
            break
          case 'evidence_note':
            await requireEvidence(client, batchId, change.evidence_id)
            await retainEvidenceNote(
              client,
              batchId,
              binding.actorId,
              change.evidence_id,
              revision,
              change.text,
            )
            break
          case 'group':
            await createGroup(client, binding, batchId, change.label)
            break
          case 'move':
            await moveEvidence(client, binding, batchId, revision, change)
            break
          case 'link':
            await linkEvidence(client, binding, batchId, revision, change, capture.snapshot)
            break
          case 'derive':
            await requestDerivation(client, binding, batchId, change)
            break
          case 'select_attachment':
            await selectAttachment(client, binding, batchId, revision, change, capture.snapshot)
            break
        }
        await advanceMediaRevision(client, batchId)
        await appendEvent(client, capture.streamId, 'media_changed', {
          batch_id: batchId,
          revision,
        })
        return mediaSnapshot(client, binding, batchId)
      },
    ),
  )
}
