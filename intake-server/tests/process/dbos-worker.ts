import { DBOS } from '@dbos-inc/dbos-sdk'
import { requireHandlerVersion } from '#/workers/delivery.ts'

// Synthetic qualification only: no inventory transport, approval, provider or Python process.
const url = process.env.INTAKE_QUALIFICATION_DATABASE_URL
if (!url || !/^intake_test_[a-f0-9]+$/.test(new URL(url).pathname.slice(1)))
  throw new Error('owned_qualification_database_required')
const version = process.env.INTAKE_QUALIFICATION_VERSION ?? 'qualification-v1'
DBOS.setConfig({
  name: 'intake-qualification',
  systemDatabaseUrl: url,
  applicationVersion: version,
  executorID: 'qualification-owner',
  runAdminServer: false,
  systemDatabasePoolSize: 3,
  logLevel: 'ERROR',
})
DBOS.registerWorkflow(
  async (payload: { handler_version: string; value: string }) => {
    requireHandlerVersion(DBOS.applicationVersion, payload.handler_version)
    await DBOS.setEvent('checkpoint', payload.value)
    if ((await DBOS.recv('finish', 60)) !== 'finish')
      throw new Error('qualification_finish_timeout')
    return payload.value
  },
  { name: 'intakeCommand' },
)
await DBOS.launch()
await DBOS.registerQueue('qualification', { workerConcurrency: 1 })
process.stdout.write('READY\n')
process.on('SIGTERM', () => {
  void DBOS.shutdown({ workflowCompletionTimeoutMS: 100 }).then(() => process.exit(0))
})
