# One-command local app development

Status: plan recorded before source implementation on `feat/intake-dev-stack`, based on current `interactive-app` (`e45ca57`). The requested port 4330 server was already stopped at live inspection; the recorded supervisor no longer existed. Retained data and unrelated services are preserved.

## Requested outcome and scope

Rename the root UI-only `dev` command to `dev:ui`. Make `pnpm dev` start the complete usable local application: retained owned PostgreSQL data, an explicitly synthetic inventory service, API, apply and Processing workers, media decoding and Vite with source-driven live updates. Native provider workers may be selected only through the existing explicit profile configuration; qualification uses deterministic fixtures exclusively.

Live reload must follow code changes only. Frontend changes use Vite HMR; server/contracts changes gracefully stop and restart owned application children. Uploads, private state, database changes, logs, docs, tests, build output and unchanged-byte filesystem events must not restart the app. Shared PostgreSQL and retained state are never restarted, dropped or recreated on application reload or normal shutdown.

The primary agent owns implementation. Each commit receives a fresh read-only review until clean. Existing authorization permits publication and pinned squash merge into `interactive-app` after selected CI and full PG/process checks pass. Personal sessions never run code intelligence under the newly updated global instruction.

## Architecture and interfaces

- Root `tooling/dev.cjs` owns the CLI lifecycle and uses existing pinned Vite's public JavaScript API. It serves UI and API/WebSocket proxy on one loopback origin, preserving browser Host/Origin/CSRF authority. Standalone `dev:ui` stays available.
- The API receives an explicit development listen-port override so the public browser origin and private API listener can differ without rewriting security headers. Default non-dev startup remains unchanged.
- Development-only setup and runtime helpers reuse existing owned fake/provisioning/grant seams. The local app namespace and newly generated synthetic runtime credentials are retained privately. No provider credentials or original inventory environment are copied into it. Shared PG administration credentials are read only by explicit provisioning and are not saved in app configuration.
- The existing fake inventory implementation is reused for the explicitly synthetic dev profile. It must support reopening already initialized fake tables under a restricted fake-only role; ordinary app runtime never imports the development launcher.
- Workers use separate owned roles and existing command boundaries. The decoder runs continuously while the dev app is active. The default Processing worker emits clearly synthetic source-bound results; explicit native mode uses the existing native supervisor and retains its no-replay/reap policy.
- A private host lock prevents duplicate supervisors. Signal handling and failures stop/reap only owned application children, preserve private data and leave shared PG running. Initial setup is separate from code-reload cycles.

## Alternatives and dependencies

A concurrent shell command would miss provisioning, lifecycle ownership, same-origin API wiring and non-code reload exclusions. Rebuilding static assets on every filesystem change would also reload after runtime data writes. Use Vite's maintained HMR/proxy APIs and Node's existing filesystem/process primitives instead; no dependency is added. The existing pinned tsx loader remains the application TypeScript entrypoint.

