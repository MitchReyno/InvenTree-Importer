// One-shot packaging entry point. Only this container receives both database secrets.
import { readFile } from 'node:fs/promises'
import { database } from '../db/database.ts'
import { migrate } from '../operations/migrate.ts'
import { grantFoundation } from '../operations/grants.ts'
import { grantCapture } from '../capture/grants.ts'
import { grantManual } from '../review/grants.ts'
import { grantMedia } from '../media/grants.ts'
import { grantProcessing } from '../processing/grants.ts'

async function provision() {
  const apiPassword = (await readFile('/run/secrets/api_password', 'utf8')).trim()
  if (!/^[0-9a-f]{64}$/.test(apiPassword)) throw new Error('expected_hex_api_password')
  const db = database('postgresql://postgres@127.0.0.1/intake')
  try {
    await migrate(db.pool)
    await db.pool.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='intake_api') THEN
        CREATE ROLE intake_api LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
      END IF;
    END $$`)
    await db.pool.query(`ALTER ROLE intake_api PASSWORD '${apiPassword}'`)
    await grantFoundation(db.pool, 'intake_api')
    await grantCapture(db.pool, 'intake_api')
    await grantManual(db.pool, 'intake_api', 'api')
    await grantMedia(db.pool, 'intake_api', 'api')
    await grantProcessing(db.pool, 'intake_api')
  } finally {
    await db.close()
  }
}

provision().catch(() => {
  process.stderr.write('deployment_provision_failed\n')
  process.exitCode = 1
})
