import type { Pool } from 'pg'

/** Trusted setup seam, deliberately separate from shared foundation/executor grants. */
export async function grantCapture(pool: Pool, role: string) {
  if (!/^intake_[a-z0-9_]{1,55}$/.test(role)) {
    throw new Error('invalid_runtime_role')
  }
  await pool.query(`GRANT SELECT,INSERT ON capture_source,capture_batch,capture_subject,capture_part,capture_lot,capture_note,capture_observation,capture_selection,capture_revision TO ${role};
    GRANT UPDATE(title,revision,archived,updated_at) ON capture_batch TO ${role};
    GRANT UPDATE(label,revision) ON capture_subject TO ${role};
    GRANT UPDATE(part_subject_id) ON capture_lot TO ${role};
    GRANT INSERT,DELETE ON capture_edit_publication TO ${role};
    GRANT SELECT(id) ON capture_edit_publication TO ${role};`)
}
