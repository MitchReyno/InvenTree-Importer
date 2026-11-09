import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readDevState } from '#/dev/state.ts'
import { developmentAdminUrl } from '#/dev/postgres-url.ts'
import { database } from '#/db/database.ts'
import { grantFoundation } from '#/operations/grants.ts'
import { grantManual } from '#/review/grants.ts'
import { grantMedia } from '#/media/grants.ts'
import { grantProcessing } from '#/processing/grants.ts'

/** Setup-only legacy role fixture. Never reads private service state or alters a running role. */
export async function provisionLegacyDevApi(root: string, adminAddress: string) {
  const state = await readDevState(root)
  if (state.version !== 1) {
    throw new Error('owned_fake_fixture_required')
  }
  const url = developmentAdminUrl(adminAddress)
  url.pathname = `/${state.databaseName}`
  const setup = database(url.toString())
  try {
    const name = `intake_${randomUUID().replaceAll('-', '')}`
    const password = randomUUID()
    await setup.pool.query(
      `CREATE ROLE ${name} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 6`,
    )
    await grantFoundation(setup.pool, name)
    await grantManual(setup.pool, name, 'api')
    await grantMedia(setup.pool, name, 'processing-reader')
    await grantProcessing(setup.pool, name)
    await setup.pool.query(
      `GRANT INSERT ON media_batch,media_blob,media_group,media_evidence,media_version,media_decode_command,media_derivation,media_group_selection,media_subject_link,media_attachment_selection,media_approval_pin,media_command_binding,media_command_pin TO ${name}; GRANT UPDATE(revision) ON media_batch TO ${name}`,
    )
    // Model the Capture/media grants before context, group-history and evidence-note tables.
    await setup.pool.query(
      `GRANT SELECT ON capture_source,capture_batch,capture_subject,capture_part,capture_lot,capture_note,capture_observation,capture_selection,capture_revision,capture_lot_lineage,capture_lot_retirement,capture_issue_disposition,capture_instruction TO ${name}; GRANT UPDATE(revision) ON capture_batch TO ${name}; GRANT UPDATE(id) ON capture_subject TO ${name}`,
    )
    const runtime = new URL(state.apiUrl)
    runtime.username = name
    runtime.password = password
    const legacy = { ...state, apiUrl: runtime.toString() }
    await writeFile(join(root, 'app.json'), JSON.stringify(legacy), { mode: 0o600 })
    return legacy
  } finally {
    await setup.close()
  }
}
