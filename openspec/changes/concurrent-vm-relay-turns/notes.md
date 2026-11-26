# Implementation notes

Relay lanes, the guest's claim report, the coordinator's turn allowance and busy/absent decision, the requeue and `agent_vm_unavailable` are delivered in PR-A. A live run on the real VM remains.

## Changes to the plan

- **2026-11-26T15:20+11:00, task 1 (PR-A):** The coordinator's 45 s and 15 s waits became a `TurnTiming` argument of `startSessionBridge`, beside its status and catalogue timings, so the coordinator unit tests needn't sit out 45 s per case. Defaults are unchanged.

## Unexpected challenges

- **2026-11-26T15:20+11:00, task 3:** The process test's fake turn must outlast the 45 s wait; a shorter turn lets trunk's single-connection relay hand the second turn a connection before its wait ends, and RED shows nothing. Each fake turn holds 50 s (65 s in the capacity case).

## Decisions made during implementation

- **2026-11-26T15:20+11:00, task 2:** The relay's default capacity (8) is a literal in `relay.mjs`, which can't import TypeScript; a tooling test checks it equals `MAX_SESSION_SLOTS`. The launcher passes nothing, so `pnpm dev` and the packaged deployment get the same default. Rejected: the launcher passing `INTAKE_VM_RELAY_TURNS`, which would duplicate the constant in a third place.
- **2026-11-26T15:20+11:00, task 1:** The supervisor-fence case for a requeue passed before the runner change, because settlement already takes the fence; it is kept as a regression for the new settlement path rather than as RED evidence.

## Open items

- Concurrent provider CLIs in the 2 GiB default VM: memory is not changed here; the deployment README's sizing advice applies.
- Live run on `bench-agent-m1-local` after merge, with a runner image refresh.
