import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'
import { ExternalGate } from './ownership.ts'
import type { TargetProfile } from '#/inventory/transport.ts'
import type { StockSnapshot } from './authority.ts'

export interface WorkerInput {
  databaseUrl: string
  gateRoot: string
  claimToken: string
  runId: string
  profile: TargetProfile
  mediaBlobRoot?: string
  recoveryIds: string[]
}
export type SupervisorInput = Omit<WorkerInput, 'claimToken' | 'recoveryIds'> & {
  recoveryIds?: string[]
}

/** Scheduler handlers call this seam; only the child receives mutation credentials.
 * The claim survives parent death. No second supervisor may steal it.
 */
export async function startApply(input: SupervisorInput) {
  const gate = new ExternalGate(input.gateRoot)
  const claim = await gate.claim()
  const child = fork(fileURLToPath(new URL('./worker-main.ts', import.meta.url)), [], {
    execArgv: ['--import', 'tsx'],
    env: { PATH: process.env.PATH },
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  })
  let result: StockSnapshot | undefined
  child.on('message', (message: { kind?: string; result?: StockSnapshot }) => {
    if (message.kind === 'result') {
      result = message.result
    }
  })
  const completed = (async () => {
    const [code, signal] = await once(child, 'exit')
    // 'exit' proves this one physical apply child is reaped, even if no result arrived.
    await claim.releaseAfterReap()
    if (code !== 0 || signal || !result) {
      throw new Error('apply_interrupted_inspect_original_run')
    }
    return result
  })()
  // Attach immediately: a caller may be doing cancellation before awaiting completion.
  void completed.catch(() => undefined)
  child.send({ ...input, recoveryIds: input.recoveryIds ?? [], claimToken: claim.token })
  return {
    child,
    completed,
    async stop() {
      child.send({ kind: 'stop' })
      return completed
    },
  }
}
