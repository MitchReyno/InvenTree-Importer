# Change proposal

## Problem and intended outcome

Configuring `pnpm dev` takes two profile variables whose values pack several unrelated choices into one opaque string. `INTAKE_TARGET_PROFILE` picks the inventory and, implicitly, whether Apply works. `INTAKE_PROCESSING_PROFILE` picks whether agents are real or scripted, where they run, and a per-family version number whose meaning differs between families. A developer cannot tell from the variable names how to get "local InvenTree, real agents on the Mac", and some useful combinations (scripted sessions, scripted sessions through the VM, a read-only mock) are not reachable at all.

The outcome is a set of independent switches whose names say what they do, so the env file alone explains how the local app is configured:

```dotenv
INTAKE_USE_MOCK_INVENTREE=        # true = built-in mock; overrides the two below
INTAKE_USE_LOCAL_INVENTREE=false  # true = pnpm inventree:dev server
INTAKE_INVENTREE_URL=             # set = an external server
INTAKE_INVENTREE_TOKEN=           #   its API token
INTAKE_INVENTREE_READ_ONLY=       # true = never write, whichever server is selected

INTAKE_USE_MOCK_AI_AGENTS=true    # false = real Claude/Codex agents
INTAKE_USE_AGENT_SESSIONS=true    # false = one result per stage
INTAKE_RUN_AGENTS_IN_VM=false     # true = run them through the shared VM
INTAKE_VM_AGENT_TOOLS=true        # VM only: tool worker and web reader
```

The user decided the switch set, precedence and defaults in conversation on 2026-11-12, choosing the recommended option for each open question.

## Change identity and linked items

Change name: `split-dev-profile-settings`. Branch `refactor/split-dev-profile-settings`, subjects `refactor(split-dev-profile-settings): …`.

Linked BI items: None. This is developer-tooling ergonomics requested directly, not a tracked product item. It builds on BI-009 (`local-inventree-dev`, Done), whose `local-inventree` target it re-exposes under a new name.

## Current behavior and evidence

- `intake-server/src/dev/target.ts` resolves `INTAKE_TARGET_PROFILE` (`fake | local-inventree | read-only`), inferring `read-only` from `INTAKE_READ_ORIGIN`/`INTAKE_CREDENTIAL_REF`. Fake combined with external values is refused with `conflicting_development_target_settings`.
- `tooling/dev/profile.cjs` accepts five processing profiles for `pnpm dev`; the server (`intake-server/src/config.ts`) also accepts `restricted-research-stub/1` and `synthetic-session/1`, which `pnpm dev` refuses.
- `/1` and `/2` mean different things per family: `synthetic-research/2` is the per-stage pipeline while `synthetic-session/1` is sessions; `native-agent/1` is per-stage while `native-agent/2` is sessions; `shared-vm-agent/1` and `/2` are both sessions, `/2` adding the tool worker (`intake-server/src/agents/shared-vm/coordinator.ts`, `processing/model.ts` `stageOrderFor`).
- Apply exists only against the owned fake: `tooling/dev.cjs` starts the apply runner only for fake (`state.version === 1`) state, and `review/authority.ts` withholds apply authority without `INTAKE_DEPLOYMENT_ID`, which `tooling/dev/stack.cjs` passes only for fake state. The `inventory-target-protection` spec forbids an apply worker or executor for local and external targets.
- `INTAKE_PERSONAL_MANAGEMENT` reaches the UI only with a shared-VM profile (`tooling/dev.cjs`).
- Profile IDs are sealed into queued attempts and pinned by deployment config (`tooling/deployment/README.md`), so the IDs themselves must not change.

## Scope and non-goals

In scope:

- New `pnpm dev` and `pnpm codex:login` settings, translated by the launcher into the existing internal variables for child processes.
- Refusal, with the replacement names, of the old user-facing names in `pnpm dev` settings: `INTAKE_TARGET_PROFILE`, `INTAKE_PROCESSING_PROFILE`, `INTAKE_READ_ORIGIN`, `INTAKE_DEV_API_KEY`, `INTAKE_PERSONAL_MANAGEMENT`.
- A read-only mock (fake inventory without executor deployment or apply worker).
- `pnpm dev` support for `synthetic-session/1`, on the host and through the VM bridge.
- `INTAKE_CREDENTIAL_REF` becomes optional for an external server, derived from the URL host when unset.
- Docs, env template, settings-form hint and the affected specs.

Non-goals:

- Writes to a real (local or external) InvenTree. `INTAKE_INVENTREE_READ_ONLY=false` with a real server is refused with `inventree_writes_not_supported`.
- Profile ID renames, deployment/Compose configuration, and the server's own variable names (`dev:intake` keeps them as its explicit server configuration).
- Selecting the VM's `controlled-provider` runner image from an env var.
- `restricted-research-stub/1` in `pnpm dev`. Only a test fixture (`intake-server/tests/fixtures/research-processing-worker.ts`) runs it; the dev processing worker is fixed to `synthetic-research/2`. Supporting it needs a new development worker, which is separate work.
- Migrating anyone's `.env` automatically.

## Reuse and dependency assessment

No external dependency is relevant: this is a mapping from a handful of env strings to existing internal values. Node 24's built-in `util.parseEnv` already parses the file (`tooling/dev/environment.cjs`), and the existing pure policy modules (`target.ts`, `profile.cjs`) own validation. A config library such as `envalid` or `zod` would add a dependency to a zero-dependency launcher for roughly a dozen boolean and URL checks, and would not own the precedence and combination rules, which are the substance of the change. The recommended direction is to extend the existing launcher modules with a single pure settings resolver.

## Capabilities

### New capabilities

- `development-launcher`: how `pnpm dev` turns its user-facing settings into a processing profile, the switch defaults and combinations, and refusal of retired names.

### Modified capabilities

- `inventory-target-protection`: the `Target development profiles` requirement changes to the new inventory switches, mock precedence, the read-only switch and the read-only mock.

## Impact and dependencies

- Tooling: `tooling/dev.cjs`, `tooling/dev/profile.cjs`, `tooling/dev/environment.cjs`, `tooling/codex-login.cjs`, a new pure settings resolver, and their tests.
- Intake server: `intake-server/src/dev/target.ts` keeps its internal contract. One runtime fix: `header/binding.ts` now passes the target kind to connection status (see notes). The dev process tests change.
- Frontend: the `AgentSettingsForm` hint text that names the old variable.
- Docs: `.env.intake.example`, `docs/development.md`, `README.md`, `intake-server/scripts/native-session-qualification/README.md`, agent architecture notes and `intake-server/ARCHITECTURE.md` where they name the old dev variables.
- Developers with an existing `.env` must rename their settings; the launcher names the replacements.

## Open decisions and assumptions

None open. Assumptions recorded:

- Booleans accept `true`/`false`/`1`/`0`, case-insensitive; an empty value means unset. Anything else is refused naming the variable.
- The derived credential reference is `inventree_` plus the URL host with characters outside `[A-Za-z0-9_-]` replaced by `_`, so existing namespaces stay reachable by setting `INTAKE_CREDENTIAL_REF` explicitly.
