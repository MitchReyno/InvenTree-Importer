# Design assessment

## Context and grounding

The change spans all three packages but adds no new architecture. Each part extends an existing pattern, and the complexity is moderate, mostly breadth:

- **Agent settings** are one revisioned row per actor, target and context. They are served by `GET`/`PUT /api/v1/agent-settings` (`intake-server/src/agents/settings.ts`, `agents/routes.ts:30`) and sealed into each attempt at queue time (`processing/session-attempts.ts:59-64`).
- **New-batch state** is created in one transaction in `capture/repository.ts` `create()` (around line 1220).
- **Per-batch defaults** live in append-only tables:
  - location in `capture_selection`, migration 0002;
  - supplier and tags in `capture_settings_intent`, migration 0014;
  - instructions in `capture_instruction`, migration 0008, delivered by `agents/instructions.ts`.
- **The connection observation** is cached for 30 s with a 3 s deadline (`header/connection.ts:8-10`) and read through `GET /api/v1/connection-status`.
- **Device-local preference:** the theme controller, `frontend/src/theme/theme.ts`, is the only one, using `localStorage` and `useSyncExternalStore`.
- **Frontend building blocks:**
  - `Popover` wraps Radix (`components/ui/Popover.tsx`);
  - `SettingsNav` renders a flat list;
  - Settings routes are `settings/<section>` (`navigation/app-route.ts:4`);
  - the location and supplier pickers use the batch-scoped `useCatalogue(ports.catalogue, batchId, kind)` (`capture/BatchSettingsPanel.tsx:116`).

## Goals and constraints

- **Proposal:** [proposal.md](proposal.md).
- **Requirements:** delta specs for `debug-mode`, `app-settings`, `provider-runtime`, `capture-batch-settings`, `header-connection-status`, `processing-agent-sessions`, `ui-design-system` and `access-identity`.
- **Constraints:**
  - Keep sealed attempts and the import reference unchanged.
  - Keep settings writes revision-checked.
  - Never expose credentials.
  - Leave digest-verified profile instruction bytes untouched.
  - Follow the frontend Effects rules: preferences through `useSyncExternalStore`, actions in handlers.
- **Design:** canvas v67, D32 to D35.

## Decisions and alternatives

### Extend `agent_settings` for agent rows; a separate `batch_defaults` row

**New `agent_provider_settings` table.** One row per provider under the `agent_settings` key, with these columns:

| Column | Type |
| --- | --- |
| `provider` | `claude` or `codex` |
| `enabled` | boolean |
| `authentication` | text |
| `default_model` | text |

It has no revision of its own: it is written in the same transaction as its parent row and covered by the parent's `revision`.

**`agent_settings` columns.** The single `provider`, `authentication` and `model` columns are replaced by the per-provider rows. These columns are added:

| Column | Type and default |
| --- | --- |
| `default_provider` | text |
| `stage_selections` | `jsonb`, default `{}`; keys `examine`, `research`, `images` and `inventory`; each value `{provider, model}` or absent for Default |
| `new_batch_instructions` | `text` |
| `part_description_style` | `text` |
| `auto_tags_default` | `boolean`, default `false` |

**Contract.** `AgentSettings` and `AgentSettingsUpdate` carry:

- `providers: {claude, codex}`, each `{enabled, authentication, default_model}`;
- `default_provider`;
- `stage_selections`;
- `session_concurrency` and the new text and boolean fields.

`selection` is removed, and every reader is updated in the same PR.

**Saving.** One revision covers every agent subsection. Each subsection's Save sends the whole loaded settings object with only its fields changed, exactly as the form does today.

**New `batch_defaults` table.** It has the same key, a `revision`, `location_pk` and `supplier_pk`. It is served by `GET`/`PUT /api/v1/batch-defaults` with the same revision conflict (412).

**Rejected:**

- One generic key/value `app_settings` table. It loses typed columns and grants, and gives no gain for two rows.
- Putting batch defaults into `agent_settings`. They aren't agent behaviour, so they would share a revision with unrelated Agent saves and make Batch defaults conflicts noisier.

**Accepted:** two Saves on two pages can't conflict with each other, which is correct.

### Independent providers, resolved and sealed per step at queue time

