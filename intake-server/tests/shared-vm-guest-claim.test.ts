import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import { connect, createServer, type TLSSocket } from 'node:tls'
import type { AddressInfo } from 'node:net'
import { pairedCertificates } from './support/vm-pairing.ts'
import { pairing } from '#/agents/shared-vm/pair.ts'
import { Frames } from '#/agents/shared-vm/frames.ts'
import { serveGuestTurn } from '#/agents/shared-vm/guest-turn.ts'

test('the guest reports its claim once the first packet has arrived, not before', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'guest-claim-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await pairedCertificates(root)
  await mkdir(join(root, 'sessions'))
  const accepted: TLSSocket[] = []
  const server = createServer({
    ...(await pairing(join(root, 'bench-coordinator'))),
    requestCert: true,
  })
  server.on('secureConnection', (socket) => accepted.push(socket))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const socket = connect({
    ...(await pairing(join(root, 'bench-guest'))),
    port: (server.address() as AddressInfo).port,
    host: '127.0.0.1',
    servername: 'bench-coordinator',
  })
  t.after(() => socket.destroy())
  await once(socket, 'secureConnect')
  const claims: number[] = []
  const serving = serveGuestTurn(socket, {
    provider: 'claude',
    isolated: true,
    reapProof: false,
    sessionsRoot: join(root, 'sessions'),
    reapPath: join(root, 'reap'),
    policyPath: join(root, 'policy.json'),
    onClaimed: () => claims.push(Date.now()),
  }).catch(() => undefined)
  while (!accepted.length) {
    await new Promise((settle) => setTimeout(settle, 10))
  }
  const coordinator = new Frames(accepted[0])
  await coordinator.read()
  // An idle connection has greeted but is not claimed.
  await new Promise((settle) => setTimeout(settle, 200))
  assert.equal(claims.length, 0)
  // Even a packet the guest then refuses has claimed the connection.
  await coordinator.send({ inspectTerminal: { protocol: 'unknown' } })
  await serving
  assert.equal(claims.length, 1)
})
