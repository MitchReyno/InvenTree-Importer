import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SETTLEMENT_FENCE_RETRY_MS } from '#/agents/session/session-runner.ts'
import {
  fencePermits,
  SUPERVISOR_FENCE_WAIT_MS,
  type FencedWrite,
  type SupervisorFence,
  type SupervisorHolder,
} from '#/agents/supervisor-fence.ts'

const fence: SupervisorFence = {
  actorId: 'a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607',
  backendPid: 41_207,
  backendStartMicros: '1795592604243857',
}

const cases: [string, SupervisorHolder, FencedWrite, boolean][] = [
  [
    'this worker holds the lock: ownership',
    { backendPid: 41_207, backendStartMicros: '1795592604243857' },
    'ownership',
    true,
  ],
  [
    'this worker holds the lock: settlement',
    { backendPid: 41_207, backendStartMicros: '1795592604243857' },
    'settlement',
    true,
  ],
  [
    'another worker holds it: ownership',
    { backendPid: 52_881, backendStartMicros: '1795592611000001' },
    'ownership',
    false,
  ],
  [
    'another worker holds it: settlement',
    { backendPid: 52_881, backendStartMicros: '1795592611000001' },
    'settlement',
    false,
  ],
  // A reused PID is another connection, so it is another holder.
  [
    'the same PID started later: ownership',
    { backendPid: 41_207, backendStartMicros: '1795592699000000' },
    'ownership',
    false,
  ],
  [
    'the same PID started later: settlement',
    { backendPid: 41_207, backendStartMicros: '1795592699000000' },
    'settlement',
    false,
  ],
  // A holder whose start time this role can't see can't be shown to be this worker.
  [
    'a holder with no visible start: ownership',
    { backendPid: 41_207, backendStartMicros: null },
    'ownership',
    false,
  ],
  [
    'a holder with no visible start: settlement',
    { backendPid: 41_207, backendStartMicros: null },
    'settlement',
    false,
  ],
  ['no worker holds it: ownership', null, 'ownership', false],
  ['no worker holds it: settlement', null, 'settlement', true],
]

for (const [name, holder, write, permitted] of cases) {
  test(`fence: ${name}`, () => {
    assert.equal(fencePermits(fence, holder, write), permitted)
  })
}

test('a refused settlement outlasts a replacement that waits its whole barrier and then refuses', () => {
  // The replacement's refusal on a `host` slot is immediate once its barrier ends.
  assert.ok(SUPERVISOR_FENCE_WAIT_MS < SETTLEMENT_FENCE_RETRY_MS)
})
