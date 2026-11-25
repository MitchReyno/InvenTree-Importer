import type { PoolClient } from 'pg'
import type { BriefEntryDto } from '@invimport/contracts'
import { removedEvidenceAndNotes, versionRemovedSql } from '#/media/removal.ts'

/** What of the batch's removed evidence an entry may name: items, versions, notes, observations. */
async function removedMedia(client: PoolClient, batchId: string) {
  const { evidence, notes } = await removedEvidenceAndNotes(client, batchId)
  if (!evidence.size) {
    return null
  }
  const versions = await client.query<{ id: string }>(
    `SELECT v.id FROM public.media_version v WHERE v.batch_id=$1 AND ${versionRemovedSql('v')}`,
    [batchId],
  )
  const observations = await client.query<{ id: string }>(
    `SELECT o.id FROM public.capture_evidence_observation o
       JOIN public.media_version v ON v.id=o.evidence_version_id AND v.batch_id=o.batch_id
      WHERE o.batch_id=$1 AND ${versionRemovedSql('v')}`,
    [batchId],
  )
  return {
    evidence,
    notes,
    versions: new Set(versions.rows.map((row) => row.id)),
    observations: new Set(observations.rows.map((row) => row.id)),
  }
}

type Removed = NonNullable<Awaited<ReturnType<typeof removedMedia>>>

/** Whether a value names any removed item, version, note or observation anywhere within it. */
function namesRemoved(value: unknown, removed: Removed) {
  const ids = JSON.stringify(value).match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
  )
  return (ids ?? []).some(
    (id) =>
      removed.evidence.has(id) ||
      removed.versions.has(id) ||
      removed.notes.has(id) ||
      removed.observations.has(id),
  )
}

/** An observation without its links to observations on removed evidence. */
function withoutRemovedLinks(
  observation: Extract<BriefEntryDto, { kind: 'observation' }>['observation'],
  removed: Removed,
) {
  const { same_item_as: sameItem, ...rest } = observation
  return {
    ...rest,
    ...(sameItem !== undefined && !removed.observations.has(sameItem)
      ? { same_item_as: sameItem }
      : {}),
    supersedes_observation_id:
      observation.supersedes_observation_id !== null &&
      removed.observations.has(observation.supersedes_observation_id)
        ? null
        : observation.supersedes_observation_id,
  }
}

/** The entry as it may still be delivered, or null when it is about removed evidence. */
function deliverable(entry: BriefEntryDto, removed: Removed): BriefEntryDto | null {
  switch (entry.kind) {
    case 'evidence':
      return removed.evidence.has(entry.evidence_id) || removed.versions.has(entry.version_id)
        ? null
        : entry
    case 'observation':
      return removed.versions.has(entry.observation.evidence_version_id)
        ? null
        : { ...entry, observation: withoutRemovedLinks(entry.observation, removed) }
    case 'keep_out':
      return removed.versions.has(entry.evidence_version_id) ? null : entry
    case 'note':
      return (entry.evidence_id !== null && removed.evidence.has(entry.evidence_id)) ||
        removed.notes.has(entry.note_id)
        ? null
        : entry
    case 'correction':
      return removed.observations.has(entry.observation_id) ? null : entry
    case 'identity':
      // A pinned proposal citing or relying on removed evidence is withheld whole.
      return namesRemoved(entry.proposal, removed) ? null : entry
    case 'lot':
      return {
        ...entry,
        observation_ids: entry.observation_ids.filter((id) => !removed.observations.has(id)),
        suggested_observation_ids: entry.suggested_observation_ids.filter(
          (id) => !removed.observations.has(id),
        ),
        reexamine_reasons: entry.reexamine_reasons.filter(
          (reason) => !removed.observations.has(reason.observation_id),
        ),
      }
    case 'answer':
    case 'batch':
    case 'instruction':
    case 'lot_edit':
    case 'part':
    case 'question':
    case 'setting_note':
    case 'vocabulary':
      return entry
  }
}

/**
 * A brief's entries without what concerns evidence removed since they were assembled: its
 * evidence, observations and their corrections, notes, keep-out regions, pinned identities that
 * cite or rely on it, and its observations in lot entries. A sealed brief keeps its bytes; this
 * is applied wherever entries reach a session, as nothing of removed evidence may.
 */
export async function withoutRemovedMedia(
  client: PoolClient,
  batchId: string,
  entries: readonly BriefEntryDto[],
): Promise<BriefEntryDto[]> {
  const removed = await removedMedia(client, batchId)
  if (!removed) {
    return [...entries]
  }
  return entries.flatMap((entry) => {
    const kept = deliverable(entry, removed)
    // Whatever still names removed evidence after that isn't delivered at all.
    return kept && !namesRemoved(kept, removed) ? [kept] : []
  })
}
