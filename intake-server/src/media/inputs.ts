import { prepareMediaTransaction } from './transaction.ts'
import type { PoolClient } from 'pg'
import type { CaptureSnapshotDto, MediaRecipeDto, MediaSnapshotDto } from '@invimport/contracts'
import {
  assertMediaInputManifest,
  MEDIA_INPUT_MAX_BYTES,
  MEDIA_INPUT_MAX_SUBJECTS,
  MEDIA_INPUT_MAX_VERSIONS,
} from '@invimport/contracts/media'
import { strictJson } from '@invimport/contracts/json'
import { canonicalMedia } from './encoding.ts'
import { sha256, verifyBytes } from '../db/authority.ts'
import { captureInTransaction, fail, type CaptureBinding } from '../capture/repository.ts'
import { lockMediaRevision } from './commands.ts'
import { mediaSnapshot } from './read.ts'
import { MediaInputUnavailableError, type MediaInputBlockerCode } from './input-errors.ts'

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

export type MediaSubjectScope = readonly string[]

// Bound repeated closure projection independently of each retained manifest's limits.
const MAX_MEDIA_INPUT_SCOPES = 100

function validatedScopes(
  snapshot: CaptureSnapshotDto,
  subjectScopes: readonly MediaSubjectScope[],
) {
  if (subjectScopes.length > MAX_MEDIA_INPUT_SCOPES) {
    throw new MediaInputUnavailableError('capacity')
  }
  const available = new Set([...snapshot.parts, ...snapshot.lots].map((subject) => subject.id))
  return subjectScopes.map((subjectIds) => {
    const selected = [...new Set(subjectIds)].sort()
    if (selected.some((subjectId) => !available.has(subjectId))) {
      fail('not_found', 404)
    }
    return selected
  })
}

export type MediaInputScopeResult =
  { kind: 'ready'; inputs: MediaInputs } | { kind: 'blocked'; code: MediaInputBlockerCode }

async function readScopedMediaSnapshot(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  subjectScopes: readonly MediaSubjectScope[],
) {
  await prepareMediaTransaction(client)
  const capture = await captureInTransaction(client, binding, batchId)
  const selectedScopes = validatedScopes(capture.snapshot, subjectScopes)
  const snapshot = await mediaSnapshot(client, binding, batchId)
  return { selectedScopes, snapshot }
}

/** Caller owns a consistent read transaction; this seam acquires no domain locks. */
export async function readMediaInputScopes(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  subjectScopes: readonly MediaSubjectScope[],
): Promise<readonly MediaInputs[]> {
  const { selectedScopes, snapshot } = await readScopedMediaSnapshot(
    client,
    binding,
    batchId,
    subjectScopes,
  )
  return Object.freeze(selectedScopes.map((subjects) => scopeMediaInputs(snapshot, subjects)))
}

/** Known blockers belong to their closure; unexpected failures never become successful absence. */
export async function readMediaInputScopeResults(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  subjectScopes: readonly MediaSubjectScope[],
): Promise<readonly MediaInputScopeResult[]> {
  const { selectedScopes, snapshot } = await readScopedMediaSnapshot(
    client,
    binding,
    batchId,
    subjectScopes,
  )
  return Object.freeze(
    selectedScopes.map((subjects): MediaInputScopeResult => {
      try {
        return { kind: 'ready', inputs: scopeMediaInputs(snapshot, subjects) }
      } catch (error) {
        if (!(error instanceof MediaInputUnavailableError)) {
          throw error
        }
        return {
          kind: 'blocked',
          code: error.reason === 'not_ready' ? 'media_not_ready' : 'media_input_capacity',
        }
      }
    }),
  )
}

export async function readMediaInputs(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  subjectIds: MediaSubjectScope,
): Promise<MediaInputs> {
  const scopes = await readMediaInputScopes(client, binding, batchId, [subjectIds])
  return scopes[0]
}

/** Caller takes capture subject locks first; every scope shares one media exclusion/snapshot. */
export async function resolveMediaInputScopes(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  subjectScopes: readonly MediaSubjectScope[],
): Promise<readonly MediaInputs[]> {
  await prepareMediaTransaction(client)
  const capture = await captureInTransaction(client, binding, batchId, true)
  const selectedScopes = validatedScopes(capture.snapshot, subjectScopes)
  await lockMediaRevision(client, batchId)
  const snapshot = await mediaSnapshot(client, binding, batchId)
  return Object.freeze(selectedScopes.map((subjects) => scopeMediaInputs(snapshot, subjects)))
}

/** Compatible single-scope resolver; pin-capable consumers use lockMediaInputs instead. */
export async function resolveMediaInputs(
  client: PoolClient,
  binding: CaptureBinding,
  batchId: string,
  subjectIds: MediaSubjectScope,
): Promise<MediaInputs> {
  const scopes = await resolveMediaInputScopes(client, binding, batchId, [subjectIds])
  return scopes[0]
}

/** Pure selected closure over an already authorized, validated media snapshot. */
export function scopeMediaInputs(
  snapshot: MediaSnapshotDto,
  subjectIds: readonly string[],
): MediaInputs {
  const selectedSubjects = [...new Set(subjectIds)].sort()
  if (selectedSubjects.length > MEDIA_INPUT_MAX_SUBJECTS) {
    throw new MediaInputUnavailableError('capacity')
  }
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
          throw new MediaInputUnavailableError('not_ready')
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
  if (versions.length > MEDIA_INPUT_MAX_VERSIONS) {
    throw new MediaInputUnavailableError('capacity')
  }
  versions.sort((left, right) => left.versionId.localeCompare(right.versionId))
  const bytes = Buffer.from(
    canonicalMedia({
      version: selectedAttachments.some(selection=>selection.destination==='part_attachment')?'media-inputs/2':'media-inputs/1',
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
  if (bytes.length > MEDIA_INPUT_MAX_BYTES) {
    throw new MediaInputUnavailableError('capacity')
  }
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
