import type { Pool } from 'pg'
import { grantProjection } from '../operations/grants.ts'
import { grantExecutor } from '../execution/grants.ts'

/** Trusted provisioning only. API may approve, scheduler may dispatch, apply may only journal. */
export async function grantManual(pool: Pool, role: string, purpose: 'api' | 'runner' | 'apply') {
  if (!/^intake_[a-z0-9_]{1,55}$/.test(role)) {
    throw new Error('invalid_runtime_role')
  }
  await pool.query(
    `GRANT SELECT ON manual_review,manual_prepare_command,manual_read_intent,manual_read_result,manual_preparation,manual_preparation_review,manual_preparation_lot,manual_prepare_outcome,manual_approval,manual_run,manual_dispatch TO ${role}`,
  )
  const mediaTables = await pool.query(
    "SELECT to_regclass('public.manual_preparation_media') AS relation",
  )
  if (mediaTables.rows[0].relation) {
    await pool.query(`GRANT SELECT ON manual_preparation_media,media_evidence TO ${role}`)
    if (purpose === 'api') {
      await pool.query(`GRANT INSERT ON manual_preparation_media TO ${role}`)
    }
  }
  const transfers = await pool.query(
    "SELECT to_regclass('public.manual_transfer_read_intent') AS relation",
  )
  if (transfers.rows[0].relation) {
    await pool.query(
      `GRANT SELECT ON manual_transfer_read_intent,manual_transfer_read_result TO ${role}`,
    )
    if (purpose === 'api') {
      await pool.query(
        `GRANT INSERT ON manual_transfer_read_intent,manual_transfer_read_result TO ${role}`,
      )
    }
  }
  if (purpose === 'api') {
    const media = await pool.query("SELECT to_regclass('public.media_batch') AS relation")
    if (media.rows[0].relation) {
      await pool.query(`GRANT SELECT ON media_batch TO ${role}`)
    }
    await grantExecutor(pool, role, 'approval')
    await pool.query(`GRANT INSERT ON manual_review,manual_prepare_command,manual_read_intent,manual_read_result,manual_preparation,manual_preparation_review,manual_preparation_lot,manual_prepare_outcome,manual_approval,manual_run,manual_dispatch TO ${role};
      GRANT USAGE ON SEQUENCE manual_dispatch_sequence_seq TO ${role}`)
  } else if (purpose === 'apply') {
    await grantExecutor(pool, role, 'apply')
  } else {
    await grantExecutor(pool, role, 'delivery')
    await grantProjection(pool, role)
    await pool.query(`GRANT UPDATE(state,safe_code) ON manual_dispatch TO ${role}`)
  }
}
