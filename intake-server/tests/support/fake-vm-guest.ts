// A paired guest for process tests, run by a stand-in `limactl` in place of `tool-turn.sh`. It
// speaks the turn protocol over stdio like `guest-main.ts`, reports its claim as the real guest
// does and the VM memory FAKE_GUEST_MEMORY_MIB, takes FAKE_GUEST_ADMIT_MS to admit its provider,
// holds each turn for FAKE_GUEST_HOLD_MS and logs when it launches, starts, is admitted and ends.
import { appendFile } from 'node:fs/promises'
import { once } from 'node:events'
import { join } from 'node:path'
import { Duplex } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { connect } from 'node:tls'
import { Frames, protocol } from '#/agents/shared-vm/frames.ts'
import { pairing } from '#/agents/shared-vm/pair.ts'
import { TURN_CLAIMED_MARKER } from '#/agents/shared-vm/turn-claimed.ts'

const pair = process.env.FAKE_GUEST_PAIR!
const log = process.env.FAKE_GUEST_LOG!
const holdMs = Number(process.env.FAKE_GUEST_HOLD_MS ?? '0')
const admitMs = Number(process.env.FAKE_GUEST_ADMIT_MS ?? '0')
const memoryMib = process.env.FAKE_GUEST_MEMORY_MIB

async function record(line: string) {
  await appendFile(join(log, 'turns.log'), `${line} ${Date.now()}\n`)
}

await record(`launch ${process.pid}`)
const socket = connect({
  ...(await pairing(pair)),
  servername: 'bench-coordinator',
  socket: Duplex.from({ readable: process.stdin, writable: process.stdout }),
})
await once(socket, 'secureConnect')
const frames = new Frames(socket)
await frames.send({
  ready: protocol,
  reapProof: true,
  terminalProbe: true,
  builtinTools: true,
  evidenceFiles: true,
  evidenceRelease: 1,
  turnPolicy: true,
  claudeSubscription: true,
  codexSubscription: false,
  providerStatus: true,
  modelCatalog: true,
  ...(memoryMib ? { memoryBytes: Number(memoryMib) * 1024 * 1024 } : {}),
})
const packet = await frames.read()
process.stderr.write(TURN_CLAIMED_MARKER + '\n')
if ('inspectTerminal' in packet) {
  await frames.send({ terminalOutcome: 'worker_removed' })
} else {
  const identity = packet.attemptId as string
  await record(`start ${identity}`)
  await delay(admitMs)
  await record(`admitted ${identity}`)
  await frames.send({ provider: { providerSessionId: 'fake-' + identity, actualModel: 'haiku' } })
  await frames.read()
  await delay(holdMs)
  await record(`end ${identity}`)
  await frames.send({ done: true })
}
socket.end()
await once(socket, 'close').catch(() => undefined)
