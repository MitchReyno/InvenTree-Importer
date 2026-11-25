import type { Pool, PoolClient } from 'pg'
import { transaction } from '#/db/database.ts'
import { appendSessionOutbox } from './outbox.ts'

/**
 * Records that the image of one of an attempt's photo views was handed to the provider. Only the
 * component that handed it over records it, after the handover; a view that has no release, such
 * as a withheld reply, can't be cited. Recording a view twice keeps the first release.
 */
export async function recordPhotoRelease(pool: Pool, attemptId: string, viewSeq: string) {
  await transaction(pool, async (client) => {
    // Locks the session row first, as every outbox append does, so the check below is current.
    const views = await client.query<{ released: boolean }>(
      `SELECT EXISTS (
           SELECT 1 FROM public.agent_session_outbox r
           WHERE r.session_id=o.session_id AND r.kind='photo_release'
             AND r.payload->>'view_seq'=o.seq::text
         ) AS released
       FROM public.agent_session s
       JOIN public.agent_session_outbox o ON o.session_id=s.attempt_id
       WHERE s.attempt_id=$1 AND o.seq=$2 AND o.kind='photo_view'
       FOR UPDATE OF s`,
      [attemptId, viewSeq],
    )
    const view = views.rows[0]
    if (!view) {
      throw new Error('photo_view_not_found')
    }
    if (view.released) {
      return
    }
    await appendSessionOutbox(client, attemptId, {
      kind: 'photo_release',
      payload: { view_seq: viewSeq },
    })
  })
}

/** The pages of each evidence version whose view was released to an attempt, by version. */
export async function releasedPages(client: PoolClient, attemptId: string) {
  const rows = await client.query<{ version_id: string; page: number }>(
    `SELECT DISTINCT v.payload->>'version_id' AS version_id, (v.payload->>'page')::int AS page
     FROM public.agent_session_outbox v
     JOIN public.agent_session_outbox r ON r.session_id=v.session_id AND r.kind='photo_release'
       AND r.payload->>'view_seq'=v.seq::text
     WHERE v.session_id=$1 AND v.kind='photo_view'`,
    [attemptId],
  )
  const pages = new Map<string, Set<number>>()
  for (const row of rows.rows) {
    const versionPages = pages.get(row.version_id) ?? new Set<number>()
    versionPages.add(row.page)
    pages.set(row.version_id, versionPages)
  }
  return pages
}
