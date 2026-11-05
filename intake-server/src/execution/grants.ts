import type { Pool } from 'pg'

/** Provisioning by migrator only. Does not grant source/deployment enrollment or DDL.
 * Source lineage and activation are trusted T04/deployment responsibilities, not apply's.
 */
export async function grantExecutor(
  pool: Pool,
  role: string,
  purpose: 'approval' | 'apply' | 'delivery',
): Promise<void> {
  if (!/^intake_[a-z0-9_]{1,55}$/.test(role)) {
    throw new Error('invalid_runtime_role')
  }
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${role};
    GRANT SELECT ON operator,target,target_context,command,outbox,executor_deployment,executor_source,executor_guard,executor_approval,executor_run,executor_operation,executor_cancel,executor_recovery,executor_intent,executor_result,executor_effect,executor_verification TO ${role};
  `)
  const media = await pool.query("SELECT to_regclass('public.executor_attachment') AS relation")
  if (media.rows[0].relation) {
    await pool.query(`GRANT SELECT ON media_store_identity,executor_attachment,executor_attachment_recovery,
      executor_attachment_intent,executor_attachment_result,executor_attachment_effect,
      executor_attachment_verification,media_approval_pin,media_version,media_blob TO ${role}`)
    if (purpose === 'approval') {
      await pool.query(
        `GRANT INSERT ON executor_attachment,executor_attachment_recovery,media_approval_pin TO ${role}`,
      )
    } else if (purpose === 'apply') {
      await pool.query(`GRANT INSERT ON executor_attachment_intent,executor_attachment_result,
        executor_attachment_effect,executor_attachment_verification TO ${role}`)
    }
  }
  const supported = await pool.query(
    "SELECT to_regclass('public.executor_supported_operation') AS relation",
  )
  if (supported.rows[0].relation) {
    await pool.query(
      `GRANT SELECT ON executor_supported_operation,executor_part_transfer,executor_part_identity,executor_supported_recovery,executor_supported_intent,executor_supported_result,executor_supported_effect,executor_supported_assessment TO ${role}`,
    )
    if (purpose === 'approval') {
      await pool.query(
        `GRANT INSERT ON executor_supported_operation,executor_part_transfer,executor_part_identity,executor_supported_recovery TO ${role}`,
      )
    }
    if (purpose === 'apply') {
      await pool.query(
        `GRANT INSERT ON executor_supported_intent,executor_supported_result,executor_supported_effect,executor_supported_assessment TO ${role}`,
      )
    }
  }
  const records = await pool.query(
    "SELECT to_regclass('public.executor_record_identity') AS relation",
  )
  if (records.rows[0].relation) {
    await pool.query(`GRANT SELECT ON executor_record_identity TO ${role}`)
    if (purpose === 'approval') {
      await pool.query(`GRANT INSERT ON executor_record_identity TO ${role}`)
    }
  }
  if (purpose === 'delivery') {
    await pool.query(`GRANT UPDATE(delivery_attempts,acked_at,conflict_code) ON outbox TO ${role}`)
    return
  }
  await pool.query(`GRANT UPDATE(revision) ON target TO ${role};
    GRANT UPDATE(id) ON executor_run TO ${role};
    GRANT UPDATE(active_run) ON executor_guard TO ${role};`)
  if (purpose === 'apply') {
    await pool.query(
      `GRANT INSERT ON executor_intent,executor_result,executor_effect,executor_verification TO ${role}`,
    )
  } else {
    await pool.query(
      `GRANT INSERT ON executor_guard,executor_approval,executor_run,executor_operation,executor_cancel,executor_recovery,command,outbox TO ${role};
       GRANT USAGE ON SEQUENCE executor_cancel_id_seq TO ${role}`,
    )
  }
}
