# Frontend architecture

This document describes the implemented manual intake application under `frontend/`. Read the [shared architecture](../ARCHITECTURE.md), [shared guidelines](../CODE_GUIDELINES.md) and [frontend guidelines](CODE_GUIDELINES.md) for its boundaries and change policy.

## Current application

React and TypeScript run in a Vite browser application. `index.html` loads `src/main.tsx`, which mounts `App` under React StrictMode. `src/App.tsx` uses the validated generated contracts client against the same-origin Fastify API. Bootstrap supplies a visible development-attribution banner and ephemeral CSRF token, never an inventory key. Retained batch list/create/read/edit/archive commands store state in PostgreSQL, not localStorage. A hash URL retains batch and selected subject/editor; refresh loads saved server state. Closing the browser does not erase batches or notes.

`src/components/capture/CaptureWorkspace.tsx` coordinates focused header, queue, evidence, editor and field components, each in its own `.tsx` file. Batch list/detail components live in `src/components/batches/`; retained data/client types and pure display mapping stay in `src/capture/`. The capture components own the compact lot queue, human-note/context panel and focused details editor. Shared Part proposals never combine physical lots. Exact quantity and PK strings stay strings; notes visibly identify human provenance. Defaults and explicit lot selections retain unset/unknown/clear/inherit/set distinctions. Reading a configured target's existing Part/location creates an observation; selecting it is a separate human action. No browser command accepts a target URL, actor or inventory secret. Only manual quantity, location, existing Part choice, labels, links and append-only notes are implemented.

Each save carries the loaded batch revision. A 412 preserves local inputs and displays current saved values; explicit discard/reload is required, never silent rebase or last-write-wins. A single dirty editor disables subject navigation/archive, with explicit discard. The app-owned navigation guard receives synchronous dirty callbacks from Capture and nonempty new-batch title/note forms. It blocks same-document links and hash/history route acceptance while retaining the mounted form and exact input; native unload is protected too. Save/create or explicit discard releases the guard. Transient review selections/archive filters do not lock navigation. A failed/uncertain save remains visibly unconfirmed; it is not blindly retried. Archive retains history and disables editing until explicit resume. Review, Approve and Results use the generated manual client; Processing remains explicitly unavailable. There is no upload, provider or Python runtime connection.

Capture's editor and the separate `components/batches/NewBatchForm.tsx` use pinned React Hook Form. Native fields register directly; Controller adapts the existing quantity/reference controls without changing their modes or exact string values. `capture/editor-model.ts` owns initial values and command construction. Editor defaults remain fixed for the mounted selection, so newer snapshots do not reset a human draft. Synchronous event callbacks still feed the application navigation guard. The form package does not own revision authority, uncertain acknowledgements or payload-bound delivery keys; new-batch creation preserves its existing retry intent independently of form submission state.

`components/review/ManualWorkspace.tsx` coordinates bounded retained-state polling and explicit commands. Review presents physical-lot selection, human evidence and exact saved choices; selecting a shared Part never includes another lot. The first slice accepts at most ten selected lots. The approval view shows included/excluded lots, reused Parts, exact stock effects and the frozen plan digest. Its URL pins the preparation identity across polling/reload; removed or stale plans disable approval instead of substituting another latest plan. Replacement requires explicit choice. Selected/shared dependency changes require fresh review/preparation; unseen capture changes disable review until explicit reload.

`components/results/` displays original approval rounds and journal certainty. Approval and queueing are separate actions. Unknown outcomes have no create-again control; cancellation cannot undo an authorized request. Only server-advertised original-operation recovery is offered. App-wide activity is a bounded, explicitly truncated retained-run snapshot, not simulated progress. Commands carry neither browser authority nor inventory credentials.

Module-scope styled-components declarations own the light/neutral palette and blue selection explicitly approved by Mitch. Shared controls/panels/text live in `components/ui/primitives.tsx`; `GlobalStyle` contains only document/reset/font/focus defaults. Styling-only state uses transient `$` props. The legacy stylesheet is removed. Layout/UX follows the primary [original HTML prototype](../docs/bench-intake/reference/bench-intake.html), [Capture](../docs/bench-intake/reference/03-capture.png), [Review workspace](../docs/bench-intake/reference/02-review.png), [Inbox](../docs/bench-intake/reference/01-inbox.png) and [phone frame](../docs/bench-intake/reference/10-phone.png); see the [reference index and historical limitations](../docs/bench-intake/reference/README.md) before the secondary derivative board. Authoritative [experience wireframes](../docs/bench-intake/05-experience.md) and latest contracts override prototype simulations. Desktop uses queue/context/details; narrow screens use list → focused subject with explicit back navigation and retained context above editable fields. No fake media or simulated processing/execution is added to mimic unavailable breadth. Approval and Results also follow the original [approval](../docs/bench-intake/reference/08-approval.png) and [results](../docs/bench-intake/reference/09-results.png) hierarchy.

