import { randomUUID } from 'node:crypto'

// Set by the trusted tool-server encoder. Never derive format from result metadata.
export const evidenceFormatHeader = 'x-intake-evidence-format'

/** Receipts belong to one authenticated bridge turn and never enter the MCP response. */
export class TurnEvidenceReleases {
  private readonly versions = new Map<string, string>()
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
    const releaseId = randomUUID()
    this.versions.set(releaseId, source.version_id)
    return { releaseId, evidenceFormat }
  }

  confirm(id: unknown, grant: (version: string) => void) {
    const version = typeof id === 'string' ? this.versions.get(id) : undefined
    if (!version || typeof id !== 'string') {
      throw new Error('unknown_evidence_release')
    }
    if (!this.confirmed.has(id)) {
      grant(version)
      this.confirmed.add(id)
    }
  }
}
