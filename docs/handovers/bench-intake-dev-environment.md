# Development environment files and target connectivity

Status: plan recorded before implementation on `feat/dev-environment-configuration`, from current `interactive-app` (`db859a1`). The primary agent owns implementation. Preserve the user's checkout and untracked `.nvmrc`, original inventory `.env`, running services and retained data.

## Requested behavior and observed cause

The user requested a PR that reads development environment values from `.env`, including the InvenTree URL/key/reference, and reported that the fake inventory appears disconnected during `pnpm dev`. Static inspection identified a concrete protocol mismatch: the new header's bounded connection probe requests `GET /api/part/?limit=1`, while the owned fake supports individual Part reads but returns 404 for that collection endpoint. Verify this through the actual development launcher, then add the endpoint and a regression that checks header connectivity.

## Scope and interfaces

- Add explicit server-side dotenv loading to `dev` and standalone `dev:intake`, using the checkout-root `.env` by default. `INTAKE_ENV_FILE` selects another file; an empty selector disables file loading. An absent default file is fine; an explicitly requested missing file fails. Existing shell values win, including empty values. Parse only bounded regular UTF-8 files, accept a documented allowlist and never log values or inject dotenv values into Vite's client environment. File changes require command restart; preserve source-only reload.
- Support the existing `INTAKE_READ_ORIGIN`, `INTAKE_DEV_API_KEY` and `INTAKE_CREDENTIAL_REF` settings in the full app. An explicit external origin selects a protected read-only target. Keep the default fake/apply flow. Reject contradictory/partial configurations before provisioning. Native providers stay explicit opt-in; never run a live provider for qualification.
- Bind each external origin/reference to a separate retained development namespace and immutable target identity. Do not relabel a retained fake database or mix facts from different origins. Persist origin/reference metadata only, never the external API key. A real read-only namespace provisions the existing capture/media/Processing roles without a fake inventory, executor deployment, apply credentials or apply worker. Existing manual/domain checks must refuse execution without deployment authority.
- Keep legacy retained fake state readable. Use a separate versioned read-only state shape and a common scheduler lookup; do not weaken fake profile validation. The root launcher may consume a pure configuration TypeScript module through pinned Node24's native type stripping; document that boundary and keep application entrypoints on the existing pinned tsx loader.
- Correct the fake's bounded Part-list probe response without weakening the production probe or claiming that a fake proves real-server compatibility. Respect its explicit read-unavailable fault.

## Reuse and alternatives

