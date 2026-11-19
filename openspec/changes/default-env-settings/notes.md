# Implementation notes

Defaults for the behavioural env settings, VM management on by default, the importer's local-InvenTree fallback, US DigiKey defaults and one `.env.example`. Planned in #213 and delivered in #215. Still open: task 4.1.5, a full start of the developer's `.env` with real VM agents.

## Changes to the plan

None.

## Unexpected challenges

- **2026-11-18T20:25+10:00, task 2:** The autouse fixture first created its empty state directory inside each test's `tmp_path`, and 13 tests that assert exactly what their `tmp_path` contains failed. It now uses `tmp_path_factory`, outside `tmp_path`.
- **2026-11-18T20:25+10:00, task 2:** `import-run prepare` also checks that the API client points at the plan's target, so a CLI test with a stub client cannot prepare successfully against the local default; the announcement test asserts the server and token the importer connected with instead.
- **2026-11-19T01:30+11:00, task 4:** Running the default guest-directory lookup against the real VM failed with `defaultExec is not defined`: `resolveGuestDir` defaulted to a name `vm.cjs` no longer has, and every unit test injected its own `exec`. It now defaults to `runCommand`, and a regression test runs the lookup through a fake `limactl` on `PATH`.
- **2026-11-19T12:18+11:00, task 4:** Qualifying full `pnpm dev` starts was slowed by a heavily loaded machine (load averages 25–75, including a six-day-old orphaned `yes` process not from this work), which tripped the launcher's fixed 30-second startup limits, and then by the developer's own `pnpm dev` holding port 4330 and the VM. The fresh-clone start passed on `INTAKE_DEV_PORT=4341` with a private app state. The developer's `.env` was qualified by resolving it with this branch and running the new pairing check against its real pairing, which gave the same plan as before with nothing defaulted, because a second managed run would compete with the developer's running app for the VM.
- **2026-11-19T12:34+11:00, task 0:** The two launcher changes were archived in #211, outside this change, before #215 merged; `development-launcher` is now in the main specs and `pnpm openspec:overlap --change default-env-settings` reports no sync conflicts. Task 0 is ticked on that evidence.

## Decisions made during implementation

- **2026-11-18T20:10+10:00, task 1:** The startup summary lists defaults on one line, `Defaults used: NAME=value, …`, after the VM line, and only when something was defaulted; the guest directory shows as "bench-intake-guest in the guest home" because its path is known only after boot. Rejected: a "(default)" suffix on each value, which needs one line per setting.
- **2026-11-18T20:10+10:00, task 1:** Refusal lines gained an optional hint (`NAME: hint`) so `vm_pairing_missing` can point at the README step without inventing a "replacement" setting. `INTAKE_VM_NAME` with scripted agents is no longer refused: it is only a name now, and the removed opt-in requirement was the only reason to refuse it.

- **2026-11-18T20:25+10:00, task 2:** The DigiKey locale also treats an empty value as unset (`os.getenv(...) or "US"`), matching the InvenTree fallback, because a copied template line is empty. The one test that printed the old AUD default now expects USD. `TargetMismatch` names both endpoints; `ruff` and the token pattern are unchanged. `lib.cjs` now exports `TOKEN` for the cross-language contract test.
- **2026-11-19T11:56+11:00, tasks 2–3:** Review round 1 (GPT 6 Astra): the state check now requires an integer version 1 and a full ASCII token match (JSON `true` and `1.0` equal 1 in Python; `$` admits a trailing newline; `\\d` admits non-ASCII digits); the CLI tests register the InvenTree variables so the fallback's values are undone; the defaults line is printed for unmanaged VM modes too; the template shows each switch's real default; the README copies with `cp -n` and moves the hand-run relays and forwards into a section for `INTAKE_VM_MANAGED=false`, where they cannot hold the managed tunnel's ports.
- **2026-11-19T12:01+11:00, tasks 2–3:** Review round 2: an integer past Python's 4300-digit limit raised a plain `ValueError` that escaped the state read; it now catches `ValueError`, which also covers bad text and JSON. The template gained the remaining documented settings (`INTAKE_DEV_STATE`, Tailscale, admin URL, decoder image, provider executables). Checking those showed `INTAKE_DEV_PORT`, `INTAKE_DEV_TAILSCALE` and `INTAKE_DEV_TAILSCALE_PORT` refused an empty value although the template says empty counts as unset; they now treat empty as unset.
- **2026-11-19T12:09+11:00, task 3:** Review round 3: an empty `INTAKE_APP_STATE` or `INTAKE_DEV_STATE` resolved to the current directory, so `pnpm dev` from the repository root refused with `development_state_must_be_outside_repository`. `pg-identity.ts`, `target.ts`, `codex-login.cjs` and `local_dev.py` now treat empty as unset, with tests on each side. The template shows the Tailscale port's real default (443).
- **2026-11-19T12:18+11:00, task 2:** Review round 5 asked for the not-configured guidance through an ordinary connecting command as well as `import-run prepare`; a CLI test now runs `categories` with no server and asserts both hints and no SDK client.

## Open items

- Task 4.1.5: a full start of the developer's `.env` with real VM agents on this branch, once the developer's own running app releases the VM and the credential-tunnel ports. Its settings resolution and pairing check (4.1.4) already pass.

- Tooling `.cjs` files are not linted for undefined names (`no-undef`), which let the missing default above pass ESLint; worth a separate lint change.
