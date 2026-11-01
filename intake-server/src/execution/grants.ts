import type { Pool } from 'pg'

/** Provisioning by migrator only. Does not grant source/deployment enrollment or DDL.
 * Source lineage and activation are trusted T04/deployment responsibilities, not apply's.
 */
export async function grantExecutor(
  pool: Pool,
  role: string,
  purpose: 'approval' | 'apply',
): Promise<void> {
  if (!/^intake_[a-z0-9_]{1,55}$/.test(role)) throw new Error('invalid_runtime_role')
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${role};
    GRANT SELECT ON operator,target,target_context,command,outbox,executor_deployment,executor_source,executor_guard,executor_approval,executor_run,executor_operation,executor_cancel,executor_recovery,executor_intent,executor_result,executor_effect,executor_verification TO ${role};
    GRANT UPDATE(revision) ON target TO ${role};
    GRANT UPDATE(id) ON executor_run TO ${role};
    GRANT UPDATE(active_run) ON executor_guard TO ${role};`)
  if (purpose === 'apply')
    await pool.query(
      `GRANT INSERT ON executor_intent,executor_result,executor_effect,executor_verification TO ${role}`,
    )
  else
    await pool.query(
      `GRANT INSERT ON executor_guard,executor_approval,executor_run,executor_operation,executor_cancel,executor_recovery,command,outbox TO ${role}`,
    )
}
