import type { Pool } from 'pg'
import { LIVE_MAX_STREAMS, LIVE_REPLAY_WINDOW, type LiveCursorDto } from '@invimport/contracts'
import { transaction } from '../db/database.ts'
import type { DevConfig } from '../config.ts'

export interface LiveHead extends LiveCursorDto {
  batch_id: string
  reset: boolean
}

/** Only sequence hints leave this boundary; journal payloads never become a socket command. */
export async function liveProjection(
  pool: Pool,
  config: DevConfig,
  batchId: string | null,
  cursors: readonly LiveCursorDto[],
) {
  return transaction(pool, async (client) => {
    await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
    const authority = await client.query(
      'SELECT id FROM public.target WHERE id=$1 AND current_context_id=$2',
      [config.targetId, config.targetContextId],
    )
    if (authority.rowCount !== 1) {
      throw new Error('live_context_changed')
    }
    const rows = await client.query<{ batch_id: string; stream_id: string; sequence: string }>(
      `SELECT b.id AS batch_id,b.stream_id,s.head AS sequence
       FROM public.capture_batch b JOIN public.ui_stream s ON s.id=b.stream_id
       WHERE b.actor_id=$1 AND b.target_id=$2 AND b.target_context_id=$3
       ORDER BY (b.id=$4::uuid) DESC NULLS LAST,b.updated_at DESC,b.id DESC LIMIT $5`,
      [config.actorId, config.targetId, config.targetContextId, batchId, LIVE_MAX_STREAMS + 1],
    )
    if (batchId && !rows.rows.some((row) => row.batch_id === batchId)) {
      throw new Error('live_batch_unavailable')
    }
    const previous = new Map(cursors.map((cursor) => [cursor.stream_id, cursor.sequence]))
    const heads: LiveHead[] = []
    for (const row of rows.rows.slice(0, LIVE_MAX_STREAMS)) {
      const sequence = previous.get(row.stream_id)
      let reset = sequence === undefined || BigInt(sequence) > BigInt(row.sequence)
      if (sequence !== undefined && BigInt(sequence) < BigInt(row.sequence)) {
        const distance = BigInt(row.sequence) - BigInt(sequence)
        reset = distance > BigInt(LIVE_REPLAY_WINDOW)
        if (!reset) {
          const replay = await client.query<{ sequence: string }>(
            'SELECT sequence FROM public.ui_event WHERE stream_id=$1 AND sequence>$2 AND sequence<=$3 ORDER BY sequence LIMIT $4',
            [row.stream_id, sequence, row.sequence, LIVE_REPLAY_WINDOW],
          )
          reset =
            BigInt(replay.rows.length) !== distance ||
            replay.rows.some(
              (event, index) => BigInt(event.sequence) !== BigInt(sequence) + BigInt(index) + 1n,
            )
        }
      }
      heads.push({ ...row, reset })
    }
    return { heads, truncated: rows.rows.length > LIVE_MAX_STREAMS }
  })
}
