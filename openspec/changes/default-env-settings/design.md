# Design assessment

## Context and grounding

Two existing settings boundaries are extended; no new dependency, contract or persistent state.

- **Launcher:** `tooling/dev/settings.cjs` resolves every `pnpm dev` setting before any effect and refuses with value-free codes. Since #208 it builds a VM plan only when `INTAKE_VM_NAME` is set; `tooling/dev/vm.cjs` boots the VM, launches the tunnel and relays, and stops a VM the run booted. `startupSummary` prints what will run.
- **Importer:** `backend/src/invimport/env.py` loads the root `.env` into `os.environ` without overwriting the real environment. `inventree/api.py` `connect()` and `commands/import_run.py` (the approved-plan endpoint check) both read `INVENTREE_URL` from the environment.
- **Local InvenTree:** `tooling/inventree-dev/lib.cjs` keeps `inventree-dev.json` (version 1, reader and writer tokens) as a private file in the development state directory (`INTAKE_DEV_STATE`, else `~/.local/state/bench-intake`); the server is always `http://127.0.0.1:4320`.

Complexity: moderate. The defaults are simple; the care is in keeping refusals early, keeping every importer reader on the same server, and reading another tool's private state safely.

## Goals and constraints

The proposal's outcome and the deltas in `specs/development-launcher/spec.md` and `specs/importer-configuration/spec.md`. Constraints:

- Explicit values always win; an existing `.env` keeps working.
- Refusals still happen before any effect and never print values.
- The importer never prints a token, and the target-drift check keeps protecting plans bound to another server.

## Decisions and alternatives

### Launcher defaults in the resolver, marked for the summary

`resolveDevelopmentSettings` gains an input for the development state directory (computed in `dev.cjs` from `INTAKE_DEV_STATE` or the home directory, so the resolver stays pure) and fills in the VM defaults. The plan records which names were defaulted, and `startupSummary` prints them, for example `VM: bench-agent (default), image bench-intake-runner:personal (default)`.

Rejected: defaults spread across `dev.cjs` and `vm.cjs`. The summary and the refusals would no longer see the same values.

### Management on by default, `INTAKE_VM_MANAGED` to opt out

The plan exists whenever real agents run in the VM, unless `INTAKE_VM_MANAGED` is false. `INTAKE_VM_NAME` becomes an ordinary setting with a default. `INTAKE_VM_MANAGED=true` with scripted agents is refused, as `INTAKE_VM_NAME` with scripted agents is today; scripted agents in the VM keep their manual relays.

Rejected: keeping the opt-in by name. A fresh clone could not reach real VM agents without the manual relay steps, which the developer explicitly wants gone.

### The default guest directory is resolved inside the guest

The README pairs into `$HOME/bench-intake-guest` inside the guest, and the relay needs an absolute path. An explicit `INTAKE_VM_GUEST_DIR` stays absolute and validated as today. When it is defaulted, `vm.cjs` asks the booted guest for its home directory (`limactl shell NAME sh -c 'printf %s "$HOME"'`) after `ensureVmRunning`, appends `bench-intake-guest`, and validates the result with the same form before starting the relays. A failure there is `vm_guest_dir_unavailable` and goes through the normal shutdown, stopping a VM this run booted.

Rejected: a fixed absolute default such as `/var/tmp/bench-intake-guest`. It would not match the README walkthrough, so a fresh clone following the README would not work with the defaults.

### Pairing checked before the boot

`dev.cjs` checks, after settings and before `ensureVmRunning`, that the pairing directory holds `ca.pem`, `cert.pem` and `key.pem` as regular files. Missing files refuse with `vm_pairing_missing` and the README step, so a fresh clone gets the answer without waiting for a boot.

### Importer fallback applied once at environment loading

A new function next to `load_env_file` (`apply_local_inventree_default`) runs once in the CLI entry, after the `.env` is loaded and before any command. When none of the four InvenTree settings is present it reads the local state and sets `INVENTREE_URL` and `INVENTREE_TOKEN` in `os.environ`, then prints `Using the local development InvenTree at http://127.0.0.1:4320 (no InvenTree server configured).` to standard error. Because it fills the environment, `connect()` and the approved-plan endpoint check see the same server without further changes.

