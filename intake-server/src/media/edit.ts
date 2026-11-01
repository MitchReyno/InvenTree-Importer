import { requireMediaRecipeBounds } from '@invimport/contracts/media'
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { validate, type MediaEditDto } from '@invimport/contracts'
import { canonicalMedia, idempotentMedia } from './encoding.ts'
import { appendEvent, sha256 } from '../db/authority.ts'
import { transaction } from '../db/database.ts'
import { fail, type CaptureBinding } from '../capture/repository.ts'
import { advanceMediaRevision, lockMediaBatch } from './commands.ts'
import { mediaSnapshot } from './read.ts'
import { DECODER_BUILD } from './repository.ts'

type Change = MediaEditDto['change']

async function requireEvidence(client: PoolClient, batchId: string, evidenceId: string) {
  const found = await client.query('SELECT 1 FROM media_evidence WHERE batch_id=$1 AND id=$2', [
    batchId,
    evidenceId,
  ])
  if (!found.rowCount) {
    fail('not_found', 404)
  }
}

async function createGroup(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  label: string,
) {
  const count = await client.query<{ count: string }>(
    'SELECT count(*) FROM media_group WHERE batch_id=$1',
    [batchId],
  )
  if (BigInt(count.rows[0].count) >= 100n) {
    fail('media_capacity', 409)
  }
  await client.query('INSERT INTO media_group(id,batch_id,label,actor_id) VALUES($1,$2,$3,$4)', [
    randomUUID(),
    batchId,
    label,
    binding.actorId,
  ])
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
    const group = await client.query('SELECT 1 FROM media_group WHERE batch_id=$1 AND id=$2', [
      batchId,
      change.group_id,
    ])
    if (!group.rowCount) {
      fail('not_found', 404)
    }
  }
  await client.query(
    `INSERT INTO media_group_selection(id,batch_id,evidence_id,group_id,revision,actor_id)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [randomUUID(), batchId, change.evidence_id, change.group_id, revision, binding.actorId],
  )
}

async function linkEvidence(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  revision: string,
  change: Extract<Change, { kind: 'link' }>,
) {
  await requireEvidence(client, batchId, change.evidence_id)
  const subject = await client.query('SELECT 1 FROM capture_subject WHERE batch_id=$1 AND id=$2', [
    batchId,
    change.subject_id,
  ])
  if (!subject.rowCount) {
    fail('not_found', 404)
  }
  await client.query(
    `INSERT INTO media_subject_link(id,batch_id,evidence_id,subject_id,linked,revision,actor_id)
     VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [
      randomUUID(),
      batchId,
      change.evidence_id,
      change.subject_id,
      change.linked,
      revision,
      binding.actorId,
    ],
  )
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
  if (snapshot.derivations.length >= 200 || evidence!.versions.length >= 100) {
    fail('media_capacity', 409)
  }
  const derivationId = change.derivation_id ?? randomUUID()
  const bytes = Buffer.from(canonicalMedia(recipe))
  const inserted = await client.query(
    `INSERT INTO media_derivation(id,batch_id,evidence_id,source_version_id,recipe_bytes,recipe_digest,actor_id)
     VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING RETURNING id`,
    [derivationId, batchId, change.evidence_id, source.id, bytes, sha256(bytes), binding.actorId],
  )
  if (!inserted.rowCount) {
    fail('media_resource_conflict', 409)
  }
  await client.query(
    `INSERT INTO media_decode_command(id,batch_id,version_id,derivation_id,build)
     VALUES($1,$2,$3,$4,$5)`,
    [randomUUID(), batchId, source.id, derivationId, DECODER_BUILD],
  )
}

async function selectAttachment(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  revision: string,
  change: Extract<Change, { kind: 'select_attachment' }>,
) {
  const subject = await client.query(
    "SELECT 1 FROM capture_subject WHERE batch_id=$1 AND id=$2 AND kind='lot'",
    [batchId, change.subject_id],
  )
  if (!subject.rowCount) {
    fail('not_found', 404)
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
  await client.query(
    `INSERT INTO media_attachment_selection(id,batch_id,subject_id,mode,version_id,destination,revision,actor_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      randomUUID(),
      batchId,
      change.subject_id,
      change.mode,
      change.version_id,
      change.destination,
      revision,
      binding.actorId,
    ],
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
          case 'group':
            await createGroup(client, binding, batchId, change.label)
            break
          case 'move':
            await moveEvidence(client, binding, batchId, revision, change)
            break
          case 'link':
            await linkEvidence(client, binding, batchId, revision, change)
            break
          case 'derive':
            await requestDerivation(client, binding, batchId, change)
            break
          case 'select_attachment':
            await selectAttachment(client, binding, batchId, revision, change)
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