A pure `resolveSelection(settings, stage)` returns the existing `AgentSelection` shape (`{provider, authentication, model}`):

- **Step choice:** when the step has a selection whose provider is on, use that provider's authentication and the step's model.
- **Otherwise:** the default provider's authentication and default model.
- **Nothing usable:** when the default provider is off or missing, it returns none, and queuing fails with `agent_default_required` as today.

`session-attempts.ts` seals that selection, so the manifest shape, the worker and the provider adapters are unchanged. The lead Examine attempt uses the `examine` key.

**Validation on save.** A save fails with `invalid_agent_settings` (422) when:

- no provider is on;
- the default provider is off;
- a default model or step model isn't in that provider's model list (the list the form uses, `contracts/src/agent-selection.ts`);
- a step names a provider that is off.

**Migration.** The existing `provider`, `authentication` and `model` become one enabled provider row and `default_provider`. The other provider gets a disabled row with its first listed model and subscription sign-in. Every step starts on Default, and the revision is unchanged.

**Slots and pausing.** Sessions at once stays one shared limit (`agents/session/slots.ts`), and Pause all is unchanged.

**Rejected:**

- **Keep one provider and add per-step providers that must share its sign-in.** That doesn't let Claude and Codex each keep their own sign-in method.
- **Per-provider session limits.** Not requested, and they would change the slot scheduler.
- **Resolve at run time.** That breaks "sealed at queue time".

**Accepted:** Codex steps carry BI-010's `native_unverified` label. Settings doesn't hide Codex because of it.

### Snapshot defaults into a batch at creation

`create()` reads `agent_settings` and `batch_defaults` inside its transaction, then inserts:

- the first `capture_selection` default location, when set;
- a `capture_settings_intent` revision with the supplier and `shared_tags.auto`;
- a version-1 whole-batch `capture_instruction` with the creating actor.

A missing location or company is detected with the existing catalogue reader before the transaction. It is recorded as a batch note code that Capture renders, and that value is skipped.

Rejected: live inheritance from the app-level values. It would silently change existing batches and their review freshness.

### Deliver the Part description style as operator guidance

At queue time the attempt seals `settings_revision`. When the session starts, the runner appends the style text as an operator-guidance block in the first delivered instruction message. This is the same path `instructNewSession` uses, not the fixed system prompt, so `instructionBytes/Digest` stay as they are.

Lot sessions (Research, Images, Inventory) and the lead Examine session all receive it, because any of them may propose `catalogue.description`. The existing one-line, 250-character validation is unchanged.

Rejected: editing the profile instruction string. It would change the verified digest per save and break qualification evidence.

### Forced connection check

The new route is `POST /api/v1/connection-status/check`, CSRF-protected like other commands. It shares the observation cache in `header/connection.ts`:

- An in-flight probe is reused.
- A probe younger than 5 s (`MIN_FORCED_CHECK_INTERVAL_MS`) returns the cached observation.
- Otherwise it probes with the existing deadline.

A 401 or 403 from the target maps to a new `unauthorized` failure code. Other failures keep their codes. The result replaces the cached observation, so the masthead read sees it.

Rejected: a query flag on the GET. It would let a cache refetch force probes, and it breaks GET safety.

### Replace the read token with a stored, swappable credential

**Where it lives.** The token is kept in a server-owned file under `INTAKE_SECRETS_DIR`. The development launcher defaults that to a `secrets/` directory in the development state directory, created owner-only.

**Routes.**

- `PUT /api/v1/inventory-credential` takes `{token}`. It is CSRF-protected, limited to 4 KiB of printable ASCII, and never logged; request logging redacts its body.
- `DELETE /api/v1/inventory-credential` reverts to the environment token.
- The Settings row reads its state from connection status as `credential_source: 'environment' | 'saved'` plus `saved_at`. The token itself is never returned.

**Check, then save.** On `PUT` the server:

1. probes the target with the candidate, using the existing bounded read transport and deadline;
2. on acceptance, writes a temporary file with mode `0600` and renames it over the saved one;
3. swaps the credential in a `CredentialHolder` that the read transport reads on each request.

