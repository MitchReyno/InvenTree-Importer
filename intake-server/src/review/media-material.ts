import { eq } from 'drizzle-orm'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { mediaBatches } from '../media/schema.ts'
import type { PoolClient } from 'pg'
import { lotLocationGroups, type CaptureSnapshotDto } from '@invimport/contracts'
import { CaptureError } from '../capture/repository.ts'
import { lockMediaRevision } from '../media/commands.ts'
import { mediaSnapshot } from '../media/read.ts'
import { scopeMediaInputs, type MediaInputs, type MediaInputVersion } from '../media/inputs.ts'
import type { MediaSnapshotDto } from '@invimport/contracts'
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
  const retained = await executeDatabaseQuery(
    queryDatabase(client)
      .select({ batchId: mediaBatches.batchId })
      .from(mediaBatches)
      .where(eq(mediaBatches.batchId, snapshot.id)),
  )
  if (retained.length) {
    material.issues.push(
      issue(
        'media_storage_unavailable',
        'Restore the configured private media store before preparing this batch. Retained selections cannot be omitted.',
      ),
    )
  }
  return material
}

export function requireBoundedClosure(
  inputsBySubject: ReadonlyMap<string, MediaInputs>,
  extra: readonly MediaInputVersion[] = [],
) {
  const unique = new Map<string, string>()
  for (const inputs of [...inputsBySubject.values(), { versions: extra }]) {
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
    if (base.companies?.some((company) => company.logo)) {
      base.issues.push(logoUnavailable())
    }
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
  const material = materialize(
    snapshot,
    selectedIds,
    digests,
    context,
    linkedMediaSubjects,
    lotLocationGroups(media.evidence),
  )
  material.mediaConfigured = true
  material.mediaInputs = inputsBySubject
  for (const company of material.companies ?? []) {
    if (company.logo) {
      const versions = logoVersions(media, company.logo)
      if (versions) {
        company.logoVersions = versions
      } else {
        material.issues.push(logoUnavailable())
      }
    }
  }
  // The approved closure includes a new supplier logo and its original.
  const logos = (material.companies ?? []).flatMap((company) => company.logoVersions ?? [])
  if (logos.length && !requireBoundedClosure(inputsBySubject, logos)) {
    material.issues.push(
      issue(
        'media_scope_limit',
        'Choose a smaller scope: one preparation supports at most 64 media versions and 256 MiB of exact retained bytes.',
      ),
    )
  }
  return material
}

function logoUnavailable() {
  return issue(
    'company_logo_unavailable',
    'The new supplier logo is not a ready retained PNG or JPEG in this batch. Choose another logo or remove it.',
  )
}

/** A logo must be a ready same-batch PNG/JPEG; a crop also carries its original's authority. */
function logoVersions(
  media: MediaSnapshotDto,
  logo: { evidence_id: string; version_id: string },
): MediaInputVersion[] | null {
  const evidence = media.evidence.find((item) => item.id === logo.evidence_id)
  const chosen = evidence?.versions.find((version) => version.id === logo.version_id)
  if (
    !evidence ||
    !chosen ||
    chosen.state !== 'ready' ||
    (chosen.media_type !== 'image/png' && chosen.media_type !== 'image/jpeg')
  ) {
    return null
  }
  const originalId = chosen.recipe?.source_version_id ?? chosen.id
  const original = evidence.versions.find((version) => version.id === originalId)
  if (!original || original.kind !== 'original' || original.state !== 'ready') {
    return null
  }

  const input = (version: typeof chosen): MediaInputVersion => ({
    versionId: version.id,
    evidenceId: evidence.id,
    kind: version.kind,
    digest: version.digest,
    byteSize: version.byte_size,
    mediaType: version.media_type,
    recipe: version.recipe,
  })

  return chosen.id === original.id ? [input(chosen)] : [input(chosen), input(original)]
}
