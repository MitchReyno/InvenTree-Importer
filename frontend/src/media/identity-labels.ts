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
export function mediaDisplayLabels(evidence: readonly MediaEvidenceDto[]): MediaIdentityLabels {
  const counts = new Map<string, number>()
  for (const item of evidence) {
    counts.set(item.label, (counts.get(item.label) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  const evidenceLabels = new Map<string, string>()
  const versionLabels = new Map<string, string>()
  for (const item of evidence) {
    const ordinal = (seen.get(item.label) ?? 0) + 1
    seen.set(item.label, ordinal)
    const name = (counts.get(item.label) ?? 0) > 1 ? `${item.label} (${ordinal})` : item.label
    evidenceLabels.set(item.id, name)
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
