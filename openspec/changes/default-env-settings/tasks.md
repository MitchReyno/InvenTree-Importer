# Implementation and delivery tasks

## Plan context

- Change: `default-env-settings`. [Proposal](proposal.md), [design](design.md), specs: [development-launcher](specs/development-launcher/spec.md) (modified) and [importer-configuration](specs/importer-configuration/spec.md) (new).
- Reuse decision: extend the launcher's settings resolver and the importer's environment loading; no new dependency.
- Linked BI items: None (developer-experience request, not indexed).

## Completion and commit ordering

Check an action only after it is done and verified, and stage the `tasks.md` update in the same commit as the work. Review, publication, CI and merge actions stay unchecked until they happen.

## Task map and dependencies

| Task | Type | Prerequisites | Acceptance |
|---|---|---|---|
| 0. Archive the launcher changes | lifecycle | developer's authorization | `development-launcher` in the main specs |
| 1. Launcher VM defaults and management by default | behavior | 0 for archiving only | development-launcher delta |
| 2. Importer default server and DigiKey locale | behavior | None | importer-configuration delta |
| 3. One template and the docs | docs and config | 1, 2 | proposal outcome: copy one file and run |
| 4. Qualification and delivery | lifecycle | 0–3 | review, CI and merge gates |

Tasks 1 and 2 are independent.

### PR delivery map

One PR carries tasks 1–4: the defaults, the template that documents them and the docs describe one configuration surface; splitting them would publish a template for defaults that do not exist yet. Task 0 is a separate archive PR (or the developer's own archive) that must merge first, because this change's MODIFIED delta needs `development-launcher` in the main specs.

- Branch `feat/default-env-settings`, base `interactive-app`.
- Subject `feat(default-env-settings): default the behavioural env settings and ship one template`.
- Gates: `pnpm lint && pnpm build && pnpm test`, `pnpm test:dev`, `pnpm lint:backend`, Prettier on changed files, manual qualification, independent exact-head review, green selected CI.

## 0. Archive the launcher changes

- PR delivery: its own archive PR, before the main PR.
- Outcome: `openspec/specs/development-launcher/spec.md` exists with the requirements of `split-dev-profile-settings` and `launch-vm-agents-with-dev`.
- Prerequisites: the developer's authorization to archive both changes. `split-dev-profile-settings` still has its delivery boxes (5.2–5.4) open although it merged in #202; they are ticked with that evidence first.
- Verification: `pnpm openspec:overlap --change <name>` clean for each before archiving; `openspec validate --strict` after.

- [ ] 0.1 Get the developer's authorization to archive both changes.
- [ ] 0.2 Tick `split-dev-profile-settings` 5.2–5.4 citing #202.
- [ ] 0.3 Run the overlap check and archive both changes; open and merge the archive PR.

## 1. Launcher VM defaults and management by default

- PR delivery: the main PR.
- Outcome: with real agents in the VM, `pnpm dev` needs no VM settings beyond the two switches; it refuses early without a pairing and marks defaults in its summary.
- Scope: `tooling/dev/settings.cjs`, `tooling/dev/vm.cjs`, `tooling/dev.cjs`, `tooling/dev/environment.cjs` (allowlist `INTAKE_VM_MANAGED`), `tooling/tests/dev-settings.test.cjs`, `tooling/tests/dev-vm.test.cjs`, `tooling/tests/dev-environment.test.cjs`. Design: "Launcher defaults in the resolver", "Management on by default", "The default guest directory is resolved inside the guest", "Pairing checked before the boot".
- Acceptance: every development-launcher scenario in this change.
- TDD: settings and VM-module tests first; they fail on the current opt-in and missing defaults.
- Risks: the renamed default instance; recorded in the design.

- [ ] 1.1 Baseline `pnpm test:dev`.
- [ ] 1.2 RED: settings tests for the defaults and their marks, explicit values winning, pairing under `INTAKE_DEV_STATE`, the worker environment carrying the resolved pairing and port in managed, unmanaged and scripted VM modes, management default on and opted out, `INTAKE_VM_MANAGED=true` refused with scripted agents, switch validation; VM-module tests for guest-directory resolution and its failure; a pairing-check test.
- [ ] 1.3 GREEN: implement the defaults, the switch, the summary marks, the pairing check and the guest-directory resolution; build the worker environment from resolved values; wire them in `dev.cjs`.
- [ ] 1.4 Refactor; run `pnpm format` and the readability checks.

## 2. Importer default server and DigiKey locale

- PR delivery: the main PR.
- Outcome: with no InvenTree settings and a local development InvenTree, importer commands use it and say so; DigiKey defaults to US, USD and English.
- Scope: `backend/src/invimport/env.py` (or a sibling module), the CLI entry in `backend/src/invimport/__main__.py` and `invimport/__init__.py`, `backend/src/invimport/inventree/api.py` (refusal text), `backend/src/invimport/digikey/api.py`, backend tests and their shared fixture, and a cross-language constants test in `tooling/tests/`. Design: "Importer fallback applied once at environment loading".
- Acceptance: every importer-configuration scenario.
- TDD: pytest cases first; they fail because nothing fills the environment and the locale defaults to AU.
- Risks: tests reaching the developer's real local instance; the autouse fixture prevents it.

- [ ] 2.1 Baseline `pnpm test:backend`.
- [ ] 2.2 Add the autouse fixture that points `INTAKE_DEV_STATE` at an empty temporary directory.
- [ ] 2.3 RED: tests for the default applied and announced without the token, explicit and partial settings untouched, each unsafe state case ignored, the refusal text, the endpoint check seeing the default, and the DigiKey defaults with explicit overrides.
- [ ] 2.4 GREEN: implement the state read, the one-time default and its announcement, the refusal text and the locale defaults.
- [ ] 2.5 Add the cross-language constants test (state directory rule, file name, server address).
- [ ] 2.6 Run `pnpm lint:backend` and the formatters.

## 3. One template and the docs

- PR delivery: the main PR.
- Outcome: `cp .env.example .env` is the only setup step for the app; the template documents every default.
- Scope: `.env.example` rewritten, `.env.intake.example` removed, `.gitignore`, `tooling/tests/dev-environment.test.cjs` template check, `README.md` (setup and VM walkthrough, `bench-agent` rename), `backend/README.md`, `docs/development.md`, `tooling/deployment/README.md` where it names the old template or opt-in.
- Verification: the template test; a fresh-clone check in a temporary clone; Markdown reference check of every changed claim against the code.

- [ ] 3.1 Write the single template and remove the old one; update `.gitignore` and the template test.
- [ ] 3.2 Update the READMEs and `docs/development.md`.
- [ ] 3.3 Check every changed claim against the code.

## 4. Qualification and delivery

- PR delivery: the main PR.
- Verification: a fresh-clone run (temporary clone, copied template, `pnpm dev` reaches ready with the mock inventory and scripted agents); the developer's own `.env` still starts real VM agents unchanged; a fresh `INTAKE_DEV_STATE` with real VM agents refuses with `vm_pairing_missing` before boot; an importer command with no settings uses the local InvenTree and names it.
- Local follow-up outside the repository, with the developer's agreement: add `DIGIKEY_LOCALE_SITE=AU` and `DIGIKEY_LOCALE_CURRENCY=AUD` to the developer's `.env`.

- [ ] 4.1 Run the manual qualification and record the outcomes for the PR.
- [ ] 4.2 Run the full gate.
- [ ] 4.3 Independent review rounds until one is clean, at the reviewed head.
- [ ] 4.4 Open the PR against `interactive-app` with the evidence.
- [ ] 4.5 Selected CI green.
- [ ] 4.6 Merge.
