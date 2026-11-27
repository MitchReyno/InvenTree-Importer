import { test } from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { StartupGate } from '#/agents/shared-vm/startup-gate.ts'
import { vmTurnCapacity, reportedMemory } from '#/agents/shared-vm/turn-capacity.ts'
import { memTotalBytes } from '#/agents/shared-vm/guest-memory.ts'
import { EventEmitter } from 'node:events'
import type { Socket } from 'node:net'
import { LaneOffers, offerRoute } from '#/agents/shared-vm/lane-offers.ts'

const MIB = 1024 * 1024

test('a VM holds as many tool turns as fit beside its always-on services, at least one', () => {
  // What a Lima VM's kernel reports for 2, 4 and 8 GiB.
  assert.equal(vmTurnCapacity(1878 * MIB), 1)
  assert.equal(vmTurnCapacity(3930 * MIB), 3)
  assert.equal(vmTurnCapacity(7990 * MIB), 7)
  assert.equal(vmTurnCapacity(512 * MIB), 1)
  assert.equal(vmTurnCapacity(undefined), 1)
})

test('only a plausible memory report is believed', () => {
  assert.equal(reportedMemory(4096 * MIB), 4096 * MIB)
  for (const value of [undefined, '4294967296', 1.5, -1, 1024, 2 ** 60, Number.NaN]) {
    assert.equal(reportedMemory(value), undefined, String(value))
  }
})

test('the guest reads MemTotal from /proc/meminfo', () => {
  const meminfo = 'MemTotal:        4024620 kB\nMemFree:          34000 kB\n'
  assert.equal(memTotalBytes(meminfo), 4024620 * 1024)
  assert.equal(memTotalBytes('MemFree: 1 kB\n'), undefined)
  assert.equal(memTotalBytes('MemTotal: lots kB\n'), undefined)
})

test('a lane offer names a known route only', () => {
  assert.equal(offerRoute('bench-lane/1 claude tools'), 'claude:tools')
  assert.equal(offerRoute('bench-lane/1 none plain'), 'none:plain')
  for (const line of ['bench-lane/1 claude', 'bench-lane/2 codex tools', 'bench-lane/1 x tools']) {
    assert.equal(offerRoute(line), undefined, line)
  }
})

test('the startup gate admits one at a time, in order', async () => {
  const gate = new StartupGate(10_000)
  const signal = new AbortController().signal
  const order: string[] = []
  const first = await gate.enter(signal, 1000)
  assert.ok(first)
  const second = gate.enter(signal, 1000).then((release) => {
    order.push('second')
    return release
  })
  const third = gate.enter(signal, 1000).then((release) => {
    order.push('third')
    return release
  })
  await delay(50)
  assert.deepEqual(order, [])
  first()
  // Releasing twice hands the gate on only once.
  first()
  ;(await second)!()
  ;(await third)!()
  assert.deepEqual(order, ['second', 'third'])
  // Free again: the next caller enters at once.
  assert.ok(await gate.enter(signal, 0))
})

test('the startup gate bounds a hold and a wait, and leaves on abort', async () => {
  const gate = new StartupGate(200)
  const signal = new AbortController().signal
  const held = await gate.enter(signal, 1000)
  assert.ok(held)
  // A start that never reports admission lets the next in once its hold ends.
  const next = await gate.enter(signal, 1000)
  assert.ok(next)
  // A wait shorter than the hold gives up.
  assert.equal(await gate.enter(signal, 50), undefined)
  const aborted = new AbortController()
  const waiting = gate.enter(aborted.signal, 1000)
  aborted.abort(new Error('stopped'))
  await assert.rejects(waiting, /stopped/)
  next()
  assert.ok(await gate.enter(signal, 0))
})

test('a waiter aborted as the gate is handed to it passes the gate on', async () => {
  const gate = new StartupGate(10_000)
  const signal = new AbortController().signal
  const first = await gate.enter(signal, 1000)
  const aborted = new AbortController()
  const handed = gate.enter(aborted.signal, 1000)
  const next = gate.enter(signal, 1000)
  first!()
  aborted.abort(new Error('stopped'))
  await assert.rejects(handed, /stopped/)
  assert.ok(await next)
})

/** An offer connection whose close, as on a real socket, arrives only after `destroy` returns. */
function fakeOffer(port: number) {
  const socket = new EventEmitter() as EventEmitter & { destroyed: boolean }
  Object.assign(socket, {
    remoteAddress: '127.0.0.1',
    remotePort: port,
    destroyed: false,
    destroy() {
      socket.destroyed = true
      setImmediate(() => socket.emit('close'))
    },
  })
  return socket as unknown as Socket
}

test('a guest stopped for a leaving waiter holds back every start before its close arrives', () => {
  const offers = new LaneOffers(8, 30_000)
  offers.add('claude:tools', fakeOffer(1))
  const leave = offers.wait('claude:tools')
  assert.ok(offers.next('claude:tools'))
  leave()
  // Synchronously, before the stopped guest's close event: no start is pending, the stop isn't
  // a failed start for whoever waits next, and no route may start a guest yet.
  assert.equal(offers.hasStarting('claude:tools'), false)
  assert.equal(offers.failedStarts('claude:tools'), 0)
  offers.add('claude:tools', fakeOffer(2))
  offers.add('codex:tools', fakeOffer(3))
  const claude = offers.wait('claude:tools')
  const codex = offers.wait('codex:tools')
  assert.equal(offers.next('claude:tools'), undefined)
  assert.equal(offers.next('codex:tools'), undefined)
  claude()
  codex()
})

test('a guest its relay closes before greeting is a failed start', async () => {
  const offers = new LaneOffers(8, 30_000)
  const socket = fakeOffer(4)
  offers.add('claude:tools', socket)
  const leave = offers.wait('claude:tools')
  assert.ok(offers.next('claude:tools'))
  socket.emit('close')
  assert.equal(offers.failedStarts('claude:tools'), 1)
  assert.equal(offers.hasStarting('claude:tools'), false)
  leave()
})
