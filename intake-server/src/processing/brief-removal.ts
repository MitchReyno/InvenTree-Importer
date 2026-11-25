import type { PoolClient } from 'pg'
import type { BriefEntryDto } from '@invimport/contracts'
import { removedEvidenceIds, removedVersionIds, versionRemovedSql } from '#/media/removal.ts'

/**
 * A brief's entries without what concerns evidence removed since they were assembled: its
 * evidence, observations and their corrections, notes and keep-out regions. A sealed brief keeps
 * its bytes; this is applied wherever entries reach a session, as nothing of removed evidence may.
 */
export async function withoutRemovedMedia(
  client: PoolClient,
  batchId: string,
  entries: readonly BriefEntryDto[],
): Promise<BriefEntryDto[]> {
  const evidence = await removedEvidenceIds(client, batchId)
  if (!evidence.size) {
    return [...entries]
  }
  const versionIds = entries.flatMap((entry) => {
    if (entry.kind === 'evidence') {
      return [entry.version_id]
    }
    if (entry.kind === 'observation') {
      return [entry.observation.evidence_version_id]
    }
    return entry.kind === 'keep_out' ? [entry.evidence_version_id] : []
  })
  const versions = await removedVersionIds(client, batchId, versionIds)
  const corrected = entries.flatMap((entry) =>
    entry.kind === 'correction' ? [entry.observation_id] : [],
  )
  const observations = corrected.length
    ? new Set(
        (
          await client.query<{ id: string }>(
            `SELECT o.id FROM public.capture_evidence_observation o
               JOIN public.media_version v ON v.id=o.evidence_version_id AND v.batch_id=o.batch_id
              WHERE o.batch_id=$1 AND o.id = ANY($2::uuid[]) AND ${versionRemovedSql('v')}`,
            [batchId, corrected],
          )
        ).rows.map((row) => row.id),
      )
    : new Set<string>()
  return entries.filter((entry) => {
    switch (entry.kind) {
      case 'evidence':
        return !evidence.has(entry.evidence_id) && !versions.has(entry.version_id)
      case 'observation':
        return !versions.has(entry.observation.evidence_version_id)
      case 'keep_out':
        return !versions.has(entry.evidence_version_id)
      case 'note':
        return entry.evidence_id === null || !evidence.has(entry.evidence_id)
      case 'correction':
        return !observations.has(entry.observation_id)
      case 'answer':
      case 'batch':
      case 'identity':
      case 'instruction':
      case 'lot_edit':
      case 'lot':
      case 'part':
      case 'question':
      case 'setting_note':
        return true
    }
  })
}
