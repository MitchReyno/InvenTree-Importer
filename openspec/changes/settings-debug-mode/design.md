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

**Saving.** One revision covers every agent subsection, sent as the whole loaded settings object.

- **Providers and steps save together.** Providers and "Provider and model per step" are one form with one Save, because turning a provider off resets that provider's steps to Default in the same form. A save never sends a step on a provider that is off.
- **Other subsections save on their own.** Sessions, Instructions, Descriptions and naming, and Tag suggestions each have their own Save. Each sends the loaded values for the fields it doesn't own, not another form's unsaved state.

**New `batch_defaults` table.** It has the same key, a `revision`, `location_pk` and `supplier_pk`.

- `PUT /api/v1/batch-defaults` saves it with the same revision conflict (412).
- `GET /api/v1/batch-defaults` resolves each saved PK through the catalogue single-record lookup. For each it returns `{pk, label, status: 'found' | 'not_found' | 'unavailable'}`, so the pickers can show the saved record's name, or say it wasn't found or couldn't be checked. Absence from the bounded candidate list (`CATALOGUE_CANDIDATE_LIMIT`, `capture/catalogue.ts`) is never taken as "not found".
- The Settings pickers use new batch-free catalogue routes for both `candidates` and `search`, matching what `useCatalogue` calls inside a batch.

**Rejected:**

- One generic key/value `app_settings` table. It loses typed columns and grants, and gives no gain for two rows.
- Putting batch defaults into `agent_settings`. They aren't agent behaviour, so they would share a revision with unrelated Agent saves and make Batch defaults conflicts noisier.

**Accepted:** two Saves on two pages can't conflict with each other, which is correct.

### Independent providers, resolved and sealed per step at queue time

A pure `resolveSelection(settings, stage)` returns the existing `AgentSelection` shape (`{provider, authentication, model}`):

- **Step choice:** when the step has a selection whose provider is on, use that provider's authentication and the step's model.
- **Otherwise:** the default provider's authentication and default model.
- **Nothing usable:** when the default provider is off or missing, it returns none. Each caller keeps today's outcome:
  - `processing/session-attempts.ts` fails with `agent_settings_required` (409);
  - `processing/model.ts` `nativeInputManifest` fails with `agent_default_required` (422);
  - `processing/examine-trigger.ts` returns early, so the lead session waits for a default.

All three callers switch from reading `settings.selection` to calling `resolveSelection`. The sealed manifest field keeps its `AgentSelection` shape, so the worker and the provider adapters are unchanged. The lead Examine attempt uses the `examine` key.

**Validation on save.** No provider being on is a valid saved state, so the other subsections can be saved on a fresh setup before any provider is set up; sessions then can't be queued, as today with no default. A save fails with `invalid_agent_settings` (422) when:

- a provider is on but the default provider is missing or off;
- no provider is on but a default provider or a step choice is set;
- a provider that is on, or a step choice, has a model that doesn't match the existing model ID pattern (`contracts/src/agent-selection.ts`);
- a step names a provider that is off.

A provider that is off may keep an empty default model.

Models stay free text, as today. The form's suggestion lists (`PRESETS` in `frontend/src/components/agents/AgentSettingsForm.tsx:51`) move into the per-provider card unchanged, and the server doesn't restrict models to them. So existing values such as test model IDs keep working.

**Migration.** The existing `provider`, `authentication` and `model` become one enabled provider row and `default_provider`. The other provider gets a disabled row with subscription sign-in and the first model of its suggestion list. Every step starts on Default, and the revision is unchanged.

**Columns and empty settings.**

- The new text columns are `NOT NULL DEFAULT ''`.
- `auto_tags_default` defaults to `false`.
- `default_provider` is nullable, and null exactly when no provider is on.
- An actor with no saved settings has no row. It reads `revision: '0'`, both providers off with the first model of their suggestion lists as default models, no default provider, every step Default and empty texts, matching today's `selection: null` case.
- The legacy `provider`, `authentication` and `model` columns (`NOT NULL`, with checks, migration 0011) keep a valid value for rollback:
  - the default provider's values while one is on;
  - otherwise their previous values, or Claude, subscription and its first suggested model on a first save.

  Accepted trade-off: after a rollback, code from before this change would treat that fallback as a configured default, even though the newer settings had no provider on.

**Slots and pausing.** Sessions at once stays one shared limit (`agents/session/slots.ts`), and Pause all is unchanged.

**Rejected:**

- **Keep one provider and add per-step providers that must share its sign-in.** That doesn't let Claude and Codex each keep their own sign-in method.
- **Per-provider session limits.** Not requested, and they would change the slot scheduler.
- **Resolve at run time.** That breaks "sealed at queue time".

