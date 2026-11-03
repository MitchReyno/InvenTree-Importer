import { randomUUID } from 'node:crypto'
import { asc, desc, eq } from 'drizzle-orm'
import type { PoolClient } from 'pg'
import type { MediaSnapshotDto } from '@invimport/contracts'
import { executeDatabaseQuery, queryDatabase } from '../db/database.ts'
import { latestInstructions } from '../capture/review-context.ts'
import { mediaGroups, mediaGroupHistory, mediaEvidenceNotes } from './schema.ts'

export async function activeMediaGroups(client: PoolClient, batchId: string) {
  const db = queryDatabase(client)
  const groups = await executeDatabaseQuery(
    db
      .select({ id: mediaGroups.id, label: mediaGroups.label })
      .from(mediaGroups)
      .where(eq(mediaGroups.batchId, batchId))
      .orderBy(asc(mediaGroups.id)),
  )
  const history = await executeDatabaseQuery(
    db
      .selectDistinctOn([mediaGroupHistory.groupId])
      .from(mediaGroupHistory)
      .where(eq(mediaGroupHistory.batchId, batchId))
      .orderBy(asc(mediaGroupHistory.groupId), desc(mediaGroupHistory.revision)),
  )
  return groups.flatMap((group) => {
    const current = history.find((row) => row.groupId === group.id)
    return current?.retired ? [] : [{ id: group.id, label: current?.label ?? group.label }]
  })
}

export async function retainGroupHistory(
  client: PoolClient,
  batchId: string,
  actorId: string,
  groupId: string,
  revision: string,
  label: string,
  retired: boolean,
) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(mediaGroupHistory)
      .values({ id: randomUUID(), batchId, actorId, groupId, revision, label, retired }),
  )
}

export async function retainEvidenceNote(
  client: PoolClient,
  batchId: string,
  actorId: string,
  evidenceId: string,
  revision: string,
  text: string,
) {
  await executeDatabaseQuery(
    queryDatabase(client)
      .insert(mediaEvidenceNotes)
      .values({ id: randomUUID(), batchId, actorId, evidenceId, revision, text }),
  )
}

export async function enrichMediaNotes(client: PoolClient, snapshot: MediaSnapshotDto) {
  const notes = await executeDatabaseQuery(
    queryDatabase(client)
      .selectDistinctOn([mediaEvidenceNotes.evidenceId])
      .from(mediaEvidenceNotes)
      .where(eq(mediaEvidenceNotes.batchId, snapshot.batch_id))
      .orderBy(asc(mediaEvidenceNotes.evidenceId), desc(mediaEvidenceNotes.revision)),
  )
  const instructions = await latestInstructions(client, snapshot.batch_id)
  const groups = snapshot.groups.map((group) => {
    const instruction = instructions.find((row) => row.groupId === group.id)
    return instruction
      ? {
          ...group,
          note: {
            id: instruction.id,
            version: instruction.version,
            text: instruction.text,
            actor_id: instruction.actorId,
            created_at: instruction.createdAt,
          },
        }
      : group
  })
  const evidence = snapshot.evidence.map((item) => {
    const note = notes.find((row) => row.evidenceId === item.id)
    return note
      ? {
          ...item,
          note: {
            id: note.id,
            version: note.revision,
            text: note.text,
            actor_id: note.actorId,
            created_at: note.createdAt.toISOString(),
          },
        }
      : item
  })
  return { ...snapshot, groups, evidence }
}
