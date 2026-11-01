# Shared code guidelines

Apply these rules to new and changed code. Read [ARCHITECTURE.md](ARCHITECTURE.md) and the owning application's guidelines: [backend](backend/CODE_GUIDELINES.md), [frontend](frontend/CODE_GUIDELINES.md) or [intake server](intake-server/CODE_GUIDELINES.md).

Improve the code you touch proportionately. A focused task does not authorize an unrelated rewrite; application documents own language/framework details.

## Plan before implementation

Write a task-specific plan in the owning handover **before implementing anything**. Read the relevant code/contracts, then record:

- Scope, non-goals, affected files and public interfaces.
- Dependencies, ownership and meaningful alternatives.
- Package research and rationale.
- Implementation steps and independent verification, including adverse cases.

Update the plan as evidence changes. If this rule arrives mid-task, preserve existing work and record the actual chronology and remaining plan; never backdate it. Planning adds no human approval gate where autonomous work is already authorized.

Prefer existing helpers, public framework APIs and suitable maintained packages. Before adding a dependency, assess its required guarantees, compatibility, maintenance, licensing/security and dependency cost using authoritative sources or versioned APIs. Record what is proved and what remains untested.

No package is required for trivial logic. Do not substitute a library list for research or rewrite qualified code without a reason. Explain custom policy that packages cannot own, especially exact bytes, payload-bound idempotency and protected-target authority.

## Readability and responsibility

- Use domain names, explicit control flow and units where needed. Explain constraints/tradeoffs; remove stale comments and obsolete callers.
- Give functions, components and modules coherent responsibilities. Extract meaningful operations or effects, not arbitrary line counts. Keep cohesive schemas/tables together when splitting obscures the contract.
- Separate parsing, validation and decisions from filesystem, network and UI effects. Keep orchestration at one level of detail, with validation, effects and recovery order visible.
- Pass dependencies/configuration explicitly. Define state/resource ownership and lifetime; avoid hidden globals, circular dependencies, catch-all helpers and imports that start work.
- Prefer composition. Add abstractions for concrete callers, and keep helpers at the narrowest owning boundary. Share policy through intentional interfaces rather than copying it or importing presentation into lower layers.

## Readable TypeScript

Run `pnpm format`, then `pnpm format:check` before review. Editor and hooks use the same config; generated contracts, preserved evidence and immutable migrations retain their byte policies. Formatting cannot fix unclear names or mixed responsibilities.

- Write one statement and variable declaration per line. Use braces for branches/loops, including early exits. Avoid compressed callbacks, nested ternaries and joined assignments/declarations.
- Name intermediate values that explain domain decisions or asynchronous results. Separate query results from row selection, mapping and fallback when combining them obscures behavior. Keep trivial expressions inline.
- Extract named operations when callbacks/functions mix validation, persistence, transport and projection. Preserve visible transaction, authorization and uncertain-effect ordering; validate altered boundaries as behavior changes.
- Let the formatter expand argument lists, objects and types. Write substantial SQL as readable multiline templates with named results and parameter arrays easy to compare with placeholders. Never rewrite immutable migrations or exact request/approval bytes for appearance.
- Review conceptual density after formatting. Extract by responsibility with explicit inputs/results, without line quotas or helpers that hide state in closures.

### Separate declarations and responsibilities

Leave a blank line around function declarations, function-valued variable declarations and class/object methods. Keep overload signatures with their implementation, and separate the logical phases inside a function. A formatter passing does not establish readable structure.

Review functions that require holding several unrelated stages in memory. Split at meaningful boundaries such as validation, authority lookup, input materialization, persistence, transport and projection. Keep the order visible; do not replace a long function with tiny wrappers or a helper that secretly owns all its state.

### Checked rules and review boundaries

Run `pnpm format:readability`, then `pnpm format` to apply the maintained readability fixes and formatting. Run `pnpm lint:readability` for shared runtime TypeScript and `pnpm test:readability` for the rule fixtures. The same maintained ESLint rules run through frontend lint, local hooks and selected TypeScript CI. They enforce branch braces, separate variable declarations, blank lines around callable declarations and blank lines around class methods. TypeScript overload signatures stay with their implementation.

Generated contracts, exact vectors, preserved fixtures, immutable migrations and design references are excluded from this source-style check. Their owning validation still applies. The check does not inspect object-method spacing or infer whether a function has too many responsibilities: reviewers must check those explicitly. A green formatter/linter is necessary, not sufficient.

### Patterns to avoid

- **Positional or indirect API types**, such as `Parameters<typeof answerQuestion>[6]`. Use a named domain type such as `ProcessingAnswerDto`, so a reader can understand the argument without counting another function's parameters.
- **Type guarantees that exceed validation**, such as a generic `unseal<T>` that verifies a hash and parses JSON before returning `value as T`. Return `unknown` until shape and domain checks establish the type, or provide a named decoder that performs those checks. Integrity and schema validation are different guarantees.
- **Compound guards that mix unrelated decisions** or hide policy in nested ternaries. Give distinct checks meaningful names or explicit guard clauses, preserving authorization, lock and effect ordering. Keep simple conditions inline.
- **Deep projections over raw database rows** that combine relationship lookup, defaults, validation and DTO construction in nested `map`/`filter` expressions. Build named indexes and focused projections when needed; avoid repeatedly changing what a generic `row` or `value` represents.
- **HTTP handlers that mix authorization SQL, filesystem/blob work and response policy**. Use owning repository/service interfaces for authorized object lookup and keep the handler's request/response orchestration apparent. Make materially different download or effect cases explicit.
- **Error-message matching and catch-all failure classification** that can turn infrastructure faults into malformed user input or successful absence. Use typed/tagged domain errors, explicit known cases and a distinct unexpected-failure path; preserve causes and retained outcomes.
- **Unexplained numeric limits or units**, such as `86400000` or `245760` inside business logic. Name consequential policies with their units, such as `MIN_GC_AGE_MS` or `MAX_SNAPSHOT_BYTES`, and explain the reason when it affects safety or supported scope.