Reads already in flight finish with the old value. A refused or failed probe writes nothing. Startup loads a saved file when one exists, and otherwise uses `INTAKE_DEV_API_KEY`.

**Untouched.** Bootstrap's `configured` status, the approval runner and its credential profile.

**Rejected:**

- **Storing the token in Postgres.** Database backups and dumps would then carry it.
- **An encryption library or OS keychain.** It adds a dependency and doesn't protect against the same local user who can already read `.env`.
- **Restarting the server to apply it.** That breaks live sessions and the open UI.

### Debug mode as a device-local controller plus two components

`frontend/src/debug/debug-mode.ts` copies the theme controller:

- key `bench-intake.debug`;
- try/catch read and write;
- an in-memory fallback;
- `useDebugMode()` through `useSyncExternalStore`.

There are two display components in `components/ui`:

- **`DebugDetails`** renders its children in a dashed block marked "Debug" only when debug mode is on. Each of the about 15 call sites in the proposal wraps its technical content in it, replacing the bespoke `<details>` disclosures.
- **`DebugPanel`** is a collapsible panel taking `rows: {label, value}[]`, rendered by each main screen. Batch screens build the rows from data they already hold: the route, batch ID and revision, `LiveUpdatesContext` state, and each TanStack query's `dataUpdatedAt`, `status` and `fetchStatus` read through `useQueryClient().getQueryState`.

Rejected:

- A React context provider holding the flag. The external store is already the pattern, and it needs no provider in tests.
- A server flag. That is a non-goal.

### Settings structure and routes

**Section list.** `SETTINGS_SECTIONS` becomes `agents`, `inventree`, `defaults`, `appearance` and `developer`.

**Agent subsections.** `AGENT_SUBSECTIONS` lists `sessions`, `models`, `instructions`, `descriptions`, `tags` and `research`. `settingsSection()` maps `settings/descriptions` to `agents` plus the `descriptions` subsection.

**Nav.** `SettingsNav` gains optional `children` per section, rendered as nested links with `aria-current="location"` for the current subsection.

**Scrolling to a subsection.** It is driven by the route. An Effect keyed on the subsection scrolls the heading into view and focuses it. It runs when the route changes, which is the external system (location hash) it syncs with.

**Component split.** `AgentsSection` splits into one component per subsection under `components/settings/agents/`. `DescriptionsSection.tsx` becomes the Descriptions subsection, and `DeveloperSection.tsx` is added.

**Rejected:** separate pages per subsection. The design asks for subsections on one Agents page.

### Dev mode popover

`DevBadge` becomes `DevModeButton`, a `Popover` trigger with role `dialog`. Its content component holds:

- the debug switch;
- a readiness summary using the existing readiness query, enabled only while open;
- the actions:
  - Check setup again refetches readiness;
  - Reload app data calls `queryClient.invalidateQueries()`;
  - Copy debug info calls `navigator.clipboard.writeText` with a summary built by a pure function;
- a link to `#settings/developer`.

The `ConnectionDetails` copy of the badge stays a static pill, as the server menu isn't a second entry point.

## State, authority and failure behavior

| State | Owner | Revision or identity | Failure behavior |
| --- | --- | --- | --- |
| Agent settings, including provider rows and the new fields | intake-server `agent_settings` and `agent_provider_settings` | the existing `revision` on the parent row | 412 conflict keeps the edit and offers Reload; `invalid_agent_settings` (422) is a field error |
| Replacement read token | an owner-only secret file plus the in-memory `CredentialHolder` | the file's `saved_at` | written only after the target accepts it; a failed write leaves the old file and holder unchanged; a missing secrets directory gives `secret_store_unavailable` |
| Batch defaults | intake-server `batch_defaults` | its own `revision` | the same conflict handling; a missing record is shown on load and skipped at creation |
| Attempt selection | the attempt manifest | the sealed settings revision | unchanged by later saves |
| Batch's copied defaults | capture tables at revision 1 | a batch-scoped revision | no link back to the app-level values |
| Connection observation | the server cache per target context | `observed_at` | one in-flight probe; at most one every 5 s; `unauthorized` kept apart from other failures |
| Debug mode | browser `localStorage` | none | storage errors fall back to memory, off |

