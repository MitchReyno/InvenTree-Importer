# Shared code guidelines

Apply these guidelines to new and changed code across the workspace. Read [ARCHITECTURE.md](ARCHITECTURE.md), then the owning application's [backend guidelines](backend/CODE_GUIDELINES.md) or [frontend guidelines](frontend/CODE_GUIDELINES.md) and architecture. Improve the code you touch proportionately; a focused change does not authorize an unrelated rewrite. Application documents own language/framework details.

## Plan before implementation

Every implementation agent must write a concise task-specific plan **before implementing anything**, tracked in its owning handover/task record. Read the relevant code/contracts first; record scope/non-goals, affected files/public interfaces, dependencies/ownership, meaningful alternatives and package research/rationale, ordered implementation steps, and independent verification including adverse/negative cases. Update the plan when evidence changes. If this requirement arrives during active work, preserve existing work, record the actual chronology and assess remaining work before the next implementation edit; never pretend a retrospective plan existed earlier. The plan is not an extra human approval gate where autonomous execution is already authorized.

Prefer existing repository helpers, framework public APIs and suitable maintained packages over bespoke frameworks. Before adding a dependency, assess the exact required behavior/API guarantees, version/toolchain compatibility, maintenance evidence and dependency/security/licensing cost using authoritative sources or actual versioned public APIs where needed; record what was qualified and what remains unproved. No mandate to add a package for trivial logic, no handwavy library list as research, and no artificial rewrite of already-qualified code. Explain narrow custom policy that packages cannot own, particularly exact bytes, payload-bound idempotency and protected-target authority.

## Readability and responsibility

- Use domain names and explicit control flow so decisions can be understood locally. Include units when ambiguity matters; explain constraints and tradeoffs rather than restating code. Remove stale comments and obsolete callers.
- Give functions, components and modules coherent responsibilities. Extract a helper when it names meaningful work, isolates effects or removes substantial duplication. Size is a review signal, not a quota; keep cohesive schemas/tables together when splitting obscures the contract.
- Separate parsing, validation and decisions from filesystem, network and UI effects. Keep orchestration at a consistent level of detail with visible validation, effects and recovery order.
- Pass dependencies and configuration explicitly. Make state/resource ownership and lifetime clear; avoid mutable global state, circular dependencies, catch-all helpers and imports that start work. Prefer composition and add abstractions only when concrete callers need them.
- Keep helpers at the narrowest boundary that owns their meaning. Share domain policy through an intentional interface rather than copying it into another application or pulling presentation into lower-level workflows.

## Contracts, effects and failures

- Treat external data as untrusted. Types and casts do not validate runtime input. Validate at boundaries and keep missing, invalid, empty and unavailable values distinct. Document units, output shapes, side effects and important limitations.
- Report failures at the boundary that owns their response. Preserve causes and known outcomes; do not convert failed lookups or partial work into success. Keep cleanup/resource release deliberate on failure and cancellation.
- Validate before dependent effects. Preserve stable identities and distinguish planned, attempted and confirmed outcomes. Never blindly replay an unknown write or claim atomicity across local files and remote services.
- Bound network waits/retries and concurrency. Define resource ownership, cancellation, rate budgets and failure propagation before adding workers. Optimise measured bottlenecks rather than speculative parallelism.
- Use portable paths from explicit input, configuration or deliberate runtime discovery. Never embed a developer checkout/home/temp path. Preserve caller-cwd meaning and state namespaces unless an explicit migration is part of the change.
- Never export credentials/secrets or include them in source, fixtures, logs or errors. Keep private source data within approved, access-controlled inputs and outputs; plans, provenance and status may intentionally contain source facts under their documented privacy/retention policy. Do not leak them through public exports or unrelated diagnostics. Use safe identifiers and deliberate channels.

## Testing and tools

- Test observable behavior and meaningful boundary/failure contracts, not copies of the implementation or incidental prose. Add regression tests for behavior changes; documentation-only moves need reference/consistency checks rather than invented runtime tests.
- Ordinary tests use controlled clocks/data, temporary owned files and fake/local services. Keep hardware/live integration requirements explicit. Do not infer production guarantees from fake evidence or count skipped checks as coverage.
- Mock external boundaries without mocking away the behavior under test. Exercise real adapters/serialization when their behavior matters, with isolated targets.
- Follow declared versions, configured lint/typecheck/test commands and lockfiles. Add tools/dependencies only for demonstrated correctness/maintenance benefits; document pins and compatibility limits. Avoid unrelated formatting churn or a second formatter introduced for one change.
- Run the appropriate application checks and [AGENTS.md](AGENTS.md) requirements. Root pnpm scripts delegate to the applications; app guidelines identify their checks. Report actual results, failures, skips and limits honestly.
- Use `.cjs` for new non-application Node/JavaScript tooling, maintenance, validation and qualification command scripts that are not used during application runtime. The extension unambiguously selects CommonJS regardless of a surrounding `type: module`, runs directly on Node without a separate TypeScript transpiler/runtime loader and avoids coupling one-off tooling to application/bundler module setup. This does not make a script dependency-free: declare and pin any packages it uses. Do not blanket-rename Python/shell scripts, application/runtime TypeScript, typed application test modules or established framework ESM configuration. If tooling must consume an application's TypeScript runtime contracts through pinned Node's native type stripping, document that deliberate source boundary; do not introduce a second loader or duplicate the contracts just for the script.

## Documentation and review

- Write each Markdown prose paragraph on one source line and rely on editor soft-wrap. Keep list-item prose on one source line too, preserving list nesting. Do not apply a fixed-width prose wrap. Preserve fenced and indented code, tables, YAML frontmatter, raw HTML structures, intentional Markdown hard breaks and other semantic whitespace. Use a Markdown-aware transformation and verify semantics when reflowing existing documents.

- Keep shared architecture/guidance at root and application-specific contracts in their own documents. Update active references and moved relative links together; preserve truthful historical evidence instead of rewriting old execution history.

- Keep current behavior separate from future plans. Do not imply an interface, persistence mechanism, permission or guarantee exists before it is implemented and checked. Put investigation histories and validation evidence in handovers.

- Keep mirrored skills and host-adapted agents synchronized as required by AGENTS; use project-relative paths and named skills. No machine-specific configuration.

- Make focused, reviewable changes. Use Conventional Commits for commits and PR titles (`type(scope): description`) and conventional feature branches (`type/short-kebab-case-description`). The explicitly user-named `interactive-app` initiative trunk is the deliberate branch-name exception.

- Describe the problem, resulting behavior, decisions/alternatives, plan shifts, validation and material limitations. Obtain independent review before publication when required by the initiative; never treat a passed check as merge permission.
