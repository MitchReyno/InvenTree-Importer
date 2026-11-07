import { database } from '../db/database.ts'
import { backupArchive, restoreArchive } from './archive.ts'

/** Explicit trusted maintenance only; never discovers application keys or environment files. */
async function main() {
  const action = process.argv[2]
  const databaseUrl = process.env.INTAKE_OP_DATABASE_URL
  const schedulerDatabaseUrl = process.env.INTAKE_OP_SCHEDULER_DATABASE_URL
  const gateRoot = process.env.INTAKE_OP_GATE_ROOT
  const archive = process.env.INTAKE_OP_ARCHIVE
  if (
    !databaseUrl ||
    !schedulerDatabaseUrl ||
    !gateRoot ||
    !archive ||
    !['backup', 'restore'].includes(action ?? '')
  ) {
    throw new Error('explicit_operational_configuration_required')
  }
  const db = database(databaseUrl)
  try {
    const config = {
      databaseUrl,
      schedulerDatabaseUrl,
      gateRoot,
      archive,
      blobRoot: process.env.INTAKE_OP_BLOB_ROOT,
    }
    const result =
      action === 'backup'
        ? await backupArchive(db.pool, config)
        : await restoreArchive(db.pool, config)
    process.stdout.write(JSON.stringify({ event: 'operations_complete', ...result }) + '\n')
  } finally {
    await db.close()
  }
}

main().catch(() => {
  process.stderr.write(
    JSON.stringify({
      event: 'operations_refused',
      recovery: 'inspect_preserved_destinations_and_external_activation',
    }) + '\n',
  )
  process.exitCode = 1
})
