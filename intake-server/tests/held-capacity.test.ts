import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heldCapacityVerdict, type HeldCapacity, type VmReapProof } from '#/agents/held-capacity.ts'

const attemptId = '7a1f0c52-9e1d-4c35-8b3f-0d2b6e5a4c91'

const slot = (
  child: Extract<HeldCapacity, { holds: 'slot' }>['child'],
): Extract<HeldCapacity, { holds: 'slot' }> => ({
  holds: 'slot',
  attemptId,
  turn: child === null ? null : 3n,
  child,
  vmCommand: child === 'vm' ? '{"protocol":"x"}' : null,
})

const cases: [
  string,
  HeldCapacity,
  VmReapProof | undefined,
  ReturnType<typeof heldCapacityVerdict>,
][] = [
  ['a turn that started nothing', slot('none'), undefined, { release: true, reason: 'no_child' }],
  [
    'a turn that started nothing, whatever a probe said',
    slot('none'),
    'unconfirmed',
    { release: true, reason: 'no_child' },
  ],
  [
    'a VM turn whose removal the guest confirmed',
    slot('vm'),
    'removed',
    { release: true, reason: 'vm_worker_removed' },
  ],
  [
    'a VM turn the guest did not confirm',
    slot('vm'),
    'unconfirmed',
    { release: false, reason: 'vm_reap_unconfirmed' },
  ],
  [
    'a VM turn with no proof asked for',
    slot('vm'),
    undefined,
    { release: false, reason: 'vm_reap_unconfirmed' },
  ],
  [
    'a VM turn with no bridge to ask',
    slot('vm'),
    'unavailable',
    { release: false, reason: 'vm_bridge_unavailable' },
  ],
  [
    'a host process',
    slot('host'),
    'removed',
    { release: false, reason: 'host_child_unverifiable' },
  ],
  [
    'a slot claimed before turns were recorded',
    slot(null),
    'removed',
    { release: false, reason: 'turn_child_unrecorded' },
  ],
  [
    'the Processing lane',
    { holds: 'lane', attemptId },
    'removed',
    { release: false, reason: 'lane_child_unverifiable' },
  ],
]

for (const [label, held, proof, expected] of cases) {
  test(`held capacity: ${label}`, () => {
    assert.deepEqual(heldCapacityVerdict(held, proof), expected)
  })
}