These are review requirements for new and changed code. Fix the relevant occurrences before submission; document a concrete exception when keeping a cohesive expression or declaration is clearer. Do not turn the examples into arbitrary line-count quotas or a mandate for unrelated refactoring.

## Contracts, effects and failures

- Validate untrusted data at boundaries; types/casts do not validate runtime input. Distinguish missing, invalid, empty and unavailable values. Document units, output shapes, effects and limits.
- Report failures at their owning response boundary. Preserve causes and known outcomes; never turn failed lookups or partial work into success. Release resources deliberately on failure/cancellation.
- Validate before dependent effects. Retain stable identities and distinguish planned, attempted and confirmed outcomes. Never blindly replay unknown writes or claim atomicity across local and remote effects.
- Bound waits, retries and concurrency. Define ownership, cancellation, rate budgets and failure propagation before adding workers. Optimise measured bottlenecks.
- Discover portable paths from explicit input/configuration/runtime context. Preserve caller-cwd meaning and state namespaces unless explicitly migrating them; never embed developer checkout/home/temp paths.
- Keep secrets out of exports, source, fixtures, logs and errors. Private source facts belong only in approved access-controlled inputs/outputs under their retention policy. Use safe identifiers; do not leak facts through unrelated exports or diagnostics.

## Testing and tools

- Test observable behavior and meaningful failures, not implementation copies or prose. Add regressions for behavior changes; docs-only edits need reference/consistency checks.
- Use controlled clocks/data, owned temporary files and fake/local services. Make live/hardware requirements explicit; skips and fake evidence do not prove production guarantees.
- Mock external boundaries without removing the behavior under test. Exercise real serialization/adapters against isolated targets when their behavior matters.
- Follow declared versions, lockfiles and configured checks. Add tools only for demonstrated correctness/maintenance benefits; document pins/compatibility and avoid unrelated formatting or competing formatters.
- Run the owning application checks and [AGENTS.md](AGENTS.md) requirements. Root pnpm commands delegate to applications. Report failures, skips and limits honestly.

### Standalone Node tools

Use `.cjs` for new standalone Node utility, maintenance, validation and qualification commands **outside application runtime and tests**. It selects CommonJS independently of `type: module` and runs directly on Node without an application build/loader.

This rule excludes tests/fixtures (including CJS utility tests), frontend/runtime TypeScript, Python/shell and established framework ESM config. Keep their owning conventions. Declare and pin packages even for standalone tools.

If a utility consumes application TypeScript through pinned Node's native type stripping, document that source boundary. Do not add a second loader or duplicate contracts for the utility.

## Documentation and review

### Make Markdown readable

Lead with the document's purpose and current status. Give each paragraph one connected idea; separate prerequisites, actions, outcomes and exceptions when they need different attention. A paragraph that is hard to scan needs editing, not fixed-width wrapping.

Use descriptive headings for distinct topics, lists for parallel rules or ordered steps, and tables for real comparisons. Prefer direct verbs and specific nouns. Remove repeated explanations while keeping the owning rule explicit; retain necessary qualifications rather than burying them in a long sentence.

For example, replace “Cancel the run; an authorized request may finish, cancellation is not rollback, and inspect retained effects before recovery” with:

> Cancel the run to stop new dispatch. Cancellation does not roll back an already authorized request.
>
> Before recovery, inspect the retained effects; an in-flight request may have finished.

Use paragraph size as a review signal, not a word quota. Check the rendered reading order and whether headings, lists or tables clarify it. Do not fragment connected prose into one-sentence sections or turn every sentence into a bullet.

### Preserve source and meaning

Write each paragraph/list item on one source line and rely on soft wrap. Preserve list nesting, code blocks, tables, frontmatter, raw HTML, intentional hard breaks and semantic whitespace. Use Markdown-aware tooling and verify meaning after reflow.

Keep shared architecture/guidance at root and application contracts in their owning documents. Audit active links and anchors when moving sections. Preserve historical evidence and the distinction between plans, observed behavior and untested capability; put investigation/validation records in handovers.

Keep mirrored skills/host-adapted agents synchronized per AGENTS. Use relative paths and named skills, never machine-specific config.

### Publish focused changes

Use Conventional Commits (`type(scope): description`) and conventional `type/short-kebab-case-description` branches. The user-named `interactive-app` trunk is the deliberate exception.

Describe the problem, behavior, alternatives, plan changes, validation and limits. Obtain independent review before publication when the initiative requires it; passing tests never grant merge permission.
