# Frontend code guidelines

Follow the [shared guidelines](../CODE_GUIDELINES.md) and [frontend architecture](ARCHITECTURE.md). These rules cover React/TypeScript/Vite; conventions do not establish an implemented capability.

## Components and state

Use function components and hooks, semantic HTML, PascalCase component/type names and camelCase functions/values. Name handlers for their interaction.

**Mitch's required direction:** each React component belongs in its own TSX file under `frontend/src/components/`, grouped by responsibility (for example `batches`, `capture`, `ui`). Capture owns the implementation migration; this guideline does not claim it has merged.

- Keep components cohesive around visible responsibilities. Extract for clearer UI/state ownership or independent behavior, never to meet a line count or wrap every element.
- Keep state minimal and immutable; derive display values during render. Use updater functions when changes depend on prior state and stable lifetime keys for lists. Filenames are not unique IDs.
- Keep user-triggered effects in handlers. Render purely; do not start requests, write files or mutate external state during render.
- Use effects only to synchronize external systems, with cleanup/cancellation. Do not maintain redundant state with effects.
- Separate transient UI IDs from domain/source/inventory identity. A selected File list is not an approved executable import.

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
