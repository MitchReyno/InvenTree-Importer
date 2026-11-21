# Change proposal

## Problem and intended outcome

Closing the terminal that is running `pnpm dev` leaves the development app running and blocks the next start. The supervisor handles Ctrl-C and SIGTERM, but a closed terminal delivers SIGHUP, which Node treats as an immediate exit. The exclusive `supervisor.lock` is never released, and the app processes stay behind because they are started in their own sessions. The next `pnpm dev` then stops with `development_supervisor_lock_exists_inspect_owned_state` even when that supervisor is already gone.

The outcome: closing the terminal stops the supervisor and the app processes it owns, and releases the lock. If a hard kill still leaves the lock, the next `pnpm dev` stops orphaned app processes that still match the recorded identity and removes the lock. A supervisor that is actually running still keeps the namespace.

## Change identity and linked items

Canonical name: `release-development-supervisor`. Branch `feat/release-development-supervisor`. Subjects `feat(release-development-supervisor): …`.

Linked BI items: none. This is developer tooling, not product functionality.

## Current behavior and evidence

- `tooling/dev.cjs` registers only `SIGINT` and `SIGTERM`. The handler aborts startup, terminates owned children and lets the `finally` block stop them and unlink `supervisor.lock`.
- `tooling/dev/process.cjs` starts every child with `detached: true`, so a terminal hangup does not reach them. Only the `tailscale-serve` child is signalled as a process group.
- The lock is created with `open(lock, 'wx')` and stores `{ pid, nonce }`. `EEXIST` always throws `development_supervisor_lock_exists_inspect_owned_state`. There is no check that the recorded pid is alive.
- `running.json` records child names and pids. `docs/development.md` tells the operator to inspect that file and rename the lock by hand after a hard kill.
- Observed on this machine: `~/.local/state/bench-intake/local-inventree-…/supervisor.lock` named pid 58640, `running.json` named the ui, api, media and agents children, and none of those processes were running. Nothing was listening on port 4330. `pnpm dev` still exited 1 after the local InvenTree stack had come up.

## Scope and non-goals

In scope: handle terminal close for the full-stack supervisor, stop the owned app processes, release the lock, and on the next start reclaim a lock whose supervisor is gone. Update `docs/development.md` and the launcher tests.

Not in scope: `pnpm dev:ui`, `pnpm dev:intake`, the InvenTree Compose lifecycle, deleting retained app data or databases, and changing the reset rule that a live supervisor blocks `inventree:dev reset`.

## Reuse and dependency assessment

The launcher already owns the lock file, the child list and the stop path. Reset already treats a dead pid as not holding the lock (`alive()` in `tooling/inventree-dev/lib.cjs`) but it never removes the file or stops children. No installed package tracks this supervisor.

A new pidfile or lock package was not investigated as a dependency. The behavior that has to stay in this repo is local: which children are ours, the start-time identity that prevents killing a reused pid, and the existing JSON lock that reset already reads. An advisory kernel lock would disappear with the process and still would not stop detached children. Extending the current lock and stop path covers the request without a new dependency.

## Capabilities

### New capabilities

None.

### Modified capabilities

None. The change declares `skip_specs: true`. It is development tooling, in the same way as `dev-tailnet-access`, and it does not change a product capability. The operator contract stays in `docs/development.md`, covered by the launcher tests.

## Impact and dependencies

`pnpm dev` gains a SIGHUP handler and a watch on its parent process. A stale lock is removed only after the recorded supervisor is confirmed gone. Orphaned children are signalled only when their recorded start time still matches, or, for a lock written before start times existed, when the command and parent pid still identify that child. Retained databases, uploads and the local InvenTree stack are unchanged. A second `pnpm dev` whose supervisor is still alive still fails with the same error code.

## Open decisions and assumptions

- Assumed: exit 0 is correct when the operator closes the terminal or presses Ctrl-C after the app has started. A child crash still sets exit code 1 before stopping the rest.
- Assumed: a lock whose pid is alive but which has no recorded start time is still the owner. That refuses the start rather than killing a process that might have reused the pid. Locks written by this change include the start time, so a later reuse can be told apart.
