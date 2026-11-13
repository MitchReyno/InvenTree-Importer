# Implementation notes

`pnpm dev` starts and stops the agent VM, its credential tunnels and relays when `INTAKE_VM_NAME` names it. Delivered in one PR; in progress.

## Changes to the plan

- **2026-11-13T19:04+10:00, task 1:** Review found that the relay's port was only checked for presence and that `INTAKE_VM_KEEP_RUNNING` was checked only with a named VM. The resolver now validates the port with the relay's range and the switch always; the spec's validation requirement says so.
- **2026-11-13T19:09+10:00, task 2:** Review round 2 found the boot decision sat in `dev.cjs`, outside the tested module the design described. It moved into `vm.cjs` as `ensureVmRunning` with tests. `limactl` commands now run in their own process group, so a second Ctrl-C during "Stopping VM" cannot kill the stop. The instance-name form now requires a leading letter or digit, so a name cannot be read as a `limactl` option; `relay.mjs` and the four bridge scripts use the same form. The design and spec were updated.

## Unexpected challenges

- **2026-11-13T18:57+10:00, task 4:** Qualifying from the worktree could not use the local InvenTree, whose Compose project belongs to the main checkout (`inventree_dev_owned_by_other_checkout`). The runs used the mock inventory instead; the inventory choice does not touch the VM lifecycle.
- **2026-11-13T18:57+10:00, task 4:** The first cold-start run used the developer's retained mock namespace, where saved agent settings and ready photos made the real-agent worker queue an Examine session within seconds. The guest refused the turn (`guest_turn_refused`, no native session), but Ctrl-C left its agent slot held, so the next workers stopped with `agent_reap_confirmation_required`. Later runs used a fresh private `INTAKE_APP_STATE`. The held slot is reported to the developer rather than cleared by hand, because the explicit interruption step is a deliberate manual seam.

## Decisions made during implementation

- **2026-11-13T18:57+10:00, task 2:** Ctrl-C during the VM boot reports `vm_start_failed`, as an interrupted setup step reports `development_setup_failed`; the VM is still stopped. A separate cancellation message was not added, to keep one failure style.
- **2026-11-13T18:57+10:00, task 2:** Each relay logs `guest_turn_refused` when a source reload cuts off its waiting guest turn. It is left visible: it is the relay's own output, and the relay reconnects within seconds.

## Open items

None.
