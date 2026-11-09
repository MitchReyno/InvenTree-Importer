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

test('disconnect during final progress leaves reconciliation required even if the provider maps it to failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'turn-disconnect-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'turn')
  const abort = new AbortController()
  await assert.rejects(
    journalTurn(
      path,
      {},
      async () => {
        abort.abort()
        return 'agent_turn_failed'
      },
      abort.signal,
    ),
    { name: 'AbortError' },
  )
  await assert.rejects(
    journalTurn(path, {}, async () => assert.fail('replayed')),
    /requires_reconciliation/,
  )
})

test('a terminal probe never creates or completes a journal, and verifies the exact command', async (t) => {
  const { recordedOutcome } = await import('../src/agents/shared-vm/journal.ts')
  const { readFile } = await import('node:fs/promises')
  const root = await mkdtemp(join(tmpdir(), 'turn-probe-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const path = join(root, 'journal')
  const command = { turn: '1', lineage: 'lineage', text: 'original' }
  await assert.rejects(recordedOutcome(path, command), { code: 'ENOENT' })
  await assert.rejects(readFile(path), { code: 'ENOENT' })
  await journalTurn(path, command, async () => 'done')
  assert.equal(await recordedOutcome(path, command), 'done')
  const bytes = await readFile(path)
  await assert.rejects(
    recordedOutcome(path, { ...command, text: 'changed' }),
    /requires_reconciliation/,
  )
  assert.deepEqual(await readFile(path), bytes)
})
