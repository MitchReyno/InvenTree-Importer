# Implementation notes

2026-11-25T16:49+1100 — Root cause, inferred from the code (the original `pnpm dev` output wasn't kept). The launcher signalled every child at once, relays included, and a stopping relay never makes the next connection the coordinator's removal probe needs; separately, the session worker gave DBOS 10 s and then closed the bridge and pool under a turn that may wait 45 s for its proof. The process test "a stopping worker waits…" reproduces the second half: with the shutdown wait removed it fails because the coordinator ends the probe connection before the guest's 12 s answer.

2026-11-25T16:49+1100 — Host-native turns record `host` but no process group, so they keep refusing at startup (design D4). Recording process groups would touch every `AgentChild` spawn site for profiles expected to go; left open.

2026-11-25T16:49+1100 — Departure from the plan: closing the bridge now aborts any wait for a removal proof. Without it a worker whose shutdown wait expired stayed alive until the coordinator's 45 s probe bound, outlasting the launcher's grace. Design D1 updated.

2026-11-25T16:49+1100 — The unit and PG tests were written alongside the slot record and recovery code rather than strictly before it; their RED state is the missing columns and module. The launcher order and the shutdown wait have explicit RED runs (missing `stopInOrder`, and the mutated worker above).

2026-11-25T16:49+1100 — Migration number: `feat/agent-stage-inputs-outputs-briefs` also adds a `0039`. Whichever merges second renumbers its migration.
