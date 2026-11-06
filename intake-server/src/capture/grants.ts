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
    capture_group_location,capture_evidence_observation,capture_lot_evidence_observation TO ${role}`)
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
    GRANT UPDATE(part_subject_id,operator_edited,observation_set_version,changed_revision) ON capture_lot TO ${role};
    GRANT INSERT,DELETE ON capture_edit_publication TO ${role};
    GRANT SELECT(id) ON capture_edit_publication TO ${role};
    GRANT INSERT,DELETE,UPDATE(region,readings,visible_count,status,operator_edited,revision)
      ON capture_evidence_observation TO ${role};
    GRANT INSERT,DELETE,UPDATE(status,revision) ON capture_lot_evidence_observation TO ${role};`)
}

/**
 * Draft capture writes for the Examine lead session: observations, AI lots and their membership.
 * No notes, selections or media links; the database guards keep edited rows out of reach.
 */
export async function grantCaptureAgentWrites(pool: Pool, role: string) {
  // The cluster-wide marker the database guards recognise; provisioning creates it once.
  await pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='intake_agent_writer_marker') THEN
        CREATE ROLE intake_agent_writer_marker NOLOGIN;
      END IF;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`)
  await grantCaptureRead(pool, role)
  await pool.query(`GRANT INSERT ON capture_subject,capture_part,capture_lot,capture_revision,
      capture_evidence_observation,capture_lot_evidence_observation TO ${role};
    GRANT UPDATE(region,readings,visible_count,revision) ON capture_evidence_observation TO ${role};
    GRANT UPDATE(id,label,revision) ON capture_subject TO ${role};
    GRANT UPDATE(part_subject_id,estimated_quantity,quantity_basis,observation_set_version,changed_revision) ON capture_lot TO ${role};
    GRANT UPDATE(status,revision),DELETE ON capture_lot_evidence_observation TO ${role};
    GRANT UPDATE(updated_at,revision) ON capture_batch TO ${role};
    GRANT INSERT,DELETE ON capture_edit_publication TO ${role};
    GRANT SELECT(id) ON capture_edit_publication TO ${role};
    GRANT intake_agent_writer_marker TO ${role};`)
}
