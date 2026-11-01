import { startApply, type SupervisorInput } from '../../src/execution/supervisor.ts'

process.once('message', async (input: SupervisorInput) => {
  try {
    const worker = await startApply(input)
    process.send?.({ kind: 'physical_child', pid: worker.child.pid })
    await worker.completed
  } catch {
    process.exitCode = 1
  } finally {
    if (process.connected) process.disconnect()
  }
})
