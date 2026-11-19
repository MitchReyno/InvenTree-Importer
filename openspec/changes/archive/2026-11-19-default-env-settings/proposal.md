# Change proposal

## Problem and intended outcome

A fresh clone should run after copying one example env file, with only real credentials left to fill in. Today:

- There are two templates, `.env.example` (importer) and `.env.intake.example` (app), and the README asks you to merge one into the other.
- Real agents in the shared VM need five settings with no defaults: `INTAKE_VM_PAIR`, `INTAKE_VM_PORT`, and, for `pnpm dev` to run the VM, `INTAKE_VM_NAME`, `INTAKE_VM_GUEST_DIR` and `INTAKE_VM_RUNNER_IMAGE`. The README's setup walkthrough already uses fixed values for all five.
- The importer (`invimport`) needs `INVENTREE_URL` and a token even when the only server is the local development InvenTree, whose writer token `pnpm inventree:dev` already keeps.
- The DigiKey locale disagrees: the code defaults to AU/AUD, the template shows US/USD.

Requested outcome, with the developer's decisions of 2026-11-14:

- One `.env.example`. Behavioural settings are commented out with their defaults; only credentials are left to fill in.
- Defaults for the VM settings, matching the README walkthrough, and `pnpm dev` runs the VM whenever real agents run in it, unless `INTAKE_VM_MANAGED=false`.
- With no InvenTree server configured, the importer uses the local development InvenTree when it exists, and says so.
- DigiKey defaults to the US site, USD and English, in the code and the template. The developer's own `.env` keeps AU/AUD explicitly.

## Change identity and linked items

Change name: `default-env-settings`. Branch `feat/default-env-settings`; subjects `type(default-env-settings): …`.

Linked BI items: none. A developer-experience request, not an indexed item.

## Current behavior and evidence

- `tooling/dev/settings.cjs` already defaults every switch and `INTAKE_DEV_PORT` (4330); `INTAKE_RUN_AGENTS_IN_VM=true` refuses with `vm_pairing_required` without `INTAKE_VM_PAIR` and `INTAKE_VM_PORT`.
- Since #208, `pnpm dev` manages the VM only when `INTAKE_VM_NAME` is set, and then requires `INTAKE_VM_GUEST_DIR` (absolute) and `INTAKE_VM_RUNNER_IMAGE`.
- `README.md` "VM agent runner" uses `vm=bench-agent-m1`, `INTAKE_VM_PAIR=$HOME/.local/state/bench-intake/vm-pair`, a guest directory of `$HOME/bench-intake-guest` inside the guest, `INTAKE_RUNNER_IMAGE=bench-intake-runner:personal` and port 14313.
- `tooling/inventree-dev/lib.cjs` keeps its state in `inventree-dev.json` under the development state directory (`INTAKE_DEV_STATE`, else `~/.local/state/bench-intake`, per `intake-server/src/dev/pg-identity.ts`), including reader and writer tokens; the instance is always at `http://127.0.0.1:4320`. `pnpm inventree:dev env` prints the writer token as export lines.
- `backend/src/invimport/inventree/api.py` `connect()` refuses without `INVENTREE_URL`; `commands/import_run.py` also reads `INVENTREE_URL` to check the approved plan's endpoint (durable-import-execution, "Target drift").
- `backend/src/invimport/digikey/api.py` defaults the locale to `AU`, `AUD`, `en`; `.env.example` sets `US` and `USD`.
- With no `.env` at all, `pnpm dev` already runs (mock inventory, scripted agents).

## Scope and non-goals

In scope:

- One root `.env.example` replacing both templates, with every documented setting, defaults shown and commented out; `.gitignore`, README, backend README, `docs/development.md` and the template test updated.
- Launcher defaults for `INTAKE_VM_PORT`, `INTAKE_VM_PAIR`, `INTAKE_VM_NAME`, `INTAKE_VM_GUEST_DIR` (resolved inside the guest at launch) and `INTAKE_VM_RUNNER_IMAGE`; VM management on by default for real VM agents with an `INTAKE_VM_MANAGED` switch; an early refusal when the pairing directory is missing; the startup summary marks defaulted values.
- Importer fallback to the local development InvenTree when no server is configured, applied once so every reader agrees.
- DigiKey locale defaults US, USD, en.

