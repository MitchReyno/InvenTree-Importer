import { assertMediaRecipe } from '@invimport/contracts/media'
import type { MediaEvidenceDto, MediaSnapshotDto, MediaVersionDto } from '@invimport/contracts'
import { strictJson } from '@invimport/contracts/json'
import { verifyBytes } from '#/db/authority.ts'

export interface VersionRow {
  id: string
  evidence_id: string
  kind: 'original' | 'derived'
  blob_digest: Buffer
  byte_size: string
  media_type: MediaVersionDto['media_type']
  state: MediaVersionDto['state'] | null
  decoder_build: string | null
  recipe_bytes: Buffer | null
  recipe_digest: Buffer | null
}

export interface PreviewRow {
  id: string
  version_id: string
  page: number
  width: number
  height: number
}

export interface DerivationRow {
  id: string
  evidence_id: string
  recipe_bytes: Buffer
  recipe_digest: Buffer
  state: MediaVersionDto['state'] | null
  produced_version_id: string | null
}

export interface MediaRows {
  revision: string
  evidence: { id: string; label: string }[]
  versions: VersionRow[]
  previews: PreviewRow[]
  groups: { id: string; label: string }[]
  membership: { evidence_id: string; group_id: string | null }[]
  links: { evidence_id: string; subject_id: string; linked: boolean }[]
  /** Lots reached through active evidence observations of each evidence item. */
  observation_links: { evidence_id: string; subject_id: string }[]
  attachments: MediaSnapshotDto['attachments']
  derivations: DerivationRow[]
}

export function decodeMediaRecipe(bytes: Buffer | null, digest: Buffer | null) {
  if (!bytes && !digest) {
    return null
  }
  if (!bytes || !digest) {
    throw new Error('recipe_authority_missing')
  }
  verifyBytes(bytes, digest)
  const recipe = strictJson(bytes.toString('utf8'))
  assertMediaRecipe(recipe)
  return recipe
}

function projectVersion(version: VersionRow, pages: PreviewRow[]): MediaVersionDto {
  return {
    id: version.id,
    evidence_id: version.evidence_id,
    kind: version.kind,
    digest: version.blob_digest.toString('hex'),
    byte_size: version.byte_size,
    media_type: version.media_type,
    state: version.state ?? 'queued',
    decoder_build: version.decoder_build,
    recipe: decodeMediaRecipe(version.recipe_bytes, version.recipe_digest),
    pages: pages.map((page) => ({
      page: page.page,
      width: page.width,
      height: page.height,
      preview_id: page.id,
    })),
  }
}

function projectEvidence(rows: MediaRows): MediaEvidenceDto[] {
  const pagesByVersion = new Map<string, PreviewRow[]>()
  for (const preview of rows.previews) {
    const pages = pagesByVersion.get(preview.version_id) ?? []
    pages.push(preview)
    pagesByVersion.set(preview.version_id, pages)
  }
  const versionsByEvidence = new Map<string, MediaVersionDto[]>()
  for (const version of rows.versions) {
    const versions = versionsByEvidence.get(version.evidence_id) ?? []
    versions.push(projectVersion(version, pagesByVersion.get(version.id) ?? []))
    versionsByEvidence.set(version.evidence_id, versions)
  }
  const groupsByEvidence = new Map(
    rows.membership.map((membership) => [membership.evidence_id, membership.group_id]),
  )
  const subjectsByEvidence = new Map<string, string[]>()
  for (const link of rows.links) {
    if (link.linked) {
      const subjects = subjectsByEvidence.get(link.evidence_id) ?? []
      subjects.push(link.subject_id)
      subjectsByEvidence.set(link.evidence_id, subjects)
    }
  }
  // Retained links are never rewritten; observation-derived lots are added alongside them.
  for (const link of rows.observation_links) {
    const subjects = subjectsByEvidence.get(link.evidence_id) ?? []
    if (!subjects.includes(link.subject_id)) {
      subjects.push(link.subject_id)
      subjectsByEvidence.set(link.evidence_id, subjects)
    }
  }
  return rows.evidence.map((evidence) => ({
    ...evidence,
    group_id: groupsByEvidence.get(evidence.id) ?? null,
    linked_subject_ids: subjectsByEvidence.get(evidence.id) ?? [],
    versions: versionsByEvidence.get(evidence.id) ?? [],
  }))
}

/** Pure projection over named relational results; caller validates the complete public schema. */
export function projectMediaSnapshot(batchId: string, rows: MediaRows): MediaSnapshotDto {
  return {
    batch_id: batchId,
    revision: rows.revision,
    groups: rows.groups,
    attachments: rows.attachments,
    evidence: projectEvidence(rows),
    derivations: rows.derivations.map((derivation) => {
      const recipe = decodeMediaRecipe(derivation.recipe_bytes, derivation.recipe_digest)
      if (!recipe) {
        throw new Error('recipe_authority_missing')
      }
      return {
        id: derivation.id,
        evidence_id: derivation.evidence_id,
        recipe,
        state: derivation.state ?? 'queued',
        version_id: derivation.produced_version_id,
      }
    }),
  }
}
