# Frontend code guidelines

Read this file and the [shared guidelines](../CODE_GUIDELINES.md) before writing, changing or reviewing frontend code, and follow the [frontend architecture](ARCHITECTURE.md). These rules cover React/TypeScript/Vite; conventions do not establish an implemented capability.

## Components and state

Use function components and hooks, semantic HTML, PascalCase component/type names and camelCase functions/values. Name handlers for their interaction.

**Mitch's required direction:** each React component belongs in its own TSX file under `frontend/src/components/`, grouped by responsibility (for example `batches`, `capture`, `ui`). Keep component and style ownership apparent when moving or splitting existing UI.

- Keep components cohesive around visible responsibilities. Extract for clearer UI/state ownership or independent behavior, never to meet a line count or wrap every element.
- Keep state minimal and immutable; derive display values during render. Use updater functions when changes depend on prior state and stable lifetime keys for lists. Filenames are not unique IDs.
- Render purely; do not start requests, write files or mutate external state during render. [Effects](#effects) covers where that work goes instead.
- Separate transient UI IDs from domain/source/inventory identity. A selected File list is not an approved executable import.

## Effects

An Effect is an escape hatch for keeping a component synchronized with something outside React: a DOM or window listener, a timer, a socket, or a non-React widget. If no external system is involved, the code does not need an Effect. An unnecessary Effect costs an extra render, shows stale values for a frame and hides why the code runs.

Decide by asking why the code runs. Code that runs because the component is on screen belongs in an Effect. Code that runs because the operator did something — clicked, typed, submitted, dropped a file — belongs in that event's handler, because only the handler knows which interaction happened.

| When you need to… | Do this | Not this |
| --- | --- | --- |
| Show a value computed from props or state | Compute it during render. Add `useMemo` only when measurement shows the calculation is expensive; this app does not use React Compiler. | A second state variable kept in sync by an Effect. |
| Start fresh when the subject changes (another batch, lot or question) | Give the component that owns the state a `key` from that identity, as `Batch` does for `CaptureWorkspace`. | An Effect that resets each state variable after the identity prop changes. |
| Keep a selection valid when the list changes | Store the selected ID and look up the item during render. Adjusting state during render from a stored previous value is a last resort. | An Effect that clears or replaces the selected object. |
| Run logic for a user action | Do it in the handler. When several handlers share it, extract a plain function and call it from each. | Setting a flag in state and reacting to it in an Effect. |
| Update several values after one action | Compute every next value in the handler that caused it; state read inside a handler is the previous render's snapshot. | A chain of Effects where each sets state that triggers the next. |
| Have a child react to an action taken elsewhere | Await the command's result in the handler that sent it, or hold the request as state naming its target (such as which lot to open for editing) and clear it once handled. | A counter or signal prop the child watches in an Effect, which fires again whenever the child remounts. |
| Tell a parent about a change | Call the parent's callback in the same handler that updates local state, or lift the state up and make the child controlled. | An Effect that watches local state and then calls the parent. |
| Give a parent data a child loaded | Read it in the parent (or a shared query) and pass it down. | A child that loads data and pushes it up from an Effect. |
| Follow a browser API or external store | Wrap `useSyncExternalStore` in a custom hook, as `components/ui/useMediaQuery.ts` does. Keep `subscribe` stable, at module scope or memoized on its inputs, so React does not resubscribe on every render. | `useState` plus a hand-written subscription Effect. |
| Read server data | Use TanStack Query, as described in [server reads](#server-reads-and-command-authority). | A fetch in an Effect. |
| Run app setup once | Call it explicitly from `main.tsx`. Keep import-time setup to entry modules, so importing a component never starts work. If setup must wait for mounting, guard a root Effect with a module-level flag. | An unguarded top-level `useEffect(..., [])`, which runs twice in development. |

The navigation guard is the main case of telling a parent: report unsaved changes from the input event, as [form editing](#form-editing) requires. An Effect may still report clean when the editor unmounts. Hold the callback in a ref so that a new parent callback receives the current state rather than a premature clean report; `operator/useDirtySources.ts` shows the pattern for several sources, and `navigation/useReportDirty.ts` for a single editor.

When an Effect is the right tool:

- Name the external system it synchronizes, in code or a short comment when that is not obvious.
- Return a cleanup that undoes the setup: remove listeners, clear timers and close connections.
- Make it safe to run twice. `main.tsx` renders under StrictMode, which mounts, cleans up and remounts every Effect in development.
- List every reactive value it reads (props, state and values computed from them) in the dependency array. Ref contents are not reactive and stay out. `react-hooks/exhaustive-deps` enforces this for Effects, memos and callbacks, and `react-hooks/rules-of-hooks` keeps hooks unconditional. Never disable `rules-of-hooks`. Disable `exhaustive-deps` only on one line, with a comment saying why the list cannot be complete, and keep a deliberately narrowed list by reading values through a ref rather than leaving them out. When an object or function created during render forces the Effect to rerun on every render, move it inside the Effect if only the Effect uses it.
- Ignore stale async results. If an Effect awaits work that is not a TanStack Query, set a cancelled flag in cleanup and drop results that arrive after it, so an older response cannot overwrite a newer one.
- Move it into a named custom hook when the same synchronization appears in more than one component.

## Server reads and command authority

Use TanStack Query for shared server reads and polling through the validated client façades. Use `useServerScope()` and `serverQueryKey()` so private reads include origin, actor, target and target context. Keep timers, retry and refetch policies explicit; do not add a parallel effect-based cache or a generic query framework.

Avoid treating cached data as a loaded revision, approved preparation or permission to command. Keep form drafts, selections and payload-bound recovery intents in their domain owners. A refresh must not reset a draft, silently rebase a conflict or replace a pinned preparation. Cached previews need mounted-read verification before freshness-sensitive commands; failed and paused reads must show unavailable status even when prior data remains visible.

Do not use mutation retries, effects or cache refreshes to approve, queue, recover or invent delivery keys. Distinguish confirmed command results from failed subsequent reads. Clear private caches when scope lifetimes change, and describe cache cancellation honestly when a client does not accept AbortSignal.

## Form editing

Use React Hook Form for substantive forms instead of duplicating field values, touched/dirty state and submission flags across many state hooks. Register native inputs directly; adapt composite controls with Controller. Keep simple transient controls local when a form abstraction adds no clarity. Keep components and command construction focused rather than hiding a large workflow in a form hook.

Keep TypeBox/AJV contracts authoritative; do not introduce another schema vocabulary solely for a form. Preserve exact quantity and identifier strings. Never use numeric coercion for those fields.

Default values belong to the explicitly selected editor/context. Do not reset from polling or enable automatic reinitialization that discards human input. A newer revision or stale question requires explicit conflict handling. Form state does not establish server authority, approval identity or idempotency.

Report meaningful unsaved changes synchronously from input events to the app navigation guard. Do not rely only on a later effect observing isDirty. Preserve the stable payload/delivery key after an uncertain acknowledgement; clear the guard only after confirmed save/create or explicit discard. Verify keyboard/native validation, dirty navigation, conflict preservation and retry behaviour after a form conversion.

## Readable rendering and interactions

- Format JSX so controls, props and content can be scanned independently. Do not compress entire queues/forms/panels onto a line. Name props types when inline types obscure the contract.
- Keep simple render expressions and single-action handlers inline. Name multi-step/async handlers so pending state, validation, awaited work, errors/conflicts and cleanup read in order.
- Name complex selection/status values rather than nesting ternaries or repeating lookups in markup. Extract queues, context panels or editors where that clarifies responsibility, preserving shared state and explicit save/conflict behavior.
- Follow shared statement/declaration and branch rules. Inspect `pnpm format` output; it does not separate coupled responsibilities.

## TypeScript and external data

Keep strict checking and precise named types. Narrow external `unknown` values through validation. Avoid broad `any`, casts and non-null assertions that bypass unresolved contracts; explain narrow exceptions.

Distinguish loading, failure, empty and success states. Separate transformation, presentation and effect ownership.

Types and file-input accept filters are not security boundaries. Upload/API work needs explicit content, size, error, cancellation and ownership contracts; a convention alone does not provide them.

## Interaction, styling and safety

Use labels, semantic controls, accessible names and keyboard behavior. Keep status/errors visible beyond color; preserve responsive layouts and avoid unnecessary motion.

**Mitch's required styling direction:** use styled-components and colocate component-owned styles in its TSX file. Declare styled components at module scope; use transient props for styling-only values. Keep global styles limited to reset/root concerns. Preserve the current palette/layout during migration and avoid unrelated global effects.

Treat filenames/external text as untrusted React text. Do not render raw HTML or expose secrets through browser bundles, logs, fixtures or Vite variables. Root `.env` belongs to backend runtime discovery.

Keep capability labels truthful. Buttons and success states must not imply upload, parsing, approval or inventory effects before implementation.

## Tooling and tests

Frontend owns its dependencies/scripts; pinned pnpm updates the root lockfile. Add no second lockfile or Python dependency. Other routing/state/component frameworks need demonstrated requirements and an explicit engineering decision.

For frontend behavior changes, run from root:

- `pnpm typecheck`
- `pnpm lint:frontend`
- `pnpm test:frontend`
- `pnpm build`

Use `pnpm install --frozen-lockfile` when verifying dependency reproducibility. Qualify formatting of TSX and styled tagged templates with the owning config; do not change generator byte policies to format component styles.

Tests should exercise visible behavior through roles, labels and realistic interactions. Mock external boundaries without replacing the feature; include cancellation/error cases. Browser/visual checks remain separate from jsdom evidence.

Update owning architecture/README with behavior changes and distinguish implementation from proposals. Docs-only edits need link/consistency checks, not repeated runtime tests. Apply the shared Markdown readability rules to frontend documentation.

## References

- [React rules: components and hooks must be pure](https://react.dev/reference/rules/components-and-hooks-must-be-pure)
- [React: you might not need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html)

## Explicit readability checks

Apply the shared [patterns to avoid](../CODE_GUIDELINES.md#patterns-to-avoid) to component, hook and client code. Use named prop/domain types; separate data normalization from rendering; make asynchronous and error states explicit rather than hiding them in nested expressions.

Leave blank lines between functions and handlers. `pnpm lint:frontend` includes the shared readability rules; run `pnpm lint:readability` and `pnpm test:readability` for the cross-application check and its fixtures. Extract a meaningful component, hook or operation when responsibilities diverge; do not split solely to meet a line quota.
