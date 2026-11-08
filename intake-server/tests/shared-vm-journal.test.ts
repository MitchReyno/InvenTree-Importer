import { once, EventEmitter } from 'node:events'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { journalTurn } from '../src/agents/shared-vm/journal.ts'

test('an exact redelivery after a lost completion ACK returns the recorded outcome', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'turn-journal-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const outcome of [
    'done',
    'agent_login_required',
    'agent_turn_failed',
    'resume_unavailable',
  ] as const) {
    const path = join(root, outcome)
    assert.equal(await journalTurn(path, { turn: 1 }, async () => outcome), outcome)
    assert.equal(
      await journalTurn(path, { turn: 1 }, async () => assert.fail('executed twice')),
      outcome,
    )
    await assert.rejects(
      journalTurn(path, { turn: 2 }, async () => assert.fail('executed conflicting command')),
      /requires_reconciliation/,
    )
  }
})

test('a concurrent delivery and a restart after uncertain execution cannot launch again', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'turn-journal-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'turn')
  const control = new EventEmitter()
  const started = once(control, 'started')
  const stop = once(control, 'stop')
  const launch = journalTurn(path, {}, async () => {
    control.emit('started')
    await stop
    throw new Error('guest_stopped')
  })
  await started
  await assert.rejects(
    journalTurn(path, {}, async () => assert.fail('duplicate launch')),
    /requires_reconciliation/,
  )
  control.emit('stop')
  await assert.rejects(launch, /guest_stopped/)
  await assert.rejects(
    journalTurn(path, {}, async () => assert.fail('restart replayed an uncertain launch')),
    /requires_reconciliation/,
  )
})
