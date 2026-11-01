# Frontend code guidelines

Follow the [shared guidelines](../CODE_GUIDELINES.md) and
[frontend architecture](ARCHITECTURE.md). These rules apply to React/TypeScript/Vite
code; they do not imply a backend integration exists.

## Components and state

- Use function components and hooks for the current React application. Name
  components/types with PascalCase, functions/values with camelCase and event
  handlers for the interaction they own. Prefer semantic HTML before abstractions.
- Keep components cohesive around a visible responsibility. Extract a component
  when it clarifies UI/state ownership or has meaningful independent behavior;
  do not turn every element into a wrapper or split merely for a line count.
- Keep state minimal and derive display values during render. Treat state as
  immutable and use updater functions when changes depend on prior state. Give
  list entries stable UI keys for their lifetime; filenames are not unique IDs.
- Keep user-triggered effects in event handlers when appropriate. Rendering must
  be pure; do not start requests, write files or mutate external state during
  render. Use an effect only to synchronize with an external system, with cleanup
  and cancellation where needed. Do not use effects to maintain redundant state.
- Keep transient UI IDs distinct from domain/source/inventory identity. Do not
  promote the scaffold's selected File list into an approved executable import.

## TypeScript and external data

- Keep strict TypeScript checking. Prefer precise named types and narrow unknown
  external values through validation. Avoid broad any/casts/non-null assertions
  that bypass an unresolved input contract; document necessary narrow exceptions.
- Model loading, failure, empty and successful states distinctly when they exist.
  Keep data transformations separate from presentation and effect ownership.
- Type annotations and file-input accept filters are not validation or security
  boundaries. Any future upload/API integration needs explicit contracts for
  content, size, errors, cancellation and ownership; none exists in the scaffold.

## Interaction, styling and safety

- Use labels, semantic controls, useful accessible names and keyboard behavior.
  Keep status/error text understandable and visible; do not communicate state only
  through color. Preserve responsive layouts and avoid unnecessary motion.
- Keep styles in the existing application stylesheet until actual reuse justifies
  another boundary or tool. Avoid global changes with unrelated visual effects.
- Treat rendered filenames and external text as untrusted. Use React text rendering;
  do not introduce raw HTML or expose credentials in the browser bundle, logs,
  fixtures or Vite variables. Root `.env` belongs to backend runtime discovery.
- Preserve honest scaffold labels. Do not add buttons or success states that imply
  upload, parsing, approval or inventory writes without implemented behavior.

## Tooling and tests

- Frontend dependencies/scripts belong in this package; update the root pnpm lock
  through the pinned package manager. Do not add a second lockfile or Python
  dependency here. Avoid a routing/state/component framework without demonstrated
  application needs and an explicit engineering decision.
- From repository root run `pnpm typecheck`, `pnpm lint:frontend`,
  `pnpm test:frontend` and `pnpm build` for frontend behavior changes. Use
  `pnpm install --frozen-lockfile` to verify dependency reproducibility when needed.
- Component tests should exercise user-visible behavior through roles, labels and
  realistic interactions. Mock external boundaries without replacing the feature;
  test cancellation/error paths when an effectful integration is introduced.
  Keep basic browser/visual checks separate from jsdom evidence.
- Update the owning architecture/README when behavior changes, and distinguish
  implemented behavior from proposed interfaces. Do not repeat full runtime checks
  for a documentation-only move; verify links and shared workflow consistency.

## References

- [React rules: components and hooks must be pure](https://react.dev/reference/rules/components-and-hooks-must-be-pure)
- [React: you might not need an Effect](https://react.dev/learn/you-might-not-need-an-effect)
- [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
