import { database } from '#/db/database.ts'
import { loadRun } from '#/execution/authority.ts'
import { executeRun, type Checkpoint } from '#/execution/apply.ts'
import { ExternalGate, WriterConnection } from '#/execution/ownership.ts'
import type { WorkerInput } from '#/execution/supervisor.ts'

// Process fault fixture: SAME public executor, only checkpoint publication/pausing differs.
process.once('message', async (input: WorkerInput & { pause: Checkpoint; pauseKind: string }) => {
  const db = database(input.databaseUrl),
    writer = new WriterConnection(input.databaseUrl)
  try {
    const authority = await loadRun(db.pool, input.runId)
    await writer.acquire(authority.plan.deploymentId)
    const pid = (await writer.client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    process.send?.({ kind: 'writer', pid })
    const result = await executeRun(
      {
        pool: db.pool,
        writer,
        gate: new ExternalGate(input.gateRoot),
        claimToken: input.claimToken,
        profile: input.profile,
        stopped: () => false,
        checkpoint: async (phase, kind, intentId) => {
          if (phase === input.pause && kind === input.pauseKind) {
            process.send?.({ kind: 'paused', phase, intentId })
            await new Promise<void>((resolve) => process.once('message', () => resolve()))
          }
        },
      },
      input.runId,
      input.recoveryIds,
    )
    process.send?.({ kind: 'result', result })
  } catch {
    process.exitCode = 1
  } finally {
    await writer.close()
    await db.close()
    if (process.connected) process.disconnect()
  }
})
