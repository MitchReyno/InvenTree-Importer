import type { PoolClient } from 'pg'
import type { CaptureSnapshotDto } from '@invimport/contracts'
import { CaptureError } from '../capture/repository.ts'
import { lockMediaRevision } from '../media/commands.ts'
import { mediaSnapshot } from '../media/read.ts'
import { scopeMediaInputs, type MediaInputs } from '../media/inputs.ts'
import { materialize, issue, type ManualMaterial } from './model.ts'
import { loadReviewContext } from '../capture/review-context.ts'
import type { ManualConfig } from './authority.ts'

const MAX_APPROVED_MEDIA_VERSIONS = 64
const MAX_APPROVED_MEDIA_BYTES = 256n * 1024n * 1024n

async function unavailableMedia(
  client: PoolClient,
  config: ManualConfig,
  snapshot: CaptureSnapshotDto,
  material: ManualMaterial,
) {
  if (config.mediaEnabled === undefined) {
    return material
  }
  const retained = await client.query('SELECT 1 FROM media_batch WHERE batch_id=$1', [snapshot.id])
  if (retained.rowCount) {
    material.issues.push(
      issue(
        'media_storage_unavailable',
        'Restore the configured private media store before preparing this batch. Retained selections cannot be omitted.',
      ),
    )
  }
  return material
}

function requireBoundedClosure(inputsBySubject: ReadonlyMap<string, MediaInputs>) {
  const unique = new Map<string, string>()
  for (const inputs of inputsBySubject.values()) {
    for (const version of inputs.versions) {
      unique.set(version.versionId, version.byteSize)
    }
  }
  let totalBytes = 0n
  for (const size of unique.values()) {
    totalBytes += BigInt(size)
  }
  return unique.size <= MAX_APPROVED_MEDIA_VERSIONS && totalBytes <= MAX_APPROVED_MEDIA_BYTES
}

/** Scope media per subject so lot-only edits do not invalidate unrelated lots. */
export async function materializeWithMedia(
  client: PoolClient,
  config: ManualConfig,
  snapshot: CaptureSnapshotDto,
  selectedIds: string[],
  lock = true,
): Promise<ManualMaterial> {
  const context = await loadReviewContext(client, snapshot.id)
  const base = materialize(snapshot, selectedIds, new Map(), context)
  if (!config.mediaEnabled) {
    return unavailableMedia(client, config, snapshot, base)
  }
  if (lock) {
    await lockMediaRevision(client, snapshot.id)
  }
  const media = await mediaSnapshot(client, config, snapshot.id)
  const inputsBySubject = new Map<string, MediaInputs>()
  const digests = new Map<string, string>()
  for (const subject of base.subjects) {
    let inputs: MediaInputs
    try {
      inputs = scopeMediaInputs(media, [subject.subjectId])
    } catch (error) {
      if (error instanceof CaptureError && error.code === 'media_not_ready') {
        base.issues.push(
          issue(
            'media_not_ready',
            'Wait for linked media preparation or remove that evidence link from this scope.',
          ),
        )
        return base
      }
      throw error
    }
    if (inputs.versions.length || inputs.attachments.length) {
      inputsBySubject.set(subject.subjectId, inputs)
      digests.set(subject.subjectId, inputs.digest.toString('hex'))
    }
  }
  if (!requireBoundedClosure(inputsBySubject)) {
    base.issues.push(
      issue(
        'media_scope_limit',
        'Choose a smaller scope: one preparation supports at most 64 media versions and 256 MiB of exact retained bytes.',
      ),
    )
    return base
  }
  const linkedMediaSubjects = new Set(media.evidence.flatMap((value) => value.linked_subject_ids))
  const material = materialize(snapshot, selectedIds, digests, context, linkedMediaSubjects)
  material.mediaConfigured = true
  material.mediaInputs = inputsBySubject
  return material
}