Non-goals:

- Creating, pairing or provisioning the VM, or building images: still the README's one-off steps.
- Defaults for credentials (external InvenTree token, DigiKey client ID and secret, provider sign-in).
- Packaged deployments, which have their own runtime settings.
- Migrating the developer's existing `.env`; explicit values keep working. Adding `DIGIKEY_LOCALE_SITE=AU` and `DIGIKEY_LOCALE_CURRENCY=AUD` to it is a local step outside the repository.

Compatibility: every explicit value keeps its meaning. Two behaviours change for unset settings: real agents in the VM now start the VM side by default, and an importer run with no server configured uses the local development InvenTree instead of refusing. `INTAKE_VM_NAME` is no longer the opt-in; it only names the instance.

## Reuse and dependency assessment

No external package is relevant. The launcher already resolves and validates settings in one pure module (`tooling/dev/settings.cjs`) and the importer already loads `.env` in one place (`backend/src/invimport/env.py`, python-dotenv). Both are extended.

| Option | Fit | Limitations | Evidence (checked 2026-11-14) |
| --- | --- | --- | --- |
| Extend `settings.cjs` defaults and `env.py` loading | Defaults live where settings are already validated; refusals stay value-free | Two languages read the local InvenTree state; the design keeps that to one small, validated read | `tooling/dev/settings.cjs`, `backend/src/invimport/env.py` |
| Ship a fuller `.env` template and leave code unchanged | No code change | Values copied into every `.env` drift from the code (the DigiKey mismatch is this failure); does not remove the opt-in | `.env.example` vs `digikey/api.py` |
| A setup command that writes `.env` | Interactive guidance | More to maintain; still needs code defaults to stay correct | — |

Recommendation: defaults in code, a template that documents them, and nothing copied that the code already knows.

## Capabilities

### New capabilities

- `importer-configuration`: how the importer finds its InvenTree server and credentials when none are configured, and its DigiKey locale defaults.

### Modified capabilities

- `development-launcher`: VM settings get defaults, VM management becomes the default for real VM agents, and a missing pairing directory is refused early. This capability exists only in the merged but unarchived changes `split-dev-profile-settings` and `launch-vm-agents-with-dev`; they must be archived first so its requirements are in the main specs (see open decisions).

## Impact and dependencies

- Tooling: `tooling/dev/settings.cjs`, `tooling/dev/vm.cjs`, `tooling/dev.cjs`, `tooling/dev/environment.cjs`, tests in `tooling/tests/`.
- Backend: `backend/src/invimport/env.py` (or a sibling module), `inventree/api.py` messages, `digikey/api.py` defaults, tests.
- Templates and docs: `.env.example`, `.env.intake.example` (removed), `.gitignore`, `README.md`, `backend/README.md`, `docs/development.md`, `tooling/deployment/README.md`.
- No application, contract or database change.

## Open decisions and assumptions

- **Prerequisite needing the developer's authorization:** archive `split-dev-profile-settings` (merged in #202; only its delivery boxes are open) and `launch-vm-agents-with-dev` (merged in #208, closed in #209), so `development-launcher` is in the main specs before this change's MODIFIED delta.
- Assumption: the default instance name is `bench-agent`, and the README walkthrough is renamed from `bench-agent-m1` to match. Machines using another name set `INTAKE_VM_NAME`.
- Assumption: the importer uses the local instance's writer token, as `pnpm inventree:dev env` does today.
- Assumption: the default pairing directory follows the development state directory (`<state>/vm-pair`), which is the README's path when `INTAKE_DEV_STATE` is unset.
