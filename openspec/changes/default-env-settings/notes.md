# Implementation notes

Defaults for the behavioural env settings, VM management on by default, the importer's local-InvenTree fallback, US DigiKey defaults and one `.env.example`. Delivered in one PR; in progress.

## Changes to the plan

None.

## Unexpected challenges

None.

## Decisions made during implementation

- **2026-11-18T20:10+10:00, task 1:** The startup summary lists defaults on one line, `Defaults used: NAME=value, …`, after the VM line, and only when something was defaulted; the guest directory shows as "bench-intake-guest in the guest home" because its path is known only after boot. Rejected: a "(default)" suffix on each value, which needs one line per setting.
- **2026-11-18T20:10+10:00, task 1:** Refusal lines gained an optional hint (`NAME: hint`) so `vm_pairing_missing` can point at the README step without inventing a "replacement" setting. `INTAKE_VM_NAME` with scripted agents is no longer refused: it is only a name now, and the removed opt-in requirement was the only reason to refuse it.

## Open items

- Task 0 (archiving `split-dev-profile-settings` and `launch-vm-agents-with-dev`) waits for the developer's authorization. Tasks 1–4 do not depend on it; this change's own archive does.
