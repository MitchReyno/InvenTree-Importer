import { prepareMediaTransaction } from './transaction.ts'
import type { PoolClient } from 'pg'
import type { MediaRecipeDto, MediaSnapshotDto } from '@invimport/contracts'
import { assertMediaInputManifest } from '@invimport/contracts/media'
import { strictJson } from '@invimport/contracts/json'
import { canonicalMedia } from './encoding.ts'
import { sha256, verifyBytes } from '../db/authority.ts'
import { captureInTransaction, fail, type CaptureBinding } from '../capture/repository.ts'
import { lockMediaRevision } from './commands.ts'
import { mediaSnapshot } from './read.ts'

export interface MediaInputVersion {
  versionId: string
  evidenceId: string
  kind: 'original' | 'derived'
  digest: string
  byteSize: string
  mediaType: string
  recipe: MediaRecipeDto | null
}

export type MediaAttachmentSelection = MediaSnapshotDto['attachments'][number]

export interface MediaInputs {
  batchId: string
  subjectIds: string[]
  versions: MediaInputVersion[]
  attachments: MediaAttachmentSelection[]
  bytes: Buffer
  digest: Buffer
}

/** Caller takes capture subject locks before this seam, then processing/run locks afterward. */
export async function resolveMediaInputs(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  subjectIds: readonly string[],
): Promise<MediaInputs> {
  await prepareMediaTransaction(client)
  const capture = await captureInTransaction(client, binding, batchId, true)
  const selectedSubjects = [...new Set(subjectIds)].sort()
  const availableSubjects = new Set(
    [...capture.snapshot.parts, ...capture.snapshot.lots].map((subject) => subject.id),
  )
  if (selectedSubjects.some((subjectId) => !availableSubjects.has(subjectId))) {
    fail('not_found', 404)
  }
  await lockMediaRevision(client, batchId)
  const snapshot = await mediaSnapshot(client, binding, batchId)
  return scopeMediaInputs(snapshot, selectedSubjects)
}

/** Pure selected closure over an already authorized, validated media snapshot. */
export function scopeMediaInputs(
  snapshot: MediaSnapshotDto,
  subjectIds: readonly string[],
): MediaInputs {
  const selectedSubjects = [...new Set(subjectIds)].sort()
  const selectedAttachments = snapshot.attachments.filter((attachment) =>
    selectedSubjects.includes(attachment.subject_id),
  )
  const chosenVersions = new Set(
    selectedAttachments.flatMap((attachment) =>
      attachment.version_id ? [attachment.version_id] : [],
    ),
  )
  const relevantEvidence = snapshot.evidence.filter(
    (evidence) =>
      evidence.linked_subject_ids.some((subjectId) => selectedSubjects.includes(subjectId)) ||
      evidence.versions.some((version) => chosenVersions.has(version.id)),
  )
  const versions: MediaInputVersion[] = []
  for (const evidence of relevantEvidence) {
    for (const version of evidence.versions) {
      const selected = chosenVersions.has(version.id)
      const original = version.kind === 'original'
      if (selected || original) {
        if (version.state !== 'ready') {
          fail('media_not_ready', 409)
        }
        versions.push({
          versionId: version.id,
          evidenceId: evidence.id,
          kind: version.kind,
          digest: version.digest,
          byteSize: version.byte_size,
          mediaType: version.media_type,
          recipe: version.recipe,
        })
      }
    }
  }
  versions.sort((left, right) => left.versionId.localeCompare(right.versionId))
  const bytes = Buffer.from(
    canonicalMedia({
      version: 'media-inputs/1',
      batchId: snapshot.batch_id,
      subjectIds: selectedSubjects,
      attachments: selectedAttachments,
      evidence: relevantEvidence.map((evidence) => ({
        evidenceId: evidence.id,
        groupId: evidence.group_id,
        linkedSubjectIds: evidence.linked_subject_ids.filter((subjectId) =>
          selectedSubjects.includes(subjectId),
        ),
      })),
      versions,
    }),
  )
  return {
    batchId: snapshot.batch_id,
    subjectIds: selectedSubjects,
    versions,
    attachments: selectedAttachments,
    bytes,
    digest: sha256(bytes),
  }
}

/** Integrity plus the complete interpreted schema, never a generic hash-and-cast. */
export function decodeMediaInputs(bytes: Buffer, expectedDigest: Buffer): MediaInputs {
  verifyBytes(bytes, expectedDigest)
  const manifest = strictJson(bytes.toString('utf8'))
  assertMediaInputManifest(manifest)
  if (canonicalMedia(manifest) !== bytes.toString('utf8')) {
    throw new Error('noncanonical_media_input_manifest')
  }
  return {
    batchId: manifest.batchId,
    subjectIds: manifest.subjectIds,
    versions: manifest.versions,
    attachments: manifest.attachments,
    bytes,
    digest: expectedDigest,
  }
}