The read mirrors the Node side's private-file rules: a regular file, not a symbolic link, owned by the current user, no group or other permissions, at most 16 KiB, JSON with `version` 1 and a writer token matching the token form. Anything else is treated as no local instance.

Rejected:

- Calling `pnpm inventree:dev env` from Python. It would make every importer command depend on Node and pnpm and add a subprocess; the state read is small.
- Filling only `connect()`. The endpoint check in `import_run.py` would then compare a plan with an empty URL.

The state directory rule, file name and server address are then known to both languages. A test in `tooling/tests/` loads `lib.cjs` and `pg-identity.ts`'s rule and checks them against the Python constants, so they cannot drift silently.

### One template

`.env.example` is rewritten in sections (local app, inventory target, agents, VM, importer, DigiKey). Behavioural settings are commented out showing their defaults; credentials are present with empty values; the existing warning about trailing comments on empty values stays. `.env.intake.example` is removed, and `.gitignore`, the template test, the READMEs and `docs/development.md` follow.

## State, authority and failure behavior

| Step | Failure | Outcome |
| --- | --- | --- |
| Resolving launcher settings | malformed explicit or defaulted value; `INTAKE_VM_MANAGED=true` without real VM agents | value-free refusal before any effect |
| Pairing check | files missing | `vm_pairing_missing` before boot |
| Guest directory lookup | `limactl shell` fails or returns an unusable path | `vm_guest_dir_unavailable`; shutdown stops a VM this run booted |
| Importer default | no valid local state | refusal naming `INVENTREE_URL` and `pnpm inventree:dev up` |
| Importer with a remote-bound plan and no settings | endpoint mismatch | existing target-drift stop, before connecting |

Authority: the importer gains write access to the local development InvenTree by default, which is a development instance owned by the same user. No external server is ever chosen without an explicit `INVENTREE_URL`.

## Verification strategy

- **Launcher (unit):** defaults and their summary marks; explicit values win; pairing follows `INTAKE_DEV_STATE`; management default on, off with the switch, refused for scripted agents; switch validation; guest-directory resolution with a fake `exec`.
- **Launcher (manual, recorded on the PR):** with the developer's explicit settings, unchanged behaviour; with a fresh `INTAKE_DEV_STATE`, `vm_pairing_missing` before boot; a defaulted guest directory resolved against the real VM.
- **Importer (pytest):** an autouse fixture points `INTAKE_DEV_STATE` at an empty temporary directory for every test, so no test reaches the developer's real local InvenTree; then: default applied and announced without the token; explicit and partial settings untouched; each unsafe-state case ignored; the endpoint check sees the default; DigiKey defaults and explicit overrides.
- **Contract:** the cross-language constants test.
- **Template:** the template test, a fresh-clone check (copy `.env.example` into a temporary clone and run the settings resolver and the importer's environment step), and Markdown reference checks.
- **Gate:** `pnpm lint && pnpm build && pnpm test`, `pnpm test:dev`, Prettier on changed files, `pnpm lint:backend`.

## Migration, rollout and recovery

No data migration. After merging, the developer's `.env` keeps working; two local follow-ups outside the repository: add `DIGIKEY_LOCALE_SITE=AU` and `DIGIKEY_LOCALE_CURRENCY=AUD` to keep the Australian locale, and optionally delete lines that now match defaults. Rollback is a revert.

## Risks and open decisions

- **Surprise writes to the local instance:** an importer command run without settings now writes to the local development InvenTree instead of refusing. Mitigated by the announcement line and by the instance being the developer's own.
- **Renamed default instance:** machines following the old README (`bench-agent-m1`) set `INTAKE_VM_NAME` or rename the instance; the README says so.
- **Prerequisite:** `split-dev-profile-settings` and `launch-vm-agents-with-dev` must be archived before this change can be archived; that needs the developer's authorization.