**Accepted:** Codex steps carry BI-010's `native_unverified` label. Settings doesn't hide Codex because of it.

### Snapshot defaults into a batch at creation

A batch default can't be written as a bare row:

- A default location in `capture_selection` must reference a `capture_observation` in the batch (migration 0002, `capture/repository.ts:456-500`).
- A supplier in `capture_settings_intent` must reference a company observation.
- A supplier change must also write the derived batch-level `capture_context`, which Processing, Review fingerprints and lot inheritance read (`capture/settings-intent.ts:347-354`).

So creation reuses the Capture write paths instead of inserting rows directly.

1. **Before the transaction:** read `batch_defaults` and `agent_settings`, and resolve the saved location and supplier PKs against InvenTree. This needs a new public single-record lookup on `CatalogueReader` (`capture/catalogue.ts:18-21`; `exactId` is private today).
2. **Inside the creation transaction:**
   - insert the catalogue observations for the resolved records, exactly as the Batch settings pickers do;
   - apply the location through the existing default-location write;
   - apply the supplier and Auto tags through the existing settings-intent write, which also writes `capture_context`;
   - insert the version-1 whole-batch `capture_instruction` with the creating actor, when instructions are set.
3. **Missing defaults:** a default that doesn't resolve is skipped. Its reason is stored on a new nullable `capture_batch.creation_notices` column (`jsonb`, e.g. `[{"field":"location","code":"default_not_found"}]`) and returned on the capture snapshot. It is never stored as a `capture_note`, which Processing treats as human evidence (`processing/model.ts:137-147`). Capture shows it as an info banner the operator can dismiss.

Rejected: live inheritance from the app-level values. It would silently change existing batches and their review freshness.

### Deliver the Part description style as operator guidance

`agent_settings` is one row that each save overwrites, so sealing only the settings revision would let a save made while an attempt waits for a slot change what it later receives.

- **Sealing.** The text itself is sealed into the attempt's input at queue time, as an optional `part_description_style` field on the shared session input (`contracts/src/processing.ts`, around lines 120-133), set by `createSessionAttempt` (`processing/session-attempts.ts:59-77`).
- **Delivery.** `openingText()` in `agents/session/session-runner.ts` (around lines 336-368) appends it as an operator-guidance paragraph on the opening turn only, not on resumed turns. That keeps it out of the fixed system prompt, so `instructionBytes/Digest` stay as they are.
- **Not the inbox.** It is not sent through the instruction inbox: `instructNewSession` writes `kind: 'instruction'` inbox rows that a trigger requires to match a `capture_instruction` row (migration 0030).
- **Which sessions.** Lot sessions (Research, Images, Inventory) and the lead Examine session all receive it, because any of them may propose `catalogue.description`.
- **Validation.** The existing one-line, 250-character validation is unchanged.

Rejected: editing the profile instruction string. It would change the verified digest per save and break qualification evidence.

### Forced connection check

The new route is `POST /api/v1/connection-status/check`, CSRF-protected like other commands. It shares the observation cache in `header/connection.ts`:

- An in-flight probe is reused.
- A forced check within 5 s of the previous forced check (`MIN_FORCED_CHECK_INTERVAL_MS`, tracked separately from the 30 s background cache) returns the cached observation.
- Otherwise it probes with the existing deadline.
- Replacing or reverting the read credential clears both the cached observation and the forced-check timestamp, so the next read probes with the new credential.

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
3. swaps the credential in a `CredentialHolder` that the read transport reads on each request;
4. clears the cached connection observation (see "Forced connection check").

Reads already in flight finish with the old value. A refused or failed probe writes nothing. Startup loads a saved file when one exists, and otherwise uses `INTAKE_DEV_API_KEY`.

**Untouched.** Bootstrap's `configured` status, the approval runner and its credential profile.

**Rejected:**

- **Storing the token in Postgres.** Database backups and dumps would then carry it.
- **An encryption library or OS keychain.** It adds a dependency and doesn't protect against the same local user who can already read `.env`.
- **Restarting the server to apply it.** That breaks live sessions and the open UI.

### Debug mode as a device-local controller plus two components

`frontend/src/debug/debug-mode.ts` follows the masthead-style controller (`frontend/src/theme/masthead-style.ts`):

- it reads and writes key `bench-intake.debug` (`on` or `off`) through the shared `readPreference`/`writePreference` helpers (`frontend/src/theme/device-preference.ts`), which tolerate missing or throwing storage;
- an in-memory value keeps the choice for the session when storage fails;
- `useDebugMode()` reads it through `useSyncExternalStore`.

