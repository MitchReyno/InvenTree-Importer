# Implementation notes

Implementation of `simplify-vm-agent-web-and-setup` (BI-017) started with PR-A (tasks 1 and 2). PR-B to PR-E remain.

## Changes to the plan

None.

## Unexpected challenges

- **2026-11-19T14:41+11:00, task 1 (PR-A):** pnpm 12 refuses filtered task runs through a symlinked `node_modules` (`ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH`), so `pnpm lint` failed in a worktree linked to the main checkout's `node_modules`. The worktree uses its own `pnpm install --frozen-lockfile` instead.

## Decisions made during implementation

- **2026-11-19T14:41+11:00, task 4:** Mitch confirmed the plan's recommendation for retired attempts: a `shared-vm-agent/2` attempt that a `/3` worker finds fails with `agent_profile_retired`. Running `/2` attempts on the old tool surface was rejected.
- **2026-11-19T14:41+11:00, task 1 (PR-A):** The provider path skips a protected name that fails to resolve, instead of refusing the provider connection as the old tunnel did. Tailnet and other private names often don't resolve in the guest, and the spec keeps provider hosts reachable; public access still fails with `resolution_failed`. Keeping the old fail-closed provider behaviour was rejected because it would stop every session whenever one protected name is unresolvable.
- **2026-11-19T14:41+11:00, task 1 (PR-A):** The provider path keeps its IPv4-only lookup, which is unchanged behaviour. The public path resolves IPv4 and IPv6 and requires every answer to be public.
- **2026-11-19T15:00+11:00, task 2 (PR-A):** `turnPolicy()` opens public pages only for profiles in an allowlist, which is empty until task 4 adds `shared-vm-agent/3`, so a `/2` manifest carrying `web.public_pages` can't open them. Trusting the sealed field on any tool-worker profile was rejected because design D10 reserves web access for `/3`.
- **2026-11-19T15:00+11:00, task 2 (PR-A):** A policy that can't be written is a recorded `agent_turn_failed` before the provider starts (`native-outcome.ts`), rather than an exception outside the journal that left the slot waiting on worker removal.
- **2026-11-19T15:00+11:00, task 2 (PR-A):** The policy file limit is 16 KiB in both writer and reader, enough for 32 protected names of 253 bytes. The reader requires exactly the three keys, no duplicates and an integer version.

## Open items

None yet.
