# TanStack Query for retained server state

## Prospective plan

Mitch approved TanStack Query after the coordinator identified repeated polling/read state in the current frontend. This plan precedes runtime and dependency changes. The task starts from actual merged `interactive-app` commit f121095621fea55f70ba9b3ca7c3a80cfdd6de3c, including the reviewed React Hook Form and readability changes.

### Scope and ownership

Replace repeated read effects, timers, active flags and transport loading/error state with TanStack Query in bootstrap, retained batch list/read, manual workspace and application activity. Preserve the current styled-components, layout, labels, exact string scalars and native behavior.

This owner may change frontend query providers/helpers, App, main, Batch/Batches read state, ActivityIndicator, ManualWorkspace, associated tests/docs and the frontend dependency/root lockfile. The coordinator owns subsequent media/processing route wiring after this task merges. Do not edit their unpublished components, generated clients/contracts, backend, inventory behavior, migrations or provider integration.

### Boundary and public interfaces

- `ServerScope` contains origin, development actor, target and target-context IDs. Query keys contain that full scope and resource identity, never credentials.
- `ServerStateProvider` creates one stable in-memory QueryClient for its mounted lifetime. Bootstrap uses an outer provider; App mounts a separate private provider keyed by the returned scope identity. Identity changes discard the previous private component/cache lifetime rather than exposing it under another scope.
- `serverQueryKey(scope, ...resourceIds)` and `useServerScope()` are the small shared seam for later media/processing query consumers. Components use TanStack Query directly; no new query/workflow framework is planned.
- Query policy explicitly disables retries and focus/reconnect refetch. Manual/activity reads poll at the existing two-second interval while observed. Requests retain their existing client deadlines; non-abortable client ports do not gain a claim of physical network cancellation.
- Capture's accepted loaded snapshot remains application authority, distinct from the latest cache. Adopt only an initial fresh read, a confirmed edit response or explicit reload. A polling/refetch result cannot reset human fields, change the submitted revision or clear the dirty-navigation guard.
- Review selections, pinned preparation identity, last displayed preview and all command/recovery intents remain domain/UI state. Keep successful-response adoption and uncertain failures explicit. No automatic mutation retry, optimistic authority, fresh key invention or approval/start/recovery effect is introduced by the package.

### Package assessment and alternatives

Pin `@tanstack/react-query` 5.105.1. Registry metadata reports MIT, React and React-types peers supporting 18/19, and one runtime dependency, matching `@tanstack/query-core` 5.105.1. The existing application uses React19.3.1 and TypeScript6.0.3; installed checks remain to be qualified.

Official documentation describes deterministic query keys, in-flight caching/deduplication, retained data and configurable polling/defaults. Default retries/refetch triggers are inappropriate to leave implicit here, so the provider will configure them deliberately. No persistence, devtools package, routing/state framework or second schema language is added.

Keeping the custom effects would avoid a dependency but retain repeated active/timer/error coordination. A generic wrapper around the effects would recreate package machinery without its tested observer/cache behavior. TanStack Query does not replace server authority, immutable approvals or form state.

