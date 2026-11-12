import type { MediaEvidenceDto } from '@invimport/contracts'

export interface MediaIdentityLabels {
  evidence: ReadonlyMap<string, string>
  versions: ReadonlyMap<string, string>
}

function commonPrefixLength(left: string, right = '') {
  let length = 0
  while (length < left.length && left[length] === right[length]) {
    length++
  }
  return length
}

/** Extend colliding prefixes until every retained identity is distinguishable in this snapshot. */
export function mediaIdentityLabels(evidence: readonly MediaEvidenceDto[]): MediaIdentityLabels {
  const ids = [
    ...new Set(
      evidence.flatMap((item) => [item.id, ...item.versions.map((version) => version.id)]),
    ),
  ]
  const sortedIds = ids
    .map((id) => ({ id, compact: id.replaceAll('-', '') }))
    .sort((left, right) => left.compact.localeCompare(right.compact))
  const shortIds = new Map<string, string>()
  for (const [index, identity] of sortedIds.entries()) {
    const previous = sortedIds[index - 1]?.compact
    const next = sortedIds[index + 1]?.compact
    // Only sorted neighbours can have the longest shared prefix; avoid a quadratic scan.
    const length = Math.max(
      8,
      commonPrefixLength(identity.compact, previous) + 1,
      commonPrefixLength(identity.compact, next) + 1,
    )
    shortIds.set(identity.id, identity.compact.slice(0, length))
  }
  const evidenceLabels = new Map<string, string>()
  const versionLabels = new Map<string, string>()
  for (const item of evidence) {
    const evidenceLabel = `${item.label} · evidence ${shortIds.get(item.id)}`
    evidenceLabels.set(item.id, evidenceLabel)
    for (const version of item.versions) {
      const kind = version.kind === 'original' ? 'original' : 'crop'
      versionLabels.set(version.id, `${evidenceLabel} · ${kind} ${shortIds.get(version.id)}`)
    }
  }
  return { evidence: evidenceLabels, versions: versionLabels }
}

/**
 * Labels for normal viewing: a file's name and the version's kind. Files sharing a name are
 * numbered; identifiers stay in the viewer's Details.
 */
export function mediaDisplayLabels(
  evidence: readonly MediaEvidenceDto[],
  removed: readonly DeletedFile[] = [],
): MediaIdentityLabels {
  const evidenceLabels = evidenceDisplayNames(evidence, removed)
  const versionLabels = new Map<string, string>()
  for (const item of evidence) {
    const name = evidenceLabels.get(item.id) ?? item.label
    let crops = 0
    for (const version of item.versions) {
      if (version.kind === 'original') {
        versionLabels.set(version.id, `${name} · original`)
      } else {
        crops += 1
        versionLabels.set(version.id, `${name} · crop ${crops}`)
      }
    }
  }
  return { evidence: evidenceLabels, versions: versionLabels }
}

type NamedFile = Pick<MediaEvidenceDto, 'id' | 'label'>

/** A deleted file, which keeps its place among the batch's files in upload order. */
type DeletedFile = NamedFile & { position: number }

/**
 * Every file in upload order: each deleted file at its position, the present files filling the
 * other places in snapshot order. Positions that don't fit put the deleted files last.
 */
function filesInUploadOrder(evidence: readonly NamedFile[], removed: readonly DeletedFile[]) {
  const total = evidence.length + removed.length
  const placed = new Map(removed.map((item) => [item.position, item]))
  const positionsFit =
    placed.size === removed.length &&
    removed.every(
      (item) => Number.isInteger(item.position) && item.position >= 0 && item.position < total,
    )
  if (!positionsFit) {
    return [...evidence, ...removed]
  }
  const order: NamedFile[] = []
  const present = evidence.values()
  for (let position = 0; position < total; position += 1) {
    const file = placed.get(position) ?? present.next().value
    if (file) {
      order.push(file)
    }
  }
  return order
}

/**
 * Each file's name, numbered in upload order when several files share it. Deleted files are
 * counted too, so deleting or restoring a file never renumbers the others.
 */
export function evidenceDisplayNames(
  present: readonly NamedFile[],
  removed: readonly DeletedFile[] = [],
): Map<string, string> {
  const evidence = filesInUploadOrder(present, removed)
  const counts = new Map<string, number>()
  for (const item of evidence) {
    counts.set(item.label, (counts.get(item.label) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  const names = new Map<string, string>()
  for (const item of evidence) {
    const ordinal = (seen.get(item.label) ?? 0) + 1
    seen.set(item.label, ordinal)
    names.set(
      item.id,
      (counts.get(item.label) ?? 0) > 1 ? `${item.label} (${ordinal})` : item.label,
    )
  }
  return names
}
