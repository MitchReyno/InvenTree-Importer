import type { Pool } from 'pg'

/** Read-only capture facts for workers; no capture edits or selection authority. */
export async function grantCaptureRead(pool: Pool, role: string): Promise<void> {
  if (!/^intake_[a-z0-9_]{1,55}$/.test(role)) {
    throw new Error('invalid_runtime_role')
  }

  await pool.query(`GRANT SELECT ON capture_source,capture_batch,capture_subject,capture_part,
    capture_lot,capture_note,capture_observation,capture_selection,capture_revision,
    capture_lot_lineage,capture_lot_retirement,capture_issue_disposition,capture_instruction,capture_context,
    capture_settings_intent,capture_setting_note,capture_reference_draft_identity,capture_reference_draft,
    capture_group_location TO ${role}`)
}

/** Row-lock capability only; immutable subject identity rejects updates and selections stay denied. */
export async function grantCaptureInputLocks(pool: Pool, role: string): Promise<void> {
  await grantCaptureRead(pool, role)
  await pool.query(`GRANT UPDATE(revision) ON capture_batch TO ${role};
    GRANT UPDATE(id) ON capture_subject TO ${role}`)
}

/** Trusted setup seam, deliberately separate from shared foundation/executor grants. */
export async function grantCapture(pool: Pool, role: string) {
  await grantCaptureRead(pool, role)
  await pool.query(`GRANT SELECT ON media_group,media_group_history TO ${role};
    GRANT SELECT(id,batch_id,evidence_id,media_type) ON media_version TO ${role}`)

  await pool.query(`GRANT INSERT ON capture_source,capture_batch,capture_subject,capture_part,capture_lot,capture_note,capture_observation,capture_selection,capture_revision,capture_lot_lineage,capture_lot_retirement,capture_issue_disposition,capture_instruction,capture_context,capture_settings_intent,capture_setting_note,capture_reference_draft_identity,capture_reference_draft,capture_group_location TO ${role};
    GRANT UPDATE(title,revision,archived,updated_at) ON capture_batch TO ${role};
    GRANT UPDATE(label,revision) ON capture_subject TO ${role};
    GRANT UPDATE(part_subject_id) ON capture_lot TO ${role};
    GRANT INSERT,DELETE ON capture_edit_publication TO ${role};
    GRANT SELECT(id) ON capture_edit_publication TO ${role};`)
}
