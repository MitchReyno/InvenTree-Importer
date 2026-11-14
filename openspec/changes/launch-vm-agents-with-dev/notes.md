# Implementation notes

`pnpm dev` starts and stops the agent VM, its credential tunnels and relays when `INTAKE_VM_NAME` names it. Delivered in one PR; in progress.

## Changes to the plan

- **2026-11-13T19:04+10:00, task 1:** Review found that the relay's port was only checked for presence and that `INTAKE_VM_KEEP_RUNNING` was checked only with a named VM. The resolver now validates the port with the relay's range and the switch always; the spec's validation requirement says so.
- **2026-11-13T19:09+10:00, task 2:** Review round 2 found the boot decision sat in `dev.cjs`, outside the tested module the design described. It moved into `vm.cjs` as `ensureVmRunning` with tests. `limactl` commands now run in their own process group, so a second Ctrl-C during "Stopping VM" cannot kill the stop. The instance-name form now requires a leading letter or digit, so a name cannot be read as a `limactl` option; `relay.mjs` and the four bridge scripts use the same form. The design and spec were updated.
- **2026-11-13T19:17+10:00, task 2:** Review round 3 found the `limactl` commands inherited the launcher's whole environment, so a shell secret could reach the Lima host agent. They now get the same base environment as the relays, and a command that ignores SIGTERM is killed after a 5 s grace so a timeout or cancellation stays bounded.
- **2026-11-13T19:24+10:00, task 2:** The launcher's last-resort error printer accepted only `^[a-z_]+$`, so any child-named code with a hyphen printed as `development_startup_failed`. It is now `failureCode` in `process.cjs`, accepting `^[a-z][a-z0-9_-]*$`. Besides the new VM child codes, the existing `tailscale-serve_stopped_during_startup` now prints as itself.
- **2026-11-13T19:24+10:00, task 4:** Review round 4 found the "startup fails after booting the VM" scenario unproved. The shutdown VM step moved into `vm.cjs` as `finishVm`, which never throws, with unit tests, and a qualification run with the tunnel port held confirmed the VM is stopped and the lock released.
- **2026-11-13T19:29+10:00, task 2:** Review round 5 found that the launcher drops its signal handlers when shutdown starts, so a second Ctrl-C killed it before the VM stop. While a VM this run booted still needs stopping, the next stop signal is now held with a message and the one after quits, leaving the VM running. `limactl` messages are forwarded with a `[limactl]` prefix, so `vm_start_failed` comes with its cause.
- **2026-11-13T19:37+10:00, task 3:** Review round 7 corrected the round 5 description: a forced quit leaves the VM running only if its `limactl stop` had not started, because that stop runs in its own process group and finishes anyway. The docs, design and message now say so. The root README's hand-run tunnels also gained `ControlPath=none` and a pointer to the `INTAKE_VM_NAME` route.
- **2026-11-13T19:45+10:00, task 2:** Review round 8 noted that `limactl stop` still wrote to pipes back to the launcher, so a forced quit could kill it on its next log line. It now runs with its output discarded; qualification forced a quit two seconds into the stop and the VM still stopped, and the next run removed the stale lock and started normally.
- **2026-11-14T12:28+10:00, task 2:** Review round 9 found a failed VM stop still exited with status 0; the launcher now exits 1 when `finishVm` reports a failed stop. Rounds 8 and 9 read the start of the Ctrl-C hold differently; the docs and design now say it runs from when the app begins stopping its processes, which is where the guard is installed.
- **2026-11-14T12:33+10:00, task 2:** Review round 10 was clean apart from nitpicks: the guard is now released even if the lock release throws, the concurrent-start race is recorded under the design's risks, and the duplicated process-group handling is listed under open items.

## Unexpected challenges

- **2026-11-13T18:57+10:00, task 4:** Qualifying from the worktree could not use the local InvenTree, whose Compose project belongs to the main checkout (`inventree_dev_owned_by_other_checkout`). The runs used the mock inventory instead; the inventory choice does not touch the VM lifecycle.
- **2026-11-13T18:57+10:00, task 4:** The first cold-start run used the developer's retained mock namespace, where saved agent settings and ready photos made the real-agent worker queue an Examine session within seconds. The guest refused the turn (`guest_turn_refused`, no native session), but Ctrl-C left its agent slot held, so the next workers stopped with `agent_reap_confirmation_required`. Later runs used a fresh private `INTAKE_APP_STATE`. The held slot is reported to the developer rather than cleared by hand, because the explicit interruption step is a deliberate manual seam.
- **2026-11-14T12:33+10:00, task 4:** The repository-wide `pnpm format:check` fails on `tooling/deployment/guest/browser-seccomp.json`, unchanged since #150 and untouched here; CI does not run that check. The gate runs Prettier on the files this change touches instead, and the design and task plan say so.

## Decisions made during implementation

- **2026-11-13T18:57+10:00, task 2:** Ctrl-C during the VM boot reports `vm_start_failed`, as an interrupted setup step reports `development_setup_failed`; the VM is still stopped. A separate cancellation message was not added, to keep one failure style.
- **2026-11-13T18:57+10:00, task 2:** Each relay logs `guest_turn_refused` when a source reload cuts off its waiting guest turn. It is left visible: it is the relay's own output, and the relay reconnects within seconds.

## Open items

- `runCommand` in `tooling/dev/vm.cjs` repeats the process-group handling of `run()` in `tooling/dev.cjs` (detached spawn, SIGTERM then SIGKILL after a grace), because `run` has no output capture, timeout or discarded output. Moving `run` onto `runCommand` is a possible follow-up; it is not tracked elsewhere.
