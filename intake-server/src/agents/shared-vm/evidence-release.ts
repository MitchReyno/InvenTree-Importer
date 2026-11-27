import { randomUUID } from 'node:crypto'

// Set by the trusted tool-server encoder. Never derive format from result metadata.
export const evidenceFormatHeader = 'x-intake-evidence-format'

/** Receipts belong to one authenticated bridge turn and never enter the MCP response. */
export interface EvidenceRelease {
  version: string
  /** The page the trusted tool server delivered; absent from a host that didn't report it. */
  page?: number
}

export class TurnEvidenceReleases {
  private readonly versions = new Map<string, EvidenceRelease>()
  private readonly confirmed = new Set<string>()

  prepare(id: number | string, body: string, evidenceFormat: string | null) {
    const reply = JSON.parse(body)
    const result = reply.result
    if (!result?.content?.some((item: { type: string }) => item.type === 'image')) {
      return {}
    }
    const source = result.structuredContent?.source
    if (
      reply.id !== id ||
      result.isError ||
      result.structuredContent?.ok !== true ||
      source?.kind !== 'media_version' ||
      typeof source.version_id !== 'string'
    ) {
      throw new Error('invalid_evidence_file')
    }
    if (evidenceFormat !== 'legacy' && evidenceFormat !== 'current') {
      throw new Error('invalid_evidence_format')
    }
    const page = result.structuredContent?.delivered?.page
    const releaseId = randomUUID()
    this.versions.set(releaseId, {
      version: source.version_id,
      ...(Number.isInteger(page) && page >= 1 ? { page: page as number } : {}),
    })
    return { releaseId, evidenceFormat }
  }

  confirm(id: unknown, grant: (release: EvidenceRelease) => void) {
    const release = typeof id === 'string' ? this.versions.get(id) : undefined
    if (!release || typeof id !== 'string') {
      throw new Error('unknown_evidence_release')
    }
    if (!this.confirmed.has(id)) {
      grant(release)
      this.confirmed.add(id)
    }
  }
}