- [Important defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults).
- [Query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys).
- [Cancellation boundary](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation).
- [QueryClientProvider](https://tanstack.com/query/latest/docs/framework/react/reference/functions/QueryClientProvider).

### Implementation sequence

1. Install the exact approved pin and verify actual exports/types with the pinned workspace toolchain.
2. Add the scoped provider/key seam and test independent cache lifetimes and duplicate read observers.
3. Convert bootstrap/list/capture reads while retaining accepted revision authority and create-intent lifetime.
4. Convert activity/manual polling, preserving displayed history, offline refusal and pinned preparations.
5. Exercise read deduplication, polling, failed reads/reconnect policy, late old responses, scope changes and existing dirty/conflict/lost-ACK behavior.
6. Incorporate actual merged OpenAPI tooling before final consumer qualification. Do not import an unpublished branch.
7. Run frozen installation, frontend/contract/server types and appropriate frontend/contract checks, lint/readability/format/drift and production build. Use the approved service allocation for actual browser checks; no duplicate service or protected inventory request.
8. Record actual evidence and limitations, publish a ready PR into `interactive-app`, then obtain fresh independent exact-head review and selected CI before the coordinator merges.

## Verification plan

Existing 13 frontend tests remain regression gates. Add observable interaction cases for shared reads, periodic refresh, retained offline data/disabled commands, scope isolation and late prior-scope results. Verify a dirty Capture/new-batch form and a URL-pinned preparation cannot be replaced by refreshed server data. The payload-bound new-batch intent must survive uncertain acknowledgement and discard/reopen.

Inspect desktop and narrow native browser interactions with browser-harness and recordings disabled. Reuse the owned Capture preview where compatible; request coordinator allocation before any service/preview change. Never load the original environment or use personal inventory/provider credentials. The real InvenTree is strictly read-only, including no mutation probes.

## Results and review

Implementation and local qualification are complete. A ready PR and fresh independent exact-head review remain coordinator gates; no production deployment is claimed.

## Initial implementation checkpoint

The installed provider/key interfaces and bootstrap/list/capture/manual/activity conversion pass the original 13 frontend tests. Added component/hook cases bring this to 22 passing tests: all four scope dimensions replace the private cache, a late old read cannot republish, two observers share a read, failed polling retains selection while disabling commands, paused cached reads cannot authorize commands, a cache refresh cannot change Capture's accepted revision/draft, and same-scope bootstrap unavailability preserves the mounted draft. The existing pinned-preparation and lost-ACK discard/reopen regressions remain green.

Read status and command outcomes remain separate. A status refresh failure after a confirmed command reports unavailable retained state instead of relabeling that command as uncertain. Initial bootstrap failure still shows setup failure; a later same-scope bootstrap failure retains mounted human input and shows a connection notice. Genuine scope replacement unmounts and clears the prior private cache.

The installer automatically added two exact-version release-age exceptions. The coordinator explicitly approved retaining only those two pins; global age/strictness controls were not changed. Registry SHA512 and the available npm provenance subject match each exact tarball. The provenance identifies the official TanStack/query release workflow and commit a6be1cede9b69b56ee0bd6c84641dd3899c86ed2. Three critical packaged source files per package match that commit byte-for-byte; neither package has install lifecycle scripts. Sigstore certificate/signature trust was not independently reverified. Registry metadata omits gitHead, so the source commit came from the provenance statement.

A sandbox package-store permission failure caused an unwanted install attempt during the first formatter command. Only that owned process was stopped; an elevated frozen offline install restored the existing store, and subsequent formatting/checks use the qualified pinned toolchain. No application service or original environment was involved.

## Integrated qualification

The owner checkpoint is based on actual readability PR49, then a normal merge incorporated actual OpenAPI PR50 (`9acbc5b1242c7995d338739436b97a1b171b65ca`). No unpublished feature branch was used. Frontend consumers still use the generated AJV-validated façades.

All 25 frontend tests pass, including the original 13. New cases cover scope replacement in each identity dimension, late old responses, duplicate observers, polling/recovery, paused reads, draft preservation, pinned preparation freshness and confirmed-command/read-failure separation. Two negative controls demonstrate meaningful coverage: removing mounted-read verification enables an unverified cached preparation; removing the new-draft lifetime marker unmounts input when the refreshed list becomes nonempty. Each focused test fails at the intended assertion; exact original source bytes were restored. The [negative-control receipt](../bench-intake/evidence/server-state/negative-controls.json) records the restored-source hashes.

Local checks passed after the actual API merge:

- Frozen offline installation with strict peer dependencies, using the existing package store.
- Frontend, contract and intake-server TypeScript checks.
- Frontend tests: 25 passed; contract tests: 12 passed; server tests: 41 passed.
- Frontend lint, cross-application readability lint and seven readability-rule fixtures.
- Generated-contract/client drift check and production build.
- Full repository Prettier and Markdown lint gates, plus `git diff --check`.

The build emits one minified JavaScript chunk of 564.29 kB (172.60 kB gzip), with Vite's 500 kB warning. No splitting/runtime framework was added for this refactor. Backend source is unchanged; this owner did not independently rerun Python or the full PostgreSQL/process suites.

## Actual browser checks

Browser-harness used the existing local Chrome with recordings disabled. Screenshots were inspected directly; the current palette and responsive component layout remain intact.

The existing Capture-only service served this owner's production build during an exclusive asset window. Its original ignored asset directory was preserved by rename, then restored by rename; every original file hash matched afterward. No service restart, source/staging change or retained database write was needed. Native title entry, blocked Batches navigation and explicit discard preserved the accepted revision and human input. The [desktop](../bench-intake/evidence/server-state/capture-desktop.png), [dirty navigation](../bench-intake/evidence/server-state/capture-dirty-navigation.png) and [390 px layout](../bench-intake/evidence/server-state/capture-narrow.png) show this result. That service lacks Manual endpoints and truthfully displayed Activity unavailable; it does not qualify Manual polling.

A separately allocated compatible Manual fixture used the existing owned PostgreSQL service, fresh random database/roles, synthetic credentials and its owned fake. It started only the web process, with no scheduler or runner. Native selection included Packet A alone; explicit review and preparation produced the [frozen preview](../bench-intake/evidence/server-state/manual-preparation.png). No approval or queue action was taken.

Stopping that fixture's web process caused real polling failures. The [unavailable view](../bench-intake/evidence/server-state/manual-unavailable.png) retained the exact preview and pinned preparation URL while disabling approval. Restart and the next periodic read restored availability without replacing that identity. Reload retained the same preparation. The [390 px approval view](../bench-intake/evidence/server-state/manual-narrow.png) had no horizontal overflow. The fresh fixture was disposed completely: web, fake, temporary authority files, roles and random database. Historical Manual namespaces were untouched.

The [browser receipt](../bench-intake/evidence/server-state/browser-checks.json) records the boundaries. No real inventory request or personal provider/inventory credential was used.

## Interface for subsequent owners

Use the existing shared scope and direct TanStack Query API:

```tsx
const scope = useServerScope()
const statusQuery = useQuery({
  queryKey: serverQueryKey(scope, 'domain-name', batchId),
  queryFn: () => validatedClient.readStatus(batchId),
  refetchInterval: RETAINED_POLL_INTERVAL_MS,
})
```

This is an illustrative read shape, not a new domain client. Name resource keys consistently; keep accepted revisions, drafts, questions and command identities outside query data. Treat both `isError` and `fetchStatus === 'paused'` as unavailable for freshness-sensitive controls. If a component shows warm cache before a fresh mounted read, verify `isFetchedAfterMount` before enabling commands. Avoid mutation retries and side effects driven by cache refresh.

## Remaining review gate

The coordinator must obtain a fresh independent exact-head review and selected CI before merging the ready PR into `interactive-app`. This owner does not merge its own PR. Any review fixes need their actual checks and final head recorded here. Subsequent media/processing owners should consume this seam only after the actual merge.
