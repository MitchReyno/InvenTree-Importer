import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nativeTurnOutcome } from '#/agents/shared-vm/native-outcome.ts'
import { NativeSessionError } from '#/agents/failure-model.ts'
import { SessionResumeUnavailable } from '#/agents/session/session-adapters.ts'
import { ResearchReapPendingError } from '#/research/errors.ts'

test('the policy is published before the provider turn starts', async () => {
  const steps: string[] = []
  const outcome = await nativeTurnOutcome({
    publishPolicy: async () => {
      steps.push('publish')
    },
    run: async () => {
      steps.push('run')
    },
  })
  assert.equal(outcome, 'done')
  assert.deepEqual(steps, ['publish', 'run'])
})

test('a policy that cannot be published is a recorded failure and the provider never starts', async () => {
  let runs = 0
  const outcome = await nativeTurnOutcome({
    publishPolicy: async () => {
      throw Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' })
    },
    run: async () => {
      runs++
    },
  })
  assert.equal(outcome, 'agent_turn_failed')
  assert.equal(runs, 0)
})

test('provider failures keep their existing outcomes', async () => {
  const cases: [unknown, string][] = [
    [new SessionResumeUnavailable(), 'resume_unavailable'],
    [new NativeSessionError('agent_login_required'), 'agent_login_required'],
    // Only the typed provider error is a login failure, whatever a plain error says.
    [new Error('agent_login_required'), 'agent_turn_failed'],
    [new Error('anything else'), 'agent_turn_failed'],
    // Tool-policy refusals keep their codes, so the operator sees why the turn stopped.
    [new NativeSessionError('agent_tool_refused'), 'agent_tool_refused'],
    [new NativeSessionError('agent_policy_refused'), 'agent_policy_refused'],
    [new NativeSessionError('agent_timeout'), 'agent_turn_failed'],
  ]
  for (const [error, expected] of cases) {
    const outcome = await nativeTurnOutcome({
      run: async () => {
        throw error
      },
    })
    assert.equal(outcome, expected)
  }
})

test('a pending reap still escapes so the coordinator keeps the slot', async () => {
  const pending = new ResearchReapPendingError()
  await assert.rejects(
    nativeTurnOutcome({
      run: async () => {
        throw pending
      },
    }),
    (error) => error === pending,
  )
})
