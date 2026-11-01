import { captureProcess } from '../support/capture-process.ts'

const harness = await captureProcess(4310)
let closing = false
async function close() {
  if (closing) {
return
}
  closing = true
  await harness.dispose()
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
process.once(signal, () => { void close() })
}
process.on('SIGUSR2', () => { void (async () => { await harness.stop(); await harness.start(); process.stdout.write('Capture child restarted with the same isolated retained database.\n') })() })
try { await harness.start(); process.stdout.write('Owned capture browser fixture ready on loopback 4310. SIGUSR2 restarts web only; SIGTERM closes fixture and drops only its randomized database/role.\n') }
catch (error) { await close(); throw error }
