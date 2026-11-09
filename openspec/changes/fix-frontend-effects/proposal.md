# Change proposal

## Problem and intended outcome

PR #180 added an "Effects" section to `frontend/CODE_GUIDELINES.md` and audited every `useEffect` in the frontend against it. The audit found Effects that report unsaved changes late or never release the navigation guard, commands sent from Effects, server reads hand-rolled in Effects, state copied into state, and two verified bugs:

- After the operator presses E once in Review › Lots, J and K stop moving between lots, because every later lot opens with its quick editor focused.
- A clean record draft flickers dirty for one render when its saved value changes, briefly disabling Archive.

This change fixes those findings so each Effect is either an external-system synchronization with correct cleanup, or replaced by a handler, a render-time derivation or a TanStack Query read. Operators see the J/K fix and the end of the flicker; everything else keeps its visible behaviour while becoming reliable at the edges, such as unmounting mid-edit, reconnecting mid-read, or a parent replacing a callback.

## Change identity and linked items

The change name is `fix-frontend-effects`. Its branches are `fix/fix-frontend-effects-dirty`, `fix/fix-frontend-effects-commands` and `fix/fix-frontend-effects-sync`, and its subjects use `fix(fix-frontend-effects): …`.

Linked items: None. This is maintenance prompted by the #180 audit, not a planned feature in `docs/PLANNED_FUNCTIONALITY.md`.

## Current behavior and evidence

The audit's 35 findings are listed by number in `tasks.md`, with the file each one names. Two were verified by reading the code before planning:

- `components/operator/DecisionPanel.tsx` opens the quick editor from an Effect on `editSignal`. `ReviewWorkspace` keeps that signal as a counter that is never reset and remounts the panel per lot (`key={lot.id}`), so the Effect fires on every mount after the first E press. Focus lands in the quantity input, and the keyboard handler ignores J and K there.
- `components/review/records/draft.tsx` `useDraft` compares the previous draft with the new saved value on the first render after a save, reports dirty, then reports clean on the next render.

The remaining findings are recorded as the audit stated them. Each task re-reads the code first, and a finding that turns out wrong is dropped and recorded in `notes.md` and the PR.

This change builds on three refactors stacked beneath it: shared hooks (#181), API clients context (#182) and batch commands context (#183). Audit item 29 (`useOnline`, `useNow`, foreground refresh) was largely delivered by #181; only `LiveUpdates` adopting `useOnForeground` remains.

## Scope and non-goals

In scope: the audit items assigned to E1, E2 and E3 in `tasks.md`, with a regression test for each fix and test coverage for every changed file that has none.

Non-goals:

- Effects the audit marked KEEP, such as sockets, ResizeObserver/Moveable, three.js, focus management and the documented architecture latches.
- New features, visual changes beyond the J/K fix, or changes to server contracts.
- Adding React Compiler or a new state library.

Constraints that every fix keeps, from `frontend/ARCHITECTURE.md`: pinned snapshots and preparations stay pinned, newer saved values are adopted only while an owner is clean, retained payload-bound intents keep their keys, and the navigation guard reports dirty synchronously and clean only on unmount or confirmation. A finding whose fix would break one of these is dropped.

## Reuse and dependency assessment

No new dependency is needed; the installed stack covers every fix.

| Option and relevant version | Goal fit and strengths | Limitations, risks and total adoption cost | Primary evidence and date checked | Unknowns / proof of fit |
| --- | --- | --- | --- | --- |
| React 19.3.1 (`useSyncExternalStore`, callback refs with cleanup, render-time state adjustment) | Covers browser-state subscriptions, measured refs and derived drafts without Effects | Render-time adjustment needs care to avoid loops; guarded per the React docs | `frontend/package.json`; react.dev "You might not need an Effect" and "useSyncExternalStore", 2026-11-09 | None; already used by `useMediaQuery` and #181's hooks |
| TanStack Query 5.105.1 | Replaces hand-rolled polling and debounced reads with shared, scoped, cancellable queries | Query keys must include server scope; failed reads must still show unavailable | `frontend/package.json`; existing `queries/scope.ts` and `useHeaderObservations`, 2026-11-09 | Whether `useCatalogue.search` can pass an AbortSignal; recorded as a limit if not |
| React Hook Form 7.91.0 `watch` subscription | Already the source of draft-generation invalidation | Subscription remains an Effect, which the guidelines allow for an external store | `frontend/package.json`; `BulkEditPanel.tsx` | None |
| Custom helpers (`useMountedRef`, `useDraftGeneration`, `useDevicePixelRatio`) | Each removes a copied pattern in this codebase | Small surface; tested directly | Audit items 30, 32, 33 | None |

## Impact

The frontend only. Many components under `frontend/src/components/` and a few hooks change. Tests are added or extended for each fix. `frontend/ARCHITECTURE.md` changes where a described mechanism changes.