References: [Vite JavaScript API](https://vite.dev/guide/api-javascript) and [Node filesystem watching](https://nodejs.org/api/fs.html#fswatchfilename-options-listener). Node 24 supports recursive watching on the target macOS/Linux hosts. Custom content hashing owns the requested unchanged-byte/data exclusion policy; Vite owns browser module updates.

## Steps and acceptance checks

1. Preserve the stopped user preview and coordinate a new pg-docker allocation. Install the worktree's frozen dependencies after preserving its initial main-checkout dependency link.
2. Add retained setup/runtime ownership and a root dev supervisor. Wire same-origin API/WebSocket forwarding, strict ports, frontend HMR and graceful source-only server reload.
3. Update scripts and owning documentation. Test private setup/restart persistence, meaningful failure handling and shutdown.
4. Exercise the actual dev command through HTTP and a browser: create/edit retained data, decode an upload, run deterministic Processing, observe a fake apply; verify source changes reload, state/log/docs/no-op changes do not, and Ctrl-C leaves no owned app processes while retaining data.
5. Run contracts/types/lint/format/build, relevant supervisor regressions, full PG/process tiers under the lease and independent exact-commit reviews. Publish and merge after selected CI is green.

## Safety and evidence

No actual model/provider calls, original root `.env` loading, real InvenTree requests, deployment, main/PR 32 merge, force-push, reset/clean or branch/worktree/retained-data deletion. Retained port 4310 stays untouched; port 4350 is not allocated. The prior preview's database/media remain preserved. This task changes development startup, not real inventory/provider qualification or T11 identity policy.

Execution evidence, implementation refinements and review outcomes will be added here as they occur.

## Implemented behavior and refinements

Root `dev` now owns the retained synthetic stack; the previous UI command is `dev:ui`. Standalone `dev:intake` uses the same source-byte watcher policy without provisioning or workers. No dependency was added. Runtime roles, generated fake credentials, identity, gate and media remain under a private external app-state namespace; setup accepts an explicit owned CI admin URL without passing it to runtime children. The default native-provider keys/profile are removed from the synthetic child environment.

Vite runs in a separate owned process. An initial shutdown check found that Vite's own signal handlers could exit an in-process supervisor before cleanup; process separation fixes that ownership problem. The process-stop timeout is cancelled after successful child exit, preventing an otherwise unnecessary 45-second exit delay. Status checkpoints use atomic replacement so concurrent readers never observe truncated JSON.

The decoder role uses the existing complete capture-read grant, including later lineage/instruction tables; a real upload check caught the initially incomplete hand-selected read list. Reopening retained state reapplies reviewed Processing/decoder grants after migration. Source hashes captured before app startup are reconciled when attaching the watcher, so edits during startup are not lost. Reload failures wait for another source edit, rather than retrying on a timer.

Application source roots and deliberate restart-required tooling/fixture/dependency changes are documented in `docs/development.md`. Vite keeps its normal configuration/HTML behavior. Previously applied migrations remain immutable. A hard-kill stale supervisor lock and interrupted first setup require inspection; normal shutdown releases only the owned lock after child exit and retains data.

## Verification evidence

- Supervisor policy tests: 4 passing, including ignored data/docs/tests/no-op writes, new/edited source, startup edits and bounded child shutdown. These require real host filesystem watching; sandbox permission errors are failures, not passing notifications.
- Contracts 33, server fast tests 142, frontend tests 151. Complete normal backend tier: 2,039 passed, 4 existing skips, 43 scanner/TUI deselections. Workflow/command surface: 8 passed; CI path-selection tests: 21 passed.
- Contract generation drift, frontend/server types, frontend lint, shared readability lint, changed CI Python lint, Markdown lint and complete formatting check passed. Production build passed with its existing large-chunk advisory.
- Full PostgreSQL tier under the owned `pg-docker` lease: 121 passed, zero skips. Full process tier: 38 passed, zero skips, including the complete dev-stack journey. Independent review and hosted CI are required before merge.
- Actual root `pnpm dev` browser check: public 4330 loads, creates and retains a batch, and reports connected live updates. A visible masthead source edit produced one HMR update without navigation or batch loss; an unchanged-byte save produced zero HMR events. Exact source restored; the second HMR restored the original text. Screenshot retained locally under `.amp/out/dev-browser/full-app.png` and visually inspected.
- The actual launcher process regression exercises HTTP and WebSocket proxy authority, PNG decode, synthetic DBOS Processing, explicit fake approval/apply, retained restart, no-op/runtime exclusions, backend restart without replacing Vite, compile-error recovery and all-owned-child exit. Focused journey passed before full-tier qualification.

All qualification uses owned fake inventory and controlled providers only. No actual provider inference or original inventory environment is used. The browser and development app are stopped; shared PostgreSQL and retained data remain preserved.

## First independent review and fixes

Fresh read-only review of `44d87282d421df566f13e08832ca20d3ed58a7ee` requested two changes. Startup could ignore a ready sibling's later exit while another child initialized, and a retained ready marker could outlive its process. Startup now retains sibling-exit failure in a shared cancellation signal, checks every child before announcing readiness, and checks cancellation/exit before accepting a ready marker. Two controlled-process regressions distinguish these cases without launching application services.

The second finding showed that `pg` query parameters can override host/user fields checked with `URL`. Both explicit admin and retained runtime connection validation now use plain-URL parsers that reject query parameters and fragments before connection. Tests demonstrate the driver's effective host/user override without connecting, then verify refusal alongside valid generated loopback URLs and foreign-host/database/user controls. Codex subscription documentation now identifies the isolated `CODEX_HOME` login namespace; no provider CLI or authentication store was invoked/copied.

After these fixes, supervisor tests passed 6/6, server fast tests 144/144, types/readability/format/Markdown checks passed, and the complete dev-stack process journey passed again under a newly acquired `pg-docker` lease. Earlier full PG121/process38 evidence remains applicable to the unchanged domain/runtime boundaries. A fresh exact-commit review is required before publication.
