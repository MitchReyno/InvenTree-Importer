# Implementation notes

The memory-derived turn cap, the startup gate, lanes on demand, the startup-timeout requeue and the VM sizes are delivered in PR-A. A live run on the resized VM and on a Pi remain.

## Changes to the plan

- **2026-11-27T14:00+11:00, task 1 (PR-A):** The design had the session worker log capacity changes; the coordinator logs `vm_turn_capacity` instead, since it is where a greeting changes the capacity. Design D1 updated.
- **2026-11-27T14:00+11:00, task 2 (PR-A):** The bound on an unclaimed started guest is part of the coordinator's `TurnTiming` (`startedIdleMs`, 30 s), beside the startup gate's hold and wait, so the coordinator unit tests needn't wait 30 s.
- **2026-11-27T15:05+11:00, tasks 1–4 (PR-A, review round 1):** The capacity is read under the slot lock (the claim takes a reader), and only an admitted greeting's report counts. A leaving waiter stops starting guests no other waiter needs. Closing the bridge requeues turns waiting for the gate or a connection, and a gate hand-off to an aborted waiter passes it on. The startup reap check asks about held turns one at a time, since each starts a guest on demand. The journal probe after a lost connection gets 45 s and ends on close. An interruption resets `startup_timeouts`, and a claim whose session still owes its opening isn't settled idle when its pending items were withdrawn. The deployment README names the `0048` grant refresh. Design D3/D4 and the architecture were updated.
- **2026-11-27T15:40+11:00, tasks 2 and 4 (PR-A, review round 2):** `pnpm dev` waits up to 390 s for the session worker's ready line, covering eight serial 45 s reap checks. A guest that closes before greeting holds back its route's next start for 30 s (a time bound, since the relay confirms no teardown), and a route whose every guest failed during a wait, with none starting or busy, fails as `agent_vm_unavailable` instead of requeuing forever. Only a first opening owed bypasses the withdrawn-wake shortcut; an established session goes back to idle and its startup streak clears. The 45 s admission deadline is documented as Claude's only.
- **2026-11-27T16:20+11:00, tasks 2 and 4 (PR-A, review round 3, not re-reviewed):** The 30 s hold after a guest closes before greeting applies to every route, since all share the VM. A guest still starting at the end of a turn's wait counts as a failed start, so a relay that accepts `go` but never greets reads as unavailable. A session cancelled after its CLI timed out keeps no timeout diagnostic. The architecture describes the withdrawn-wake rule as implemented.

- **2026-11-27T16:50+11:00, task 4 (PR-A):** Trunk gained migrations `0046_stage_outputs` and `0047_model_catalog_not_listed` (#299, #300) while this branch was open, so its migration is now `0048_startup_timeouts.sql` after a rebase onto `548dd9d0`.

## Unexpected challenges

- **2026-11-27T14:00+11:00, task 4:** An admission timeout can't be requeued as #298's capacity miss is, with its turn count restored: the guest journals each turn by attempt and turn number, so the same turn would replay its recorded `agent_turn_failed`. The requeue keeps the turn counted, which design D4 already says.
- **2026-11-27T14:00+11:00, task 2:** A guest started from an offer is found again after its TLS admission by its loopback peer address (`peerKey`), since the TLS server's socket doesn't expose the transport it wraps.

- **2026-11-27T17:16+11:00, task 2 (PR-A, CI):** A guest the coordinator stopped for a leaving waiter was settled only when its socket's `close` arrived, a moment after the leaving turn had settled. A turn starting in that window saw no hold and then counted the stop as its own failed start, so it failed as `agent_vm_unavailable` instead of requeuing (2 of 36 runs under CPU load, and on the CI runner). Such a stop is now settled when it is made: the hold is set and the start forgotten at once, and only a close from the relay counts as a failed start.

## Decisions made during implementation

- **2026-11-27T14:00+11:00, task 2:** The relay accepts bytes after `go` and hands them to the guest's connection, though the coordinator sends none: the coordinator is the TLS server and never speaks first. Rejected: refusing them, which made a test that writes `go` with its next bytes in one write fail for no protocol reason.
- **2026-11-27T14:00+11:00, task 5:** The resize step reads the size from `tooling/deployment/lima/agent.yaml`, so the template stays the one place the development VM's size is set. The Pi's 3 CPUs are passed to `limactl start` in the README rather than kept in a second template.

## Open items

- The coordinator can't see a guest's teardown: the 30 s hold after a guest closes before greeting, and the gap between a startup probe's answer and its guest's exit, are time bounds, not confirmations. A relay teardown report would close them (review round 3, finding 1).
- `pnpm dev`'s longer wait for the worker (`AGENTS_READY_MS`) is checked against its constants, not by a launcher run with a delayed ready line (review round 3, finding 4).
- A journal probe recovers only the guest's journalled outcome (`agent_turn_failed`), not its cause, so an admission timeout whose final frame was lost fails rather than requeuing. Carrying the cause needs a journal format change that older records must stay readable under; left for a follow-up (review round 1, finding 4).
- `concurrent-vm-relay-turns` is not archived yet. Its `shared-vm-execution` delta's "Idle relay" (one ready guest connection) and "Older guest image" (one turn at a time without the claim report) scenarios are superseded by this change's "Relays start guests only on demand"; reconcile them when both are archived.
- The effective VM cap isn't shown in Settings › Agents beside **Sessions at once**.
- The 768 MiB always-on allowance and the 960 MiB per turn are estimates from the container ceilings; no turn's memory was measured.
- Live run on `bench-agent-m1-local` after resizing it to 4 CPUs / 4 GiB, with a runner image refresh; and a Pi 5 run.
