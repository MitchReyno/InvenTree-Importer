// Entrypoint for one paired session turn. The operator transports opaque TLS bytes over
// stdio into the network-disabled guest. No host socket or host directory enters the container.
import { once } from 'node:events'
import { Duplex } from 'node:stream'
import { connect } from 'node:tls'
import { guestMemoryBytes } from './guest-memory.ts'
import { serveGuestTurn } from './guest-turn.ts'
import { pairing } from './pair.ts'
import { providerProxy } from './provider-proxy.ts'
import { TURN_POLICY_PATH } from './turn-policy.ts'
import { TURN_CLAIMED_MARKER } from './turn-claimed.ts'

async function main() {
  const socket = connect({
    ...(await pairing('/run/bench-pair')),
    servername: 'bench-coordinator',
    socket: Duplex.from({ readable: process.stdin, writable: process.stdout }),
  })
  try {
    await once(socket, 'secureConnect')
    const subscription = process.env.INTAKE_VM_CLAUDE_SUBSCRIPTION === '1'
    const codex = process.env.INTAKE_VM_CODEX_SUBSCRIPTION === '1'
    const provider = codex ? 'codex' : subscription ? 'claude' : undefined
    const isolated = process.env.INTAKE_VM_TOOL_WORKER === '1'
    if (provider && !isolated) {
      const egress = await providerProxy(provider)
      socket.once('close', () => egress.close())
    }
    await serveGuestTurn(socket, {
      provider,
      isolated,
      reapProof: isolated && process.env.INTAKE_VM_REAP_PROOF === '1',
      sessionsRoot: '/home/node/sessions',
      reapPath: '/run/reap/turn',
      policyPath: TURN_POLICY_PATH,
      // The relay reads this line to tell a connection the coordinator used from one it didn't.
      onClaimed: () => process.stderr.write(TURN_CLAIMED_MARKER + '\n'),
      memoryBytes: await guestMemoryBytes(),
    })
  } catch (error) {
    socket.destroy()
    throw error
  }
}

main().catch(() => {
  process.stderr.write('guest_turn_refused\n')
  process.exitCode = 1
})
