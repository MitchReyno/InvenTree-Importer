# Design assessment

## Context and grounding

See the [proposal](proposal.md). `tooling/dev.cjs` owns the supervisor lifetime. `tooling/dev/process.cjs` owns child launch and stop. The lock directory checks stay in `privateState`; only the exclusive-create and reclaim policy moves to a testable helper. No product boundary changes, and the existing stop path is sufficient for children the supervisor still knows about.

## Goals and constraints

- Closing the terminal stops the app processes and releases `supervisor.lock`.
- The next `pnpm dev` recovers a lock whose supervisor is gone, including one written by today's launcher.
- A live supervisor, an unreadable lock and a live process that cannot be identified still fail with `development_supervisor_lock_exists_inspect_owned_state`.
- Never delete retained app data. Never signal a pid whose start time shows it is a different process.

## Decisions and alternatives

- **D1 — handle SIGHUP with the existing shutdown, and also stop when the parent pid changes.** Terminal close delivers SIGHUP to the foreground process group. The supervisor's children are detached, so the supervisor has to stop them. Watching the parent covers a launcher that dies without forwarding the signal: the supervisor's parent pid becomes 1 (or some other pid) and the same shutdown runs. A single failed `ps` lookup does not stop the app. Rejected: leaving reclaim as the only fix. That would clean the next start, but the current app would keep running after the terminal closed, which is the outcome to avoid.
- **D2 — identify a process by pid plus `ps -o lstart=` under `LC_ALL=C`.** The lock and `running.json` gain `startedAt`. A live pid with the same start time is the recorded process. A live pid with a different start time is a reuse and is not signalled. `LC_ALL=C` keeps the timestamp format stable. Rejected: pid alone, which can kill an unrelated process after reuse. Rejected: command line alone for new locks, which is ambiguous for `node src/main.ts`.
- **D3 — legacy locks with no start time.** A dead pid and no live children: remove the lock. A live pid: refuse. A dead supervisor with a live child: signal it only when its command contains the known entry for that child name and its parent is 1 or the dead supervisor. `tailscale-serve` has no unique command fragment, so a legacy live serve process refuses the start instead of being killed. New locks record `group: true` for that child so a later reclaim can signal the process group.
- **D4 — move the stale lock aside, and restore it with `link`.** Two starts can both decide the lock is stale. Renaming it to a unique `.stale` file and checking the nonce there avoids deleting a lock that a winner has just created. If the moved file is not the stale lock, `link` puts it back only when the path is empty. `link` fails with `EEXIST` rather than replacing a lock created in the gap, and the moved file stays for inspection. An unreadable child after `SIGTERM` is not treated as exited: the lock stays, and that pid is not sent `SIGKILL`. If the running session's `stop()` fails, the children are sent `SIGKILL` and the lock is still released so this process can exit.
- **D5 — retry the public port only when it was already in use.** The port check stays before Docker so an unrelated listener still fails fast. When that check is `EADDRINUSE`, startup continues through lock reclaim, which stops matching orphans, and checks the port again. Orphans hold the port only in the hard-kill case; the second check is what lets that start succeed.

## State, authority and failure behavior

The supervisor that creates the lock is the only process that may unlink it on shutdown. Release compares pid and nonce, treats a missing file as already released, and throws `development_lock_owner_changed` if the file names someone else.

Reclaim signals `SIGTERM`, waits five seconds, then `SIGKILL` only for a child that is still the recorded process. An unreadable pid keeps the lock. If a matched child is still alive after `SIGKILL`, the lock stays and startup throws the existing error. Unreadable lock JSON and unreadable `running.json` also leave the file in place. Shutdown of a live session uses the existing 45 second `stop()` grace, then `SIGKILL`, and releases the lock even when that wait fails.

No database, upload or InvenTree volume is removed. Reset's scan still treats a live pid as held and a dead pid as not held; it does not need to understand `startedAt`.

## Verification strategy

`tooling/tests/dev-supervisor.test.cjs`, included in `pnpm test:dev`, covers the lock identity decisions with an injected process table, one real `sleep` orphan stopped through `ps` and `SIGTERM`, SIGHUP on a subprocess, and the parent-pid watch with an injected lookup. These tests do not start Docker or the app. A full `pnpm dev` terminal-close check is manual and is not part of the automated run.

## Migration, rollout and recovery

Locks already on disk have no `startedAt`. They are reclaimed when the pid is dead, and left alone when it is alive. `running.json` may gain `startedAt` and `group`; existing readers use `name` and `pid` only. Rollback is reverting the launcher. A lock held by the new supervisor still blocks the old launcher, which is the same exclusive-create behavior as today.

## Risks and open decisions

A legacy child is identified by a command fragment plus an orphan parent. That can theoretically match another abandoned process that reused the pid and the same fragment. New locks use the start time instead. The parent watch can miss a parent whose pid is reused by the process that adopts the supervisor; SIGHUP remains the path for a normal terminal close. None of these need a further product decision.
