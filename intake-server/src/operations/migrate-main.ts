import { database } from '#/db/database.ts'
import { migrate } from './migrate.ts'

if (!process.env.INTAKE_DATABASE_URL) {
  throw new Error('explicit_database_url_required')
}
const db = database(process.env.INTAKE_DATABASE_URL)
try {
  await migrate(db.pool)
  process.stdout.write('Intake migrations verified.\n')
} finally {
  await db.close()
}
