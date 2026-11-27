import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guestTurn } from '../support/guest-turn.ts'

test(
  "a guest turn passes its sealed effort to the CLI, and the guest's report is recorded",
  { timeout: 60_000 },
  async (t) => {
    const run = await guestTurn(t)
    assert.equal(run.served.status, 'fulfilled')
    assert.deepEqual(
      run.outcome,
      { status: 'fulfilled', value: 'finished' },
      JSON.stringify(run.events),
    )
    const args = run.events.find((event) => event.event === 'claude-args')
    assert.deepEqual(args, { event: 'claude-args', model: 'claude-opus-5-5', effort: 'max' })
    assert.equal(run.sentEffort, 'max')
  },
)

test(
  'a guest reporting an effort its input did not seal is refused and nothing is recorded',
  { timeout: 60_000 },
  async (t) => {
    const run = await guestTurn(t, {
      runNative: async (_context, _opening, request) => {
        await request({ provider: { providerSessionId: 'guest-session', actualModel: 'claude-x' } })
        await request({ sentEffort: 'low' })
      },
    })
    // The coordinator closes the turn, which then waits for the guest's proof that it stopped.
    assert.equal(run.outcome.status, 'rejected')
    assert.match(String((run.outcome as PromiseRejectedResult).reason), /reap/)
    assert.equal(run.sentEffort, null)
  },
)
