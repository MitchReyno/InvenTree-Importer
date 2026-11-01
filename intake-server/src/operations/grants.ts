import type { Pool } from 'pg'

/** Retained projection publication without command, outbox or approval authority. */
export async function grantProjection(pool: Pool, role: string): Promise<void> {
  if (!/^intake_[a-z0-9_]{1,55}$/.test(role)) {
    throw new Error('invalid_runtime_role')
  }

  await pool.query(`GRANT USAGE ON SCHEMA public TO ${role};
    GRANT SELECT ON operator,target,target_context,ui_stream,ui_event TO ${role};
    GRANT INSERT ON ui_event TO ${role};
    GRANT UPDATE(head) ON ui_stream TO ${role};`)
}

/** Provisioning only. Runtime cannot create schema, change identity or rewrite retained authority. */
export async function grantFoundation(pool: Pool, role: string): Promise<void> {
  if (!/^intake_[a-z0-9_]{1,55}$/.test(role)) throw new Error('invalid_runtime_role')
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${role};
    GRANT SELECT ON operator,target,target_context,command,outbox,idempotency_record,ui_stream,ui_event TO ${role};
    GRANT INSERT ON command,outbox,idempotency_record,ui_stream,ui_event TO ${role};
    GRANT UPDATE ON outbox TO ${role};
    GRANT UPDATE(head) ON ui_stream TO ${role};`)
}
