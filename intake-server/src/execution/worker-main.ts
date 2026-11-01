import { BlobStore } from '../media/blob-store.ts'
import { database } from '../db/database.ts'
import { loadRun } from './authority.ts'
import { executeRun } from './apply.ts'
import { ExternalGate, WriterConnection } from './ownership.ts'
import type { WorkerInput } from './supervisor.ts'

let started = false
let stopping = false
process.on('disconnect', () => {
  stopping = true
})
process.on('SIGTERM', () => {
  stopping = true
})
process.on('message', async (input: WorkerInput | { kind: string }) => {
  if ('kind' in input) {
    if (input.kind === 'stop') {
      stopping = true
    }
    return
  }
  if (started) {
    return
  }
  started = true
  const db = database(input.databaseUrl)
  const writer = new WriterConnection(input.databaseUrl)
  try {
    const authority = await loadRun(db.pool, input.runId)
    await writer.acquire(authority.plan.deploymentId)
    const result = await executeRun(
      {
        pool: db.pool,
        mediaStore: input.mediaBlobRoot
          ? await BlobStore.initialize(input.mediaBlobRoot)
          : undefined,
        writer,
        gate: new ExternalGate(input.gateRoot),
        claimToken: input.claimToken,
        profile: input.profile,
        stopped: () => stopping,
      },
      input.runId,
      input.recoveryIds,
    )
    if (process.connected) {
      await new Promise<void>((resolve, reject) =>
        process.send!({ kind: 'result', result }, (error) => (error ? reject(error) : resolve())),
      )
    }
  } catch {
    process.exitCode = 1
  } finally {
    await writer.close()
    await db.close()
    if (process.connected) {
      process.disconnect()
    }
  }
})
