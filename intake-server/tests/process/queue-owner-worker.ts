import { DBOS } from '@dbos-inc/dbos-sdk'

// Registers the Processing queue under a given DBOS application name, as either Processing worker does.
const url = process.env.INTAKE_QUALIFICATION_DATABASE_URL
const name = process.env.INTAKE_QUALIFICATION_APPLICATION
if (!url || !/^intake_test_[a-f0-9]+$/.test(new URL(url).pathname.slice(1)) || !name)
  throw new Error('owned_qualification_database_required')
DBOS.setConfig({
  name,
  systemDatabaseUrl: url,
  applicationVersion: `queue-owner-${name}`,
  executorID: 'queue-owner',
  runAdminServer: false,
  systemDatabasePoolSize: 3,
  logLevel: 'error',
})
await DBOS.launch()
try {
  await DBOS.registerQueue('bench-research', { workerConcurrency: 1, globalConcurrency: 1 })
  process.stdout.write('REGISTERED\n')
} catch (error) {
  process.stderr.write(String(error) + '\n')
  process.stdout.write('REFUSED\n')
} finally {
  await DBOS.shutdown({ workflowCompletionTimeoutMS: 100 })
}
