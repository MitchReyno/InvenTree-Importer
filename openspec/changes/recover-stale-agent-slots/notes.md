# Implementation notes

2026-11-25T16:49+1100 — Root cause, inferred from the code (the original `pnpm dev` output wasn't kept). The launcher signalled every child at once, relays included, and a stopping relay never makes the next connection the coordinator's removal probe needs; separately, the session worker gave DBOS 10 s and then closed the bridge and pool under a turn that may wait 45 s for its proof. The process test "a stopping worker waits…" reproduces the second half: with the shutdown wait removed it fails because the coordinator ends the probe connection before the guest's 12 s answer.

2026-11-25T16:49+1100 — Host-native turns record `host` but no process group, so they keep refusing at startup (design D4). Recording process groups would touch every `AgentChild` spawn site for profiles expected to go; left open.

2026-11-25T16:49+1100 — Departure from the plan: closing the bridge now aborts any wait for a removal proof. Without it a worker whose shutdown wait expired stayed alive until the coordinator's 45 s probe bound, outlasting the launcher's grace. Design D1 updated.

2026-11-25T16:49+1100 — The unit and PG tests were written alongside the slot record and recovery code rather than strictly before it; their RED state is the missing columns and module. The launcher order and the shutdown wait have explicit RED runs (missing `stopInOrder`, and the mutated worker above).

2026-11-25T16:49+1100 — Migration number: `feat/agent-stage-inputs-outputs-briefs` also adds a `0039`. Whichever merges second renumbers its migration.

2026-11-25T17:40+1100 — Review round 1 (8 findings) fixed: the release is now one exact conditional `UPDATE` on the supervisor lock's connection, with the lock-loss signal ending guest checks; a slot of another target or context is kept (`held_by_other_scope`); the `/1` worker interrupts released sessions at start; the VM driver rechecks cancellation after recording and sends nothing if it fired; past the shutdown bound proof waits end so a late proof doesn't count; the `vm_command` check is null-safe; the deployment guide states the stop order and that rolling back across `0039` needs the earlier backup.

2026-11-25T17:40+1100 — Decision on the diagnostic of a recovered turn: `agent_session_failure` keeps one immutable record per attempt and turn, so a turn whose stopped worker recorded `agent_reap_pending` keeps it after a confirmed recovery; the session state (`interrupted`) shows the outcome. The spec scenario says so instead of requiring `agent_worker_interrupted`.

2026-11-25T17:40+1100 — Not covered, left open: a claim or driver record already in flight on a pooled connection when the supervisor lock is lost can still commit after a replacement worker's check (the lock fences supervisors, not every pooled write). This predates the change (`interruptRunningSessions` has the same assumption). The `/1` worker's start-time interruption and a late shutdown proof have no dedicated process test.
