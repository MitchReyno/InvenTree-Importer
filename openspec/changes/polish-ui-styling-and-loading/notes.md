# Implementation notes

Implementation of the UI polish and calm loading plan, delivered as PR-A to PR-I after the plan PRs (#247, #248). PR-A is underway; PR-B to PR-I remain.

## Changes to the plan

None yet.

## Unexpected challenges

- **Task 2 (PR-A):** `screenshots:frontend` cannot capture `header-disclosure`: Public Sans never loads on that fixture, before and after this change. The other ten fixture pages are compared.

## Decisions made during implementation

- **2026-11-23T19:36+11:00, task 8 (PR-A):** Settings › Agents and the other Settings sections keep their row descriptions (`SettingRow` `help`, `SettingsSection` `lead`) as visible text. They are the design system's row-description pattern, not standing explanations under a heading; the sweep moved only Processing, Agents and Review text. "Not supported yet" reasons, legends of table marks and consequences of an action stay visible.
- **2026-11-23T19:36+11:00, task 8 (PR-A):** `Popover` chooses its alignment when it opens (`chooseAlign`): it keeps the preferred edge while that side of the trigger has room and otherwise opens from the trigger's other edge, rather than letting the window edge push the panel away. The panel's width is read as it attaches, before Radix caps it to the room on the aligned side. Rejected: setting `align="start"` on the need-you panel only, which would leave every other popover with the same trap.
- **2026-11-24T03:41+11:00, task 11.1 (PR-F):** Settings › Agents controls, by save mode. Non-text, saving as they change: each provider's On and sign-in choice, the default provider, each step's provider choice, the sessions stepper, Suggest tags for new batches, and both Web research switches. Text, keeping an explicit Save: Instructions, the Part description style and, until task 13's model picker, each provider's default model and each step's model. Unchanged: the credential panels and Pause all agents, which are their own commands, and the deferred description rows, which send nothing.
- **2026-11-24T03:41+11:00, task 11.1 (PR-F), rollout and recovery of the save receipt migration:** migration `0035` adds the receipt table and the per-scope pruning watermark. Every intake process checks the exact migration list at startup and quarantines a mismatch, so the API and the session worker must run the same build. To roll out:
  1. Drain and stop every intake process (the web entry point, the session worker and any runner), as for any intake deploy.
  2. Take a backup (`pnpm --filter @invimport/intake-server operations backup`).
  3. Run the reviewed migrations with the migration role (`pnpm db:intake migrate` locally), which also grants the API role its receipt privileges.
  4. Start every process on the new build only.

  If the rollout fails after step 3, recover forward (fix and redeploy the new build), or restore the step 2 backup and start the older build. The older build can't run against the migrated schema, and the migration is never edited or reversed in place.

## Open items

None yet.
