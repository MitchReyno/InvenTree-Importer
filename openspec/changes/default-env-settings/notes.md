# Implementation notes

Defaults for the behavioural env settings, VM management on by default, the importer's local-InvenTree fallback, US DigiKey defaults and one `.env.example`. Delivered in one PR; in progress.

## Changes to the plan

None.

## Unexpected challenges

- **2026-11-18T20:25+10:00, task 2:** The autouse fixture first created its empty state directory inside each test's `tmp_path`, and 13 tests that assert exactly what their `tmp_path` contains failed. It now uses `tmp_path_factory`, outside `tmp_path`.
- **2026-11-18T20:25+10:00, task 2:** `import-run prepare` also checks that the API client points at the plan's target, so a CLI test with a stub client cannot prepare successfully against the local default; the announcement test asserts the server and token the importer connected with instead.

## Decisions made during implementation

- **2026-11-18T20:10+10:00, task 1:** The startup summary lists defaults on one line, `Defaults used: NAME=value, …`, after the VM line, and only when something was defaulted; the guest directory shows as "bench-intake-guest in the guest home" because its path is known only after boot. Rejected: a "(default)" suffix on each value, which needs one line per setting.
- **2026-11-18T20:10+10:00, task 1:** Refusal lines gained an optional hint (`NAME: hint`) so `vm_pairing_missing` can point at the README step without inventing a "replacement" setting. `INTAKE_VM_NAME` with scripted agents is no longer refused: it is only a name now, and the removed opt-in requirement was the only reason to refuse it.

- **2026-11-18T20:25+10:00, task 2:** The DigiKey locale also treats an empty value as unset (`os.getenv(...) or "US"`), matching the InvenTree fallback, because a copied template line is empty. The one test that printed the old AUD default now expects USD. `TargetMismatch` names both endpoints; `ruff` and the token pattern are unchanged. `lib.cjs` now exports `TOKEN` for the cross-language contract test.

## Open items

- Task 0 (archiving `split-dev-profile-settings` and `launch-vm-agents-with-dev`) waits for the developer's authorization. Tasks 1–4 do not depend on it; this change's own archive does.
