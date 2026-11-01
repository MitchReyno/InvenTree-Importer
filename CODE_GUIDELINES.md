# Shared code guidelines

Apply these guidelines to new and changed code across the workspace. Read
[ARCHITECTURE.md](ARCHITECTURE.md), then the owning application's
[backend guidelines](backend/CODE_GUIDELINES.md) or
[frontend guidelines](frontend/CODE_GUIDELINES.md) and architecture. Improve the
code you touch proportionately; a focused change does not authorize an unrelated
rewrite. Application documents own language/framework details.

## Readability and responsibility

- Use domain names and explicit control flow so decisions can be understood
  locally. Include units when ambiguity matters; explain constraints and tradeoffs
  rather than restating code. Remove stale comments and obsolete callers.
- Give functions, components and modules coherent responsibilities. Extract a
  helper when it names meaningful work, isolates effects or removes substantial
  duplication. Size is a review signal, not a quota; keep cohesive schemas/tables
  together when splitting obscures the contract.
- Separate parsing, validation and decisions from filesystem, network and UI
  effects. Keep orchestration at a consistent level of detail with visible
  validation, effects and recovery order.
- Pass dependencies and configuration explicitly. Make state/resource ownership
  and lifetime clear; avoid mutable global state, circular dependencies, catch-all
  helpers and imports that start work. Prefer composition and add abstractions
  only when concrete callers need them.
- Keep helpers at the narrowest boundary that owns their meaning. Share domain
  policy through an intentional interface rather than copying it into another
  application or pulling presentation into lower-level workflows.

## Contracts, effects and failures

- Treat external data as untrusted. Types and casts do not validate runtime input.
  Validate at boundaries and keep missing, invalid, empty and unavailable values
  distinct. Document units, output shapes, side effects and important limitations.
- Report failures at the boundary that owns their response. Preserve causes and
  known outcomes; do not convert failed lookups or partial work into success.
  Keep cleanup/resource release deliberate on failure and cancellation.
- Validate before dependent effects. Preserve stable identities and distinguish
  planned, attempted and confirmed outcomes. Never blindly replay an unknown
  write or claim atomicity across local files and remote services.
- Bound network waits/retries and concurrency. Define resource ownership,
  cancellation, rate budgets and failure propagation before adding workers.
  Optimise measured bottlenecks rather than speculative parallelism.
- Use portable paths from explicit input, configuration or deliberate runtime
  discovery. Never embed a developer checkout/home/temp path. Preserve caller-cwd
  meaning and state namespaces unless an explicit migration is part of the change.
- Keep credentials and private source data out of source, fixtures, logs, exports
  and errors. Use safe identifiers and deliberate diagnostics/result channels.

## Testing and tools

- Test observable behavior and meaningful boundary/failure contracts, not copies
  of the implementation or incidental prose. Add regression tests for behavior
  changes; documentation-only moves need reference/consistency checks rather than
  invented runtime tests.
- Ordinary tests use controlled clocks/data, temporary owned files and fake/local
  services. Keep hardware/live integration requirements explicit. Do not infer
  production guarantees from fake evidence or count skipped checks as coverage.
- Mock external boundaries without mocking away the behavior under test. Exercise
  real adapters/serialization when their behavior matters, with isolated targets.
- Follow declared versions, configured lint/typecheck/test commands and lockfiles.
  Add tools/dependencies only for demonstrated correctness/maintenance benefits;
  document pins and compatibility limits. Avoid unrelated formatting churn or a
  second formatter introduced for one change.
- Run the appropriate application checks and [AGENTS.md](AGENTS.md) requirements.
  Root pnpm scripts delegate to the applications; app guidelines identify their checks.
  Report actual results, failures, skips and limits honestly.

## Documentation and review

- Keep shared architecture/guidance at root and application-specific contracts in
  their own documents. Update active references and moved relative links together;
  preserve truthful historical evidence instead of rewriting old execution history.
- Keep current behavior separate from future plans. Do not imply an interface,
  persistence mechanism, permission or guarantee exists before it is implemented
  and checked. Put investigation histories and validation evidence in handovers.
- Keep mirrored skills and host-adapted agents synchronized as required by AGENTS;
  use project-relative paths and named skills. No machine-specific configuration.
- Make focused, reviewable changes. Use Conventional Commits for commits and PR
  titles (`type(scope): description`) and conventional feature branches
  (`type/short-kebab-case-description`). The explicitly user-named `interactive-app`
  initiative trunk is the deliberate branch-name exception.
- Describe the problem, resulting behavior, decisions/alternatives, plan shifts,
  validation and material limitations. Obtain independent review before publication
  when required by the initiative; never treat a passed check as merge permission.
