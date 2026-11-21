# Design assessment

## Context and grounding

`pnpm dev` (`tooling/dev.cjs`) reads settings through `developmentEnvironment` (`tooling/dev/environment.cjs`): an allowlisted env file merged under the inherited shell environment. It then resolves the target with the pure `developmentTarget` policy (`intake-server/src/dev/target.ts`, imported through Node's type stripping) and the processing profile with `developmentProfile` (`tooling/dev/profile.cjs`). Children receive internal variables the launcher builds itself: `setup.ts` and the API get `INTAKE_TARGET_PROFILE`, `INTAKE_READ_ORIGIN`, `INTAKE_CREDENTIAL_REF`; the API and worker get `INTAKE_PROCESSING_PROFILE`. `tooling/codex-login.cjs` repeats the target resolution to find the app's state root. `intake-server/src/dev/state.ts` and `setup.ts` call `developmentTarget` again with internal names when validating retained state.

The change is moderate: one new pure resolver in front of the existing policies, plus two launcher behaviours (read-only mock, `synthetic-session/1` worker). Runtime server code, retained state shapes and profile IDs do not change.

## Goals and constraints

- Proposal outcome: independent switches with self-explanatory names; mock precedence; the read-only switch; scripted sessions reachable in `pnpm dev`.
- Specs: `development-launcher` (new) and the modified `inventory-target-protection` `Target development profiles` requirement.
- Retained namespaces must keep resolving: the target kind, origin and credential reference that bind a namespace are unchanged, so an existing local or mock namespace is selected again after renaming the settings.
- Profile IDs, deployment variables and `dev:intake` stay as they are.

## Decisions and alternatives

### One pure resolver at the user boundary

A new `tooling/dev/settings.cjs` exports `resolveDevelopmentSettings(settings)`. It refuses retired names, parses switches, applies precedence and defaults, and returns:

```js
{
  targetSettings,  // internal names for developmentTarget(): INTAKE_TARGET_PROFILE, INTAKE_READ_ORIGIN, INTAKE_CREDENTIAL_REF, INTAKE_DEV_API_KEY
  readOnly,        // boolean
  profile,         // existing processing profile ID
  mockAgents,      // boolean; scripted agents receive no provider keys
  agentsInVm,      // boolean; also enables the credential-management proxy
  ignored,         // names overridden by a mock switch, for the startup line
}
```

The same module owns the decisions the launcher makes from that result: which settings the agent worker receives (`agentWorkerSettingNames`), whether the credential-management proxy is on (`personalManagementFlag`) and the startup summary, which is printed before setup so an overridden setting is visible even when startup later fails. `startsApplyRunner` in `tooling/dev/stack.cjs` decides whether the apply runner starts. All are pure and unit-tested.

`tooling/dev.cjs` and `tooling/codex-login.cjs` call it first and pass `targetSettings` (merged over the other settings, for admin URL and state paths) to the unchanged `developmentTarget`. `developmentProfile` is replaced by the resolver's profile selection; `processingWorker` stays in `profile.cjs` and gains `synthetic-session/1`.

Rejected: changing `developmentTarget` to read the new names directly. It is also the internal contract `setup.ts` and `state.ts` use with launcher-built values, so it would need both vocabularies. Keeping the user vocabulary in one translation layer leaves the internal contract and its tests intact.

Rejected: a config/validation package (see the proposal's reuse assessment). The rules are precedence and combinations over about ten strings.

### Retired names stay readable so they can be refused

The env-file allowlist keeps the retired names, so a stale `.env` reaches the resolver and is refused with replacements. Removing them from the allowlist would silently ignore them, and an old `INTAKE_TARGET_PROFILE=local-inventree` would quietly start the mock instead. `dev:intake` still accepts its server variables because it uses `apiEnvironment`, not the resolver.

The refusal is a `DevelopmentSettingsError` carrying a fixed code and a list of variable names; the launcher prints the code and, on following lines, each name with its replacement. Values are never printed.

### Read-only mock reuses the fake namespace

A read-only mock uses the same fake (`version: 1`) state and namespace as the writable mock, starts the fake inventory, omits `INTAKE_DEPLOYMENT_ID` from the API environment and does not start the apply runner. `review/authority.ts` already refuses preparation without a deployment ID, which is how local and external targets are read-only today. `apiTargetEnv` takes a `readOnly` flag for this.

Rejected: a separate read-only fake namespace. Toggling read-only would then hide the user's mock data, and nothing in retained state differs.

### Scripted sessions use the session worker

`synthetic-session/1` maps to the session worker (`session-worker-main.ts`), which already uses `syntheticSessionDriver` without a VM bridge and the bridge driver when `INTAKE_VM_PAIR` is set. With the VM switch the launcher forwards `INTAKE_VM_PAIR`/`INTAKE_VM_PORT` exactly as it does for `shared-vm-agent/*`.

### Credential reference derivation

When `INTAKE_CREDENTIAL_REF` is unset for an external URL, the resolver derives `inventree_<host>` with characters outside `[A-Za-z0-9_-]` replaced by `_`, truncated to the existing 128-character limit. The host is read with `URL`; an unparseable URL is passed through for `developmentTarget` to refuse with its existing code.

## State, authority and failure behavior

| Settings | Internal target | Apply | Workers |
|---|---|---|---|
| default / mock true | `fake` | runner + deployment ID | fake inventory, apply |
| mock + read-only true | `fake` | none | fake inventory |
| local true | `local-inventree` | none (`false` refused) | none |
| URL + token | `read-only` | none (`false` refused) | none |

All refusals happen before any service, database or lock is touched, and use fixed codes. The resolver refuses switch values, retired names and conflicts; `developmentTarget` and `developmentCredential` still refuse an incomplete or invalid external server, and `withTargetSettingNames` names the user-facing settings behind those codes. Authority is never widened: no path gives a local or external target an executor, and the read-only mock removes authority the fake had. The inventory-target-protection guarantees for `read-only` and `local-inventree` targets are unchanged because the internal values are identical.

## Verification strategy

- Unit (`tooling/tests/dev-settings.test.cjs`, new; `node --test`): profile table, defaults, precedence and `ignored`, read-only defaults and refusals, invalid booleans, retired names, derived credential reference, VM pairing.
- Unit updates: `dev-profile.test.cjs` (worker for `synthetic-session/1`), `dev-stack.test.cjs` (`apiTargetEnv` read-only), `codex-login.test.cjs` (new names select the same state roots).
- Process tier: update `intake-server/tests/process/serial/dev-environment.test.ts` to the new external settings, and add a check that a retired name is refused before setup. Run the PG/process tiers locally, since CI skips them.
- Manual: `pnpm dev` with defaults (scripted sessions), with a read-only mock (Apply unavailable), and with the local InvenTree; recorded in the PR description.

## Migration, rollout and recovery

No data migration. Developers rename their `.env` settings once, guided by the refusal message; `.env.intake.example` and `docs/development.md` show the new names. Rolling back the commit restores the old names; retained namespaces are unaffected either way.

## Risks and open decisions

- The default processing changes from `synthetic-research/2` to `synthetic-session/1`, which the user chose. Batches started under the old default keep their sealed profile; new work uses sessions. Mitigation: the startup line names the profile.
- `INTAKE_PERSONAL_MANAGEMENT` folds into the VM switch, so the proxy is always on with the VM. It is loopback-only and inert without the SSH tunnel.

No open decisions.
