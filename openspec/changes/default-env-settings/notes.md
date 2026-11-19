# Implementation notes

Defaults for the behavioural env settings, VM management on by default, the importer's local-InvenTree fallback, US DigiKey defaults and one `.env.example`. Delivered in one PR; in progress.

## Changes to the plan

None.

## Unexpected challenges

- **2026-11-18T20:25+10:00, task 2:** The autouse fixture first created its empty state directory inside each test's `tmp_path`, and 13 tests that assert exactly what their `tmp_path` contains failed. It now uses `tmp_path_factory`, outside `tmp_path`.
- **2026-11-18T20:25+10:00, task 2:** `import-run prepare` also checks that the API client points at the plan's target, so a CLI test with a stub client cannot prepare successfully against the local default; the announcement test asserts the server and token the importer connected with instead.
- **2026-11-19T01:30+11:00, task 4:** Running the default guest-directory lookup against the real VM failed with `defaultExec is not defined`: `resolveGuestDir` defaulted to a name `vm.cjs` no longer has, and every unit test injected its own `exec`. It now defaults to `runCommand`, and a regression test runs the lookup through a fake `limactl` on `PATH`.

## Decisions made during implementation

- **2026-11-18T20:10+10:00, task 1:** The startup summary lists defaults on one line, `Defaults used: NAME=value, …`, after the VM line, and only when something was defaulted; the guest directory shows as "bench-intake-guest in the guest home" because its path is known only after boot. Rejected: a "(default)" suffix on each value, which needs one line per setting.
- **2026-11-18T20:10+10:00, task 1:** Refusal lines gained an optional hint (`NAME: hint`) so `vm_pairing_missing` can point at the README step without inventing a "replacement" setting. `INTAKE_VM_NAME` with scripted agents is no longer refused: it is only a name now, and the removed opt-in requirement was the only reason to refuse it.

- **2026-11-18T20:25+10:00, task 2:** The DigiKey locale also treats an empty value as unset (`os.getenv(...) or "US"`), matching the InvenTree fallback, because a copied template line is empty. The one test that printed the old AUD default now expects USD. `TargetMismatch` names both endpoints; `ruff` and the token pattern are unchanged. `lib.cjs` now exports `TOKEN` for the cross-language contract test.
- **2026-11-19T11:56+11:00, tasks 2–3:** Review round 1 (GPT 6 Astra): the state check now requires an integer version 1 and a full ASCII token match (JSON `true` and `1.0` equal 1 in Python; `$` admits a trailing newline; `\\d` admits non-ASCII digits); the CLI tests register the InvenTree variables so the fallback's values are undone; the defaults line is printed for unmanaged VM modes too; the template shows each switch's real default; the README copies with `cp -n` and moves the hand-run relays and forwards into a section for `INTAKE_VM_MANAGED=false`, where they cannot hold the managed tunnel's ports.
- **2026-11-19T12:01+11:00, tasks 2–3:** Review round 2: an integer past Python's 4300-digit limit raised a plain `ValueError` that escaped the state read; it now catches `ValueError`, which also covers bad text and JSON. The template gained the remaining documented settings (`INTAKE_DEV_STATE`, Tailscale, admin URL, decoder image, provider executables). Checking those showed `INTAKE_DEV_PORT`, `INTAKE_DEV_TAILSCALE` and `INTAKE_DEV_TAILSCALE_PORT` refused an empty value although the template says empty counts as unset; they now treat empty as unset.

## Open items

- Task 0 (archiving `split-dev-profile-settings` and `launch-vm-agents-with-dev`) waits for the developer's authorization. Tasks 1–4 do not depend on it; this change's own archive does.
- Tooling `.cjs` files are not linted for undefined names (`no-undef`), which let the missing default above pass ESLint; worth a separate lint change.
