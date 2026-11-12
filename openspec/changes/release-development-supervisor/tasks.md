# Implementation and delivery tasks

## Plan context

Proposal: [proposal.md](proposal.md). Design: [design.md](design.md). Specs are opted out (`skip_specs: true`): this is development tooling and does not change a product capability.

Canonical change name: `release-development-supervisor`. Linked BI items: none.

## Completion and commit ordering

Complete and verify a checkbox action, then mark it checked before committing its corresponding completed work. Stage the `tasks.md` update in the same commit as that work. Keep incomplete actions unchecked. Review, publication, CI and merge stay pending until they happen.

## Task map and dependencies

Two implementation tasks. The stale-lock reclaim and the terminal-close shutdown are one operator outcome, and each is independently testable. The documentation update lands with the shutdown task because it describes both behaviors. No investigation or migration task is outstanding: the current lock, `running.json` and `stop()` path were read before planning.

## PR delivery map

| Bundle | Outcome and included work | Task/checklist coverage | Why this boundary is sensible | Prerequisites and merge order | Base, branch and subject | Verification and merge gates |
| --- | --- | --- | --- | --- | --- | --- |
| PR-A | `pnpm dev` stops when its terminal closes, and the next start reclaims a dead supervisor's lock | Tasks 1 and 2 in full | The stop path and the reclaim path are the two halves of one recovery story. Shipping either alone leaves the failure the operator just hit | None | `interactive-app`, `feat/release-development-supervisor`, `feat(release-development-supervisor): stop pnpm dev when the terminal closes` | `pnpm test:dev`, Prettier on the touched files, Markdown check for `docs/development.md`, independent exact-head review, selected CI |

## 1. Reclaim a stale supervisor lock

- PR delivery: PR-A.

- Outcome: `pnpm dev` removes `supervisor.lock` when the recorded supervisor is gone, stops orphaned app processes whose identity still matches, and still refuses when the supervisor or an unidentified child is alive.

- Scope and approach: add `tooling/dev/supervisor-lock.cjs` and call it from `privateState`. Record `startedAt` and `group` in the lock and `running.json`. Retry the public port check only after reclaim when the port was already in use. Tests live in `tooling/tests/dev-supervisor.test.cjs` and are added to `pnpm test:dev`.

- Prerequisites: None.

- Acceptance: a dead supervisor with dead children yields a new lock; a matching orphan is signalled and a reused pid is not; an unreadable lock and a live supervisor stay in place and throw `development_supervisor_lock_exists_inspect_owned_state`.

- TDD approach: add the reclaim tests first and confirm they fail because the helper does not exist, then implement until `pnpm test:dev` covers them in green.

- Verification: `pnpm test:dev`.

- Risks and decisions: None beyond the design's legacy command-fragment rule.

- [x] 1.1 Confirm the current lock, `running.json` shape and reset's dead-pid rule still match the design.

- [x] 1.2 RED: add the reclaim regressions and run them so they fail before the helper exists.

- [x] 1.3 GREEN: reclaim stale locks, refuse live or unidentified owners, and record start times for new locks and children.

- [x] 1.4 Re-run `pnpm test:dev` and confirm the existing dev launcher tests still pass.

## 2. Stop the app when the terminal session ends

- PR delivery: PR-A.

- Outcome: SIGHUP and the exit of the supervisor's parent run the same shutdown as Ctrl-C: owned app processes stop, the lock is released, and retained data stays.

- Scope and approach: add `tooling/dev/session.cjs` and bind it for the whole supervised run in `tooling/dev.cjs`. Update the help line and `docs/development.md`.

- Prerequisites: Task 1's release function, so shutdown can drop the lock it acquired.

- Acceptance: a subprocess that binds the session hook writes its marker and exits on SIGHUP; a changed parent pid requests shutdown; a failed parent lookup does not; the development guide no longer tells the operator to rename a stale lock by hand.

- TDD approach: add the session regressions with the Task 1 tests, confirm they fail before the hook exists, then implement and re-run the suite.

- Verification: `pnpm test:dev`, Prettier on the touched source, and `pnpm lint:markdown` for the guide. A real terminal-close of `pnpm dev` is a manual check and is not claimed by the unit run.

- Risks and decisions: None.

- [x] 2.1 Confirm shutdown still funnels through one `finally` that stops children and releases the lock.

- [x] 2.2 RED: add the SIGHUP and parent-watch regressions and confirm they fail before the hook exists.

- [x] 2.3 GREEN: bind SIGHUP, SIGINT, SIGTERM and the parent watch to the existing shutdown, from setup through the ready app.

- [x] 2.4 Update `docs/development.md` and the `pnpm dev` help line so they describe terminal close and automatic reclaim.

- [x] 2.5 Re-run `pnpm test:dev` and the Markdown check. Record results in the PR description.