`src/App.test.tsx` covers exact string emission, human attribution, archive/resume and concurrent-edit conflict through a jsdom/component boundary. Actual loopback server/browser/restart and inspected desktop/narrow/nondefault screenshots are recorded in the [T02 handover](../docs/handovers/bench-intake-T02.md); component tests alone are not browser or production-access qualification. `ManualWorkflow.test.tsx` adds exact selected/digest emission, explicit stale-display reload and unknown-result controls. The [T04 handover](../docs/handovers/bench-intake-T04.md) links actual desktop/narrow manual journey evidence.

## Retained read coordination

Pinned TanStack Query coordinates bootstrap, batch reads, manual workspace and activity. The generated AJV-validated client façades remain the transport boundary. `queries/client.ts` explicitly disables retries and focus/reconnect refetch; manual/activity observers poll every two seconds. Loopback reads attempt even when browser connectivity reports offline. Existing client deadlines still bound requests; cache cancellation does not claim physical cancellation of non-abortable ports.

`components/query/ServerStateProvider.tsx` owns an in-memory cache. App separates bootstrap from the private cache and keys its lifetime by origin, actor, target and target-context IDs. Scope replacement cancels and clears the previous private cache; no browser persistence is installed. `useServerScope()` and `serverQueryKey(scope, ...resourceIds)` provide the shared seam for additional readers.

Cache data is an observation, never edit or command authority. Capture retains its accepted loaded snapshot until a confirmed save or explicit reload. React Hook Form drafts, dirty navigation, pinned preparation identity, review selection, last preview and payload-bound delivery intents remain outside the cache. Repeated reads cannot reset them. A cached manual preview stays disabled until the mounted observer verifies a read; failed or paused reads retain history while disabling freshness-sensitive commands. Confirmed commands and subsequent failed status reads have separate outcomes.

`ServerState.test.tsx` verifies scope isolation and late prior responses. App/manual component tests cover deduplication, periodic recovery, paused reads, accepted revisions, retained drafts, pinned preparation identity and lost acknowledgement. The [server-state handover](../docs/handovers/bench-intake-server-state.md) records actual browser evidence and package qualification.

## Tooling and application ownership

Frontend dependencies and scripts live in `package.json` here. Root pnpm owns the workspace/control point and single lockfile; `.node-version` and root `packageManager` pin the toolchain. React/Vite/TypeScript/styled-components/plugin versions are pinned in the frontend manifest; Python dependencies stay entirely in backend.

`vite.config.ts` configures React, a loopback-only dev/preview host and Vitest with jsdom plus `src/test-setup.ts`. It has no backend proxy or root `envDir` override. Use `pnpm build` and `pnpm dev:intake` for the integrated same-origin UI; the server serves only built `frontend/dist` through `@fastify/static`. `pnpm dev` remains a standalone Vite presentation server, not a configured API proxy. The frontend does not load root inventory/vendor credentials. No credential belongs in client-exposed Vite variables. `tsconfig.json` enables strict checking; `eslint.config.js` provides configured lint rules. A successful build does not deploy anything.

From repository root, `pnpm dev`, `pnpm typecheck`, `pnpm lint:frontend`, `pnpm test:frontend` and `pnpm build` delegate to this application. Root normal tests also run backend checks. See [repository layout](../docs/repository-layout.md).

## Future work — not implemented

Upload/media retention, automated processing, provider inference, broader effects/shared metadata and final InvenTree authentication/access qualification remain future work, not hidden features. Manual execution is qualified only against an owned persistent fake; no actual InvenTree mutation profile is supported. Existing capture source/contribution identities, immutable human notes and exact selection histories are the future integration seam; do not replace them with a disposable browser draft or copy historical prototype timers/localStorage. Capture and review use reviewed public contracts and owning repository seams, not sibling SQL internals. Normal remote/phone deployment is not enabled by changing the loopback bind.

## Processing workspace

Batch routing keeps Processing separate from the manual inventory stages. Its
header and stage tabs preserve the app-wide dirty-input guard; question URLs pin
an exact question rather than selecting the latest question from polling.
Processing reads use the same actor/target/context query scope as Capture and
manual review. Commands require a successful mounted read; cached data alone
cannot establish answer or start authority.

The global indicator reports inventory runs and Processing lane occupancy
separately. A stale-input worker that still physically occupies the lane remains
visible as occupied. Processing activity failures are reported independently.
Actual provider integration remains unqualified; retained synthetic fixtures do
not imply native login, entitlement or inference support.
