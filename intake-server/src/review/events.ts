import type { PoolClient } from 'pg'
import { appendEvent } from '#/db/authority.ts'

/** Stream lock is acquired last, after the original dispatch/command decision. */
export async function publishManualRun(client: PoolClient, runId: string) {
  const result = await client.query<{ stream_id: string; batch_id: string }>(
    'SELECT stream_id,batch_id FROM public.manual_run WHERE id=$1',
    [runId],
  )
  const run = result.rows[0]
  if (!run) {
    throw new Error('manual_run_missing')
  }
  await appendEvent(client, run.stream_id, 'manual_run_changed', {
    batch_id: run.batch_id,
    run_id: runId,
  })
}
