import type { Pool } from 'pg'

const tables = `media_store_identity,media_batch,media_blob,media_group,media_evidence,media_version,media_decode_command,
media_derivation,media_decode_claim,media_decode_result,media_preview,media_group_history,media_evidence_note,media_group_selection,
media_subject_link,media_attachment_selection,media_approval_pin,media_command_binding,media_command_pin`

/** Explicit trusted provisioning; media workers cannot choose or approve inventory effects. */
export async function grantMedia(
  pool: Pool,
  role: string,
  purpose: 'api' | 'decoder' | 'apply' | 'processing' | 'processing-reader' | 'gc',
) {
  if (!/^intake_[a-z0-9_]{1,55}$/.test(role)) {
    throw new Error('invalid_runtime_role')
  }
  if (purpose === 'processing-reader') {
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${role};
      GRANT SELECT ON media_store_identity,media_batch,media_blob,media_group,media_evidence,media_version,
      media_decode_command,media_derivation,media_decode_result,media_preview,
      media_group_history,media_evidence_note,media_group_selection,media_subject_link,media_attachment_selection,
      media_command_binding,media_command_pin TO ${role}`)
    return
  }
  if (purpose === 'gc') {
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${role};
      GRANT SELECT ON media_store_identity,media_version,media_preview,media_approval_pin,media_command_pin TO ${role}`)
    return
  }
  await pool.query(`GRANT SELECT ON ${tables} TO ${role}`)
  if (purpose === 'api') {
    await pool.query(`GRANT INSERT ON media_batch,media_blob,media_group,media_evidence,media_version,
      media_decode_command,media_derivation,media_group_history,media_evidence_note,media_group_selection,media_subject_link,
      media_attachment_selection,media_approval_pin,media_command_binding,media_command_pin TO ${role}`)
    await pool.query(`GRANT UPDATE(revision) ON media_batch TO ${role}`)
  } else if (purpose === 'processing') {
    await pool.query(`GRANT INSERT ON media_command_binding,media_command_pin TO ${role}`)
  } else if (purpose === 'decoder') {
    await pool.query(`GRANT INSERT ON media_blob,media_version,media_decode_claim,media_decode_result,
      media_preview TO ${role}`)
    // PostgreSQL requires UPDATE privilege for FOR UPDATE; immutable trigger rejects changes.
    await pool.query(`GRANT UPDATE(id) ON media_decode_command TO ${role}`)
  }
}