Node24 already provides `node:util.parseEnv`; use its maintained dotenv grammar without another dependency or shell evaluation. The utility returns data, allowing an allowlist and shell-over-file precedence without globally mutating `process.env` or accepting file-provided PATH/NODE_OPTIONS. Research references: [Node24 util.parseEnv](https://nodejs.org/docs/latest-v24.x/api/util.html#utilparseenvcontent) and [Node environment variable syntax](https://nodejs.org/docs/latest-v24.x/api/environment_variables.html).

Do not use Vite dotenv loading for secrets, Node's unrestricted process-wide env-file injection, a hand-written dotenv parser, or a fake execution profile pointed at an arbitrary target. Reuse the owned local database allocator, current migration verifier, explicit runtime grant seams, protected-read-only transport and source watcher. No migration, dependency, real inventory write authority or provider entitlement change is needed.

## Implementation and verification

1. Implement a testable bounded env loader and pure target parsing/binding policy. Add temporary-file tests for quoting/comments, shell precedence, omitted/default/explicit files, invalid files, allowlisting and no value disclosure.
2. Add retained read-only provisioning/state validation and wire target-specific child environments in both dev launchers. Verify namespace stability, identity refusal on rebind, no external key in state/UI/worker logs, and no apply/fake process or deployment for external targets.
3. Add the bounded fake probe endpoint. Extend the real dev-stack journey to assert reachable header status and existing fake apply behavior. Add an external-profile journey using an owned controlled HTTP server: file-provided configuration, correct token/read routing, zero target POSTs, unavailable approval, retained restart and target-switch refusal. Tests always explicitly disable dotenv or point to synthetic files; never load the original checkout's real environment.
4. Update examples and owning docs/architecture. Run types/contracts, source readability, format/Markdown, applicable normal suites and complete PG/process tiers serially under the pg-docker lease. Exercise the actual UI/headless browser under the browser lease where it adds evidence.
5. Commit, obtain a fresh independent read-only review for each new commit until clear, then publish the requested PR against `interactive-app` and verify selected CI. Existing merge authorization applies only after these gates; never merge main or PR32.

## Safety and evidence

No code intelligence, actual model/provider calls, original real inventory configuration loading/copying, real InvenTree requests, deployment, force-push, reset/clean or branch/worktree/retained-data deletion. Use isolated synthetic env files and an owned controlled server only. Do not restart the user's current dev stack, retained4310 or shared PostgreSQL. Record implementation refinements, test results and review fixes below as they occur.

## Added user report: Capture photos

During implementation the user also reported being unable to add photos. Inspect the actual Capture file-picker/upload path, including retained databases upgraded through the recent Capture/evidence migrations. The current reopen path refreshes Processing/decoder grants but not the complete API Capture/media grants; new evidence-group/note INSERT privileges and Capture context privileges may therefore remain absent on retained API roles. Add an upgrade regression that provisions a separate legacy API role without the newer Capture permission during trusted fixture setup, reopens it through setup, then performs Capture edits and actual photo upload/decode. Verify the browser control as well; do not treat this suspected grant mismatch as proven until the boundary is exercised. Keep any fix scoped to dev provisioning and demonstrated UI failures.

## Qualification refinement

Automatic approval rejected a proposed manual browser permission fault because it would read the shared administrator credential outside the approved setup path. That command did not execute. Browser verification uses the normal upload flow. The upgrade regression now prepares a new restricted legacy API role during the existing authorized owned-fixture setup, closes its setup connection before runtime, and demonstrates the missing permission through that restricted role. It never reads private service state directly or revokes privileges from a running role. Current dev setup then repairs the legacy role and retries the exact photo payload/revision/key.

## Implementation and qualification results

The server-only loader uses Node24 `parseEnv` with a 64KiB regular-file budget, nonblocking/no-follow open, fatal UTF-8 decoding, explicit tagged failures, a server-settings allowlist and shell-over-file precedence. In-checkout files are limited to root `.env`/`.env.*` names already denied by Vite; other filenames must be outside the served checkout. Git ignores dotenv variants while preserving the documented example templates. Env values remain startup configuration, so edits do not trigger source reload. Caller-relative selectors honor pnpm's `INIT_CWD` for standalone API execution.

External origins/reference labels select protected read-only mode and a separately bound namespace. The external token is absent from retained state, Vite and worker environments. Version1 retained fake state stays supported; version2 read-only setup creates no fake role/service, apply credentials/worker or executor deployment. Default fake mode retains supervised apply. The bounded fake Part-list endpoint now makes the existing header probe reachable while preserving its unavailable-read fault.

Retained startup now reapplies current foundation/Capture/manual/media API grants as well as Processing/decoder grants. A setup-only legacy-role fixture has the historical Capture/media grants, no Capture-context read permission and no group-history/evidence-note INSERT permission. Restricted runtime access proves the missing Capture permission and an actual HTTP 500 upload response. Current dev setup repairs that same role, and the exact PNG/label/revision/request key succeeds after restart; creating a new evidence group succeeds too. No shared administrator credential is passed to either runtime API process.

- `pnpm test:dev`: 14 passed, covering parser/precedence, private file placement, symlink/FIFO/size/UTF-8 refusal, Git exclusions, source-only watching and child supervision.
- Contracts: 42 passed; server fast: 160 passed; frontend: 184 passed. Normal backend: 2,039 passed, four existing skips and 43 scanner/TUI deselections. Workflow/command surface: eight passed. Types, generation drift, frontend/readability lint, formatting and Markdown checks passed; production build passed with its existing chunk-size advisory.
- Full PostgreSQL: 132 passed; full process: 40 passed passed, no skips, serially under the pg-docker lease. Final process tier includes file-provided read-only settings, exact token routing, zero remote POSTs, no executor deployment/apply/fake process, no token in app state/public responses/logs, secret-file HTTP refusal, restart retention and cross-origin namespace rebind refusal. Standalone API caller-relative dotenv selection is exercised separately.
- Headless real-browser verification reports Target reachable on the default fake, creates a retained batch, clicks Take photos, chooses a synthetic 64×64 PNG, clicks Retain, and observes a 237-byte retained original with a ready 64×64 preview. Screenshot `.amp/out/browser/photo-saved.png` was visually inspected. Browser/app are stopped and the user's existing dev app remains untouched.

All configuration/probe/upload/worker evidence uses synthetic files and owned local services. The original real inventory `.env` was not read/copied, and no actual provider or real InvenTree request was made. Independent exact-commit review and selected hosted CI remain required before publication/merge.

## First review and fix

Fresh read-only review of `0e0ef5a7c509c5521e9c3bc50cc6818022fe00c8` found that standalone `dev:intake` forwarded the merged environment without narrowing it to the HTTP runtime. A shared env file could therefore expose its unused setup-admin/provider keys to the API child. The launcher now applies a dedicated API-runtime allowlist after file/shell resolution, excluding setup-admin URLs, provider keys, native executable overrides, Node flags and unrelated shell values. A synthetic actual-child regression proves exclusion while preserving the API origin, inventory token and restricted app database URL. No other concrete findings were reported. Fresh exact-commit review follows after relevant checks.

Post-fix checks passed: 15 env/supervisor regressions (including an actual synthetic child environment), the standalone HTTP env-file journey, formatting and Markdown. This fix narrows only the standalone child environment; full-stack/domain code and the earlier complete PG/process evidence are unchanged. A new reviewer must inspect the new exact commit before publication.

Fresh cumulative review cleared code commit `1e152484218806b49be85ba2d58b40f18f7a9b13` with no remaining actionable findings. An author documentation check then clarified that dotenv values do not become shell exports and automatic read-only namespaces differ from the fake default: Codex login must use the target's existing exact app-state directory. The new-namespace example explicitly selects a private directory before initial synthetic startup. This documentation-only follow-up requires a fresh exact-commit review; runtime code and qualified patches are unchanged.