There are two display components in `components/ui`:

- **`DebugDetails`** renders its children in a dashed block marked "Debug" only when debug mode is on. Each of the about 15 call sites in the proposal wraps its technical content in it, replacing the bespoke `<details>` disclosures.
- **`DebugPanel`** is a collapsible panel taking `rows: {label, value}[]`. `App` renders one `PageDebugPanel` under every page, named from the route, so each screen gets it without its own wiring. Its rows are the route, the batch ID and revision (from the cached batch read), the agent settings revision (from the cached `agent-settings` read, when a screen holds it), `LiveUpdatesContext` state, and every read mounted on the screen. `useDebugReads` subscribes to the TanStack query cache, as `useCachedData` does, and lists the queries that have an observer, with their status, fetch state and data age, so it re-renders as they change and starts no request.

Rejected:

- A React context provider holding the flag. The external store is already the pattern, and it needs no provider in tests.
- A server flag. That is a non-goal.

### Session failures: recovery always, details on demand in debug mode

Today `SessionFailureSummary` carries only `{id, category, summary, details_available}` (`contracts/src/session-failures.ts:22-30`, projected in `intake-server/src/agents/failures.ts:52-58`). The recovery guidance comes only from the details read (`GET /api/v1/agent-sessions/:attemptId/failures/:failureId`) when Show details opens (`frontend/src/components/agents/SessionFailureDetails.tsx:50,79`).

- **Contract.** The summary gains `recovery`, projected from the same retained failure record. So, with debug mode off, the category, summary and recovery show without a details read.
- **Debug mode on.** Show details stays, reads the details on demand as today, and renders them inside `DebugDetails`.
- **Debug mode off.** Show details isn't rendered, so no details read happens.
- **No eager reads.** Failure details are never fetched just because debug mode is on.

PR-A therefore includes this small contract and projection change, beside its frontend work.

### Settings structure and routes

**Section list.** `SETTINGS_SECTIONS` becomes `agents`, `inventree`, `defaults`, `appearance` and `developer`.

**Agent subsections.** `AGENT_SUBSECTIONS` lists `providers`, `sessions`, `models`, `instructions`, `descriptions`, `tags` and `research`. `settingsSection()` maps `settings/descriptions` to `agents` plus the `descriptions` subsection.

**Nav.** `SettingsNav` gains optional `children` per section, rendered as nested links with `aria-current="location"` for the current subsection.

**Scrolling to a subsection.** It is driven by the route.

- Subsection headings render at once, while each body shows its own loading state, so a direct link such as `#settings/descriptions` finds its heading before the settings read finishes.
- An Effect keyed on the subsection scrolls the heading into view and focuses it. It runs when the route changes, which is the external system (location hash) it syncs with.
- A ref records the last subsection focused, so a refetch never steals focus again.

**Component split.** `AgentsSection` splits into one component per subsection under `components/settings/agents/`. `DescriptionsSection.tsx` becomes the Descriptions subsection, and `DeveloperSection.tsx` is added.

**Rejected:** separate pages per subsection. The design asks for subsections on one Agents page.

### Dev mode popover

A new `masthead/DevModeButton.tsx` replaces `DevBadge` in `Masthead.tsx`: a `Popover` trigger with role `dialog`. `masthead/DevBadge.tsx` stays as the static pill inside `ConnectionDetails.tsx`. The popover's content component holds:

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

**Authority.** Every new route uses the existing binding (actor, target, context), CSRF on writes and strict decoding. Grants are added for every role that touches the new tables:

- **`processing/grants.ts`:** read and write on `agent_settings` and `agent_provider_settings`.
- **`capture/grants.ts`:**
  - `SELECT` on `agent_settings` and `agent_provider_settings`, because batch creation reads them;
  - `SELECT, INSERT, UPDATE` on `batch_defaults`;
  - `UPDATE` on the new `capture_batch.creation_notices` column.

The Capture and Media Postgres suites run under a Capture-only role (`grantFoundation` plus `grantCapture`), so they catch a missing grant.

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
  - `create()` snapshot:
    - observations, the default-location selection, the settings intent and `capture_context` are written as the pickers would;
    - Processing and Review fingerprints see the supplier;
    - a missing location is recorded in `creation_notices`, not as a note;
  - batch-defaults route conflict;
  - description style sealed at queue time and delivered only in the opening message; a save while the attempt is queued doesn't change it; the digest is unchanged;
  - failure summaries carry `recovery`;
  - forced check:
    - reuse in flight;
    - the 5 s window counted from forced checks only;
    - 401 maps to `unauthorized`;
    - the observation is updated;
    - a credential change clears the cache.
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