**Authority.** Every new route uses the existing binding (actor, target, context), CSRF on writes and strict decoding. Column grants are added in `processing/grants.ts`.

**Secret handling.** The replacement token is accepted only on `PUT`. It is never echoed, logged, included in errors or copied into debug info. The secrets directory and file are created owner-only, and startup refuses a saved file that other users can read (`secret_file_permissions`).

**Debug output.** It shows only data already sent to the browser. Copy debug info excludes tokens, keys and record content.

## Verification strategy

- **intake-server (Vitest with Postgres tiers):**
  - settings round-trip and conflict for the provider rows and new fields;
  - each `invalid_agent_settings` case;
  - the migration of an existing single selection;
  - per-stage sealing across providers: a Research attempt on Codex with its own sign-in method, the others on the default provider;
  - Replace token:
    - the probe runs before saving, and a refusal writes nothing;
    - the file is written atomically with mode `0600`;
    - reads in flight keep the old credential;
    - a restart loads the saved token;
    - Revert deletes it;
    - no secrets directory gives `secret_store_unavailable`;
    - the token is absent from every response and log line, checked with a planted value;
  - `create()` snapshot, including a missing location;
  - batch-defaults route conflict;
  - description style delivered once in the first instruction message, with the digest unchanged;
  - forced check: reuse in flight, the 5 s window, 401 mapping to `unauthorized`, and the observation updated.
- **contracts:** TypeBox schemas and the generated client regenerated; decoding tests for the new fields.
- **frontend (Vitest and Testing Library):**
  - routes and sub-nav, including the `#settings/descriptions` redirect;
  - each subsection's Save and conflict;
  - the provider cards, with a provider turned off resetting its steps, and a save with no provider on refused;
  - Replace token: field cleared, Refused and Unavailable messages, and Revert confirmation;
  - batch-defaults pickers with a missing record;
  - Check now states;
  - the debug-mode controller with throwing storage;
  - `DebugDetails` hidden and shown at representative call sites (failure details, round details, evidence provenance);
  - footer diagnostics gone;
  - the Dev mode popover by keyboard, with a readiness failure and a clipboard refusal;
  - Reload keeping a dirty draft.
- **Manual or browser:** phone-width popover (360px), sub-nav scroll and focus, and both themes. Evidence goes in the PR.
- **Checks:** `pnpm typecheck`, `pnpm lint:frontend`, `pnpm test:frontend`, `pnpm build`, the intake-server suites, and `pnpm openspec:overlap --change settings-debug-mode` before sync.

## Migration, rollout and recovery

**Migration.** One forward migration (`0032_settings_debug_mode.sql`):

- adds the `agent_settings` columns with defaults that reproduce today's behaviour;
- creates `agent_provider_settings` and fills it from each existing row's `provider`, `authentication` and `model`;
- creates `batch_defaults`;
- adds grants.

Existing attempts and batches are untouched.

The old `provider`, `authentication` and `model` columns are kept. Saves keep writing the default provider's values into them. A later change drops them once this ships.

**Rollback.** Revert the app code. Older code still reads valid `provider`, `authentication` and `model` columns and ignores the new columns and tables. A saved replacement token is ignored by older code, which falls back to `INTAKE_DEV_API_KEY`. There is no inventory effect, and the import reference is unchanged.

**Rollout.** Debug mode starts off on every device, so the first load after deploy hides the developer details. Switching it on restores them.

## Risks and open decisions

- **Hidden details while developing.** Developers lose at-a-glance IDs until they switch debug mode on. Mitigation: the switch is one click from the Dev mode pill.
- **Description style quality is model-dependent.** The style is guidance, not validation, so agents may drift from it. Validation stays the same.
- **BI-015 overlap.** `complete-design-refresh-backend` must be narrowed in the same planning PR so the two changes don't claim the same rows.
- **Codex steps run unverified.** BI-010 keeps Codex sessions labelled `native_unverified`, so a step set to Codex inherits that limitation.
- **The token is protected only by file permissions.** The same local user who can read `.env` can read the saved token. This is accepted for a single-operator local server.
- **Assumptions to confirm:**
  - Replace token covers only the read token, not the approval runner's write credential.
  - Sessions at once stays one limit shared by both providers.
