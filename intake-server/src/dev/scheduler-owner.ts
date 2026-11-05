import { DBOSClient } from '@dbos-inc/dbos-sdk'
import { Pool } from 'pg'
import { processingApplication } from '../processing/queue.ts'

const legacyProcessingApplications = ['bench-intake-dev-processing', 'bench-intake-native-agent']

/** Retained dev namespaces registered the Processing queue under per-worker names; hand those rows to the shared name. */
export async function reownProcessingRows(schedulerUrl: string) {
  const pool = new Pool({ connectionString: schedulerUrl, max: 1 })
  try {
    const { rows } = await pool.query<{ queues: string | null }>(
      `SELECT to_regclass('dbos.queues')::text AS queues`,
    )
    if (!rows[0]?.queues) {
      return
    }
  } finally {
    await pool.end()
  }
  const client = await DBOSClient.create({
    systemDatabaseUrl: schedulerUrl,
    systemDatabasePoolSize: 1,
  })
  try {
    for (const name of legacyProcessingApplications) {
      await client.renameApplication(name, processingApplication)
    }
  } finally {
    await client.destroy()
  }
}
