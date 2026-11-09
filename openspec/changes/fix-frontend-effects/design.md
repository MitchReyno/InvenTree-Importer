# Design assessment

## Context and grounding

The affected code is the React frontend under `frontend/src/`. The rules come from the "Effects" section of `frontend/CODE_GUIDELINES.md` (#180) and the form-editing rule that unsaved changes are reported synchronously from input events. The constraints come from `frontend/ARCHITECTURE.md`.

Three refactors stacked beneath this change provide the building blocks:

- `navigation/useReportDirty` releases the guard on unmount through a ref, and gives a replaced callback the current state (#181).
- `browser/useOnline`, `browser/useNow` and `browser/useOnForeground` (#181).
- `useApiClients()` (#182) and `useBatchCommands()` (#183) replace client and command props.

The change is broad but shallow. Each finding is local to one or two components, and the fixes reuse a handful of patterns. Existing architecture suffices; the decisions below are about which pattern each kind of finding uses.

## Goals and constraints

Goals are in `proposal.md`. Every fix must keep these documented constraints:

- Drafts are never reset by polling or a newer revision; newer saved values are adopted only while an owner is clean.
- Pinned questions, preparations and accepted operator-review projections stay pinned.
- Retained payload-bound intents keep their key until confirmed or explicitly discarded.
- The navigation guard hears dirty synchronously from input events, and clean only on unmount, confirmation or explicit discard.

## Decisions and alternatives

### Report dirty from the event that changes it

Each editor calls its `onDirtyChange` in the input or command handler that changes the draft, computing the next value there. `useReportDirty` covers unmount and a replaced callback.

A report-on-change Effect stays only where the change has no event in the component, and the reason is commented:

- `TellExamine`, whose form hides when a poll changes session visibility.
- A saved value catching up with a dirty draft, which makes it clean with no event in the component: `useDraft`, `EvidenceGroup` and `InstructionField`.

The React Hook Form editors report from the form's `onChange`, comparing the values with their baseline, so typing a value back reports clean from the event.

Alternative rejected: a shared hook that reports every change from an Effect. That is the pattern the guidelines name as "not this", and it reports one render late.

### Derive drafts instead of copying props into state

A draft that follows a saved value is stored as a nullable draft (`{ value: T } | null`, so `T` may itself be null), where `null` means "following saved". The rendered value is the draft's value, or `saved` when there is none, and dirty is computed in render. This removes the copy Effect and its one-render flicker. It also enforces "never replace a dirty draft" by construction, because a newer saved value only shows through while the draft is `null`.

Alternative rejected: keying the editor by the saved revision. That would drop a dirty draft and its focus, which the architecture forbids.

### Send commands from the handler that caused them

A command that follows another command awaits the first one's result in the same handler. One example is linking media to a newly created lot. To make that possible, `Batch`'s `edit` resolves with the accepted snapshot (or `false`), so the handler can find the new lot without waiting for an Effect to see it in props. This extends `BatchCommands.edit` from #183.

Confirmation that closes an editor also moves into the awaiting handler, including the retained-retry path.

Alternative rejected: keeping the pending-ref Effects with comments. They resend with fresh keys from render-driven timing, which the command-authority rules forbid.

### Server reads and browser state through their owning APIs

- Polling and debounced searches become TanStack Query reads, keyed with `serverQueryKey(scope, …)`, so reads are shared, cancelled and shown as unavailable when they fail.
- Browser values (device pixel ratio, media queries) use `useSyncExternalStore` with a stable `subscribe`.
- A DOM measurement that only needs a node uses a React 19 callback ref with cleanup instead of a dependency-less layout Effect.

### Small shared hooks only where code is copied

The audit lists four copies of a mounted-flag ref and two copies of a React Hook Form `watch` subscription. These become `useMountedRef` and `useDraftGeneration`. No other new abstractions are added.

## State, authority and failure behavior

- **Navigation guard:** handlers report the computed next dirty state. `useDirtySources` aggregates multiple sources, and its ref pattern releases on unmount. The `ExamineView` corrections use it instead of a copy.
- **Commands:** keys stay bound to their payload. An uncertain acknowledgement keeps the exact retry path. A follow-up command is only sent after the first is confirmed.
- **Batch settings reconnection:** each run of the reconnection Effect sets a cancelled flag in its cleanup, so a read that started before a disconnect is dropped and the next connection issues a fresh one. Reconnection always reads current state before admitting writes, and a failed read retries on a timer that the cleanup clears (audit item 15).
- **Reads:** failed or paused queries show unavailable even with cached data, per "Server reads and command authority".

## Verification strategy

Each fix gets a regression test in Vitest with Testing Library, written to fail first where the behaviour changes. Typical shapes:

- a navigation-guard assertion with no `waitFor`, proving the report is synchronous;
- an unmount-while-dirty assertion;
- fake-timer tests for reconnection, polling and debounce;
- a keyboard test for J/K after E.

Files changed by a fix that have no test file get one (Mitch's requirement, 2026-11-09).

`Dialog`'s focus return under StrictMode depends on inertness, which jsdom does not model. It is checked in a real browser and recorded as manual evidence.

Owning checks for every PR: `pnpm format:readability`, `pnpm format`, `pnpm lint:readability`, `pnpm typecheck`, `pnpm lint:frontend`, `pnpm lint:unused`, `pnpm test:frontend` and `pnpm build`.

## Migration, rollout and recovery

None apply. This is a frontend-only change with no stored data, contracts or deployment steps. Each PR can be reverted independently in stack order.

## Risks and open decisions

- **Render-time state adjustment can loop if a guard is wrong.** Each use has a guard on the stored previous value and a test that rerenders with unchanged props.
- **Some audit findings are marked low confidence:** `EvidenceGroup` rename overwrite, the `MediaWorkspace` `unconfirmedMove` ref, and the redundant `ProcessingWorkspace` paused copy. Each is checked first and changed only with evidence, otherwise dropped in `notes.md`.
- **AskControl counts an open form holding only its prefill as dirty (audit item 8).** Whether that is intended is undecided. The plan keeps the current behaviour and records the question in the PR rather than guessing.
