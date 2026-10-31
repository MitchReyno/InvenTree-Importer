# Coding conventions

Use these conventions when writing or reviewing Python code. They describe the
desired direction for new and changed code, independently of the current module
layout. Apply them proportionately: improve the code you touch without turning
a focused change into an unrelated rewrite.

## Readability and naming

- Prefer straightforward code whose intent a reader can understand locally.
  Use explicit control flow when a clever expression hides the decision.
- Follow PEP 8 naming: `snake_case` for functions, variables and modules,
  `PascalCase` for classes, and `UPPER_SNAKE_CASE` for constants. Use a leading
  underscore for internal interfaces.
- Name things for their meaning in the domain. Include units where ambiguity
  matters, such as `timeout_seconds`; avoid unexplained abbreviations and
  generic names such as `data` when a more precise name is available.
- Keep formatting consistent within the code being edited. Let configured tools
  govern mechanical style; avoid unrelated formatting churn or adding a second
  formatter for one change.
- Group imports into standard library, third-party and local imports. Avoid
  wildcard imports. Keep imports at module scope unless optional dependencies,
  startup cost or another concrete constraint justifies a local import.
- Use comments to explain intent, constraints and surprising tradeoffs. Remove
  stale comments and commented-out code; version control preserves history.

## Functions, modules and dependencies

- Give each function a coherent responsibility. Extract a helper when it names
  a meaningful operation, isolates an effect or removes substantial duplication,
  rather than to meet an arbitrary line limit.
- Separate parsing, validation and business decisions from filesystem, network
  and user-interface effects. Keep core transformations easy to call and test.
- Pass dependencies and configuration explicitly. Avoid mutable global state,
  hidden singletons and imports that start work or change the environment.
- Keep module dependencies understandable and avoid circular imports. Organise
  code by responsibility; do not collect unrelated helpers in a catch-all module.
- Prefer composition to inheritance unless there is a genuine substitutable
  relationship. Introduce an abstraction when concrete use cases justify it,
  not in anticipation of hypothetical implementations.
- Use the standard library when it solves the problem clearly. Add a dependency
  when its maintenance and correctness benefits justify the installation,
  compatibility and security costs.
- Use the project's declared Python version and dependency configuration.
  Update the lockfile through the dependency tool when dependencies change;
  document compatibility pins and what would allow their removal.

### Function and method size

- Keep functions and methods short enough that their purpose, branches and
  effects can be followed without remembering several unrelated stages.
  Reconsider a growing function when it has deeply nested branches, many
  temporary variables, or comment headings separating distinct operations.
  Length is a review signal, not a quota: a declarative schema or table may be
  clearer kept together than split into arbitrary fragments.
- Let orchestration read as a sequence of named operations at a consistent
  level of detail. Keep matching rules, payload construction and attachment
  handling in focused helpers when they obscure the workflow. Preserve the
  visible order of validation, writes and recovery when extracting stages.
- Use guard clauses for invalid or completed cases when they make the main
  path easier to follow. Avoid introducing nested conditionals merely to keep
  a single return statement.
- Give extracted helpers explicit inputs and useful results. Avoid helpers
  that communicate through many mutated outer variables, or require a large
  bundle of unrelated state just to perform one small operation. Keep a local
  helper local when its closure is small and its meaning belongs to one caller.
- Use keyword-only arguments for options that are easy to confuse. When an
  interface accumulates arguments, check whether it is doing too much before
  grouping them into a model; group only values with a shared domain meaning
  or lifetime, such as an import policy or the caches owned by one run.

### Classes and state

- Use a class when methods share meaningful state, resource ownership or
  invariants. Make that lifetime clear, especially for caches and per-run
  state; do not turn a collection of independent functions into a class solely
  to provide a namespace.
- Keep methods focused on the state their object owns. If groups of methods
  use disjoint fields or change for unrelated reasons, consider separate
  collaborators. Prefer a function for a transformation that needs no object
  state; avoid growing a single coordinator into the owner of every concern.

### Files and package structure

- Before extending a large file, identify its responsibilities and callers.
  Keep closely related models and operations together; split at a meaningful
  boundary when parsing, matching, file handling or reporting have independent
  contracts and reasons to change. Neither line count nor one-class-per-file
  rules justify a split on their own.
- Follow the existing separation between `commands/`, integration packages
  such as `inventree/` and `digikey/`, and shared input/configuration modules
  under `src/invimport/`. CLI argument handling, prompts and presentation belong
  at the command boundary; reusable workflows belong in importable modules.
  Keep optional hardware or UI dependencies confined to the feature using them.
- Keep a helper in the narrowest module or package that owns its meaning.
  Promote it to shared code when actual callers need the same contract, after
  checking for an existing implementation. Name shared modules by purpose
  rather than expanding `util.py` with unrelated domain operations.
- Introduce a subpackage when several cohesive modules benefit from a common
  boundary, not just to create more directory levels. Keep dependencies flowing
  from commands to workflows and from workflows to lower-level operations;
  lower-level code must not import command modules. Keep `__init__.py` focused
  on an intentional package interface or registration, without eager setup.
- Put related tests in discoverable locations following the existing layout,
  such as `tests/inventree/` and `tests/digikey/`. Keep scenario-specific
  fixtures near their tests and share fixtures only at the scope that needs
  them. When a test file becomes hard to navigate, group tests by behaviour
  rather than exposing implementation stages as separate test APIs.
- Keep reusable application logic under `src/invimport/`; scripts should
  primarily adapt a standalone invocation or operational task. If script logic
  gains library callers, place that logic in the package rather than making
  callers import a script or alter `sys.path`.

## Types and data models

- Annotate new and substantially changed function interfaces, including return
  types. Add internal annotations where they clarify a non-obvious shape; do
  not annotate every self-evident local variable.
- Use modern syntax supported by the declared Python version, such as
  `list[str]` and `str | None`. Type parameters according to the operations
  required: for example, accept a `Mapping` when mutation is unnecessary.
- Prefer a named data model to a tuple with unexplained positions or a dictionary
  whose keys are repeatedly guessed. Use dataclasses for structured records,
  `TypedDict` for known dictionary shapes, and enums for a meaningful closed set
  when these make the contract clearer.
- Treat `Any`, casts and type-checker suppressions as explicit compromises.
  Keep them narrow and explain non-obvious reasons; a cast does not validate
  external data.
- Type hints do not enforce runtime validation. Validate untrusted inputs at
  boundaries and pass a consistent representation into the rest of the code.
- Distinguish missing values from empty strings, zero and `False`. Use `is None`
  where that distinction matters, and avoid ambiguous sentinel values.
- Avoid mutable default arguments and unintended sharing of mutable state.
  Use a default factory for mutable dataclass fields.

## Errors and validation

- Catch the specific exceptions that can be handled meaningfully. Keep `try`
  blocks narrow enough that an unrelated programming error cannot be mistaken
  for the expected failure.
- Let unexpected errors propagate to an appropriate application boundary.
  Broad exception handling is appropriate there for reporting or cleanup only
  if it preserves the failure and does not pretend the operation succeeded.
- Use built-in exception types when they express the problem. Introduce domain
  exceptions when callers need to distinguish a particular failure or attach
  useful structured context.
- When translating an exception, preserve its cause with `raise ... from exc`.
  Include the operation and relevant safe identifiers in the message; suggest
  corrective action when it is known.
- Do not turn a failed lookup or request into an empty successful result unless
  that is the documented contract. Keep absence, invalid input and unavailable
  services distinguishable.
- Use exceptions or validation results for invalid user input. Reserve `assert`
  for developer invariants, since assertions can be disabled.
- Avoid logging an error at every layer and then re-raising it. Report it once
  at the layer that owns the response to the failure.

## Files, network calls and external effects

- Use `pathlib.Path` for filesystem paths. Resolve paths from explicit inputs,
  configuration or runtime context; never embed a developer's checkout or home
  directory in code, documentation or examples.
- Specify the encoding for text files and use context managers for resources.
  Clean up owned resources on failure as well as success.
- When replacing a file must not leave partial content, write to a temporary
  file in the destination filesystem and replace it after a successful write.
  Do not claim atomicity across several files or a filesystem and remote API.
- Set timeouts on network calls and check responses before parsing them. Retry
  only appropriate transient failures, with bounded attempts and backoff; do not
  blindly repeat a write whose outcome is unknown.
- Make repeatable operations idempotent where practical. Preserve stable
  identifiers, and distinguish what was planned, attempted and confirmed.
- Validate before expensive or irreversible effects. Make destructive behaviour
  explicit and preserve enough context to diagnose partial completion.
- For subprocesses, prefer argument lists, checked exit status and deliberate
  timeouts. Avoid shell interpolation of external input and do not ignore a
  failed command.
- Keep secrets out of source, fixtures, logs and exception messages. Load them
  through the project's configuration mechanism and redact sensitive context.

## Application boundaries and observability

- Keep reusable code independent of interactive prompts and process exits.
  Let the application boundary decide how to display errors and set exit status.
- Use logging for diagnostics and deliberate output channels for results.
  When a CLI supports machine-readable output, keep progress and diagnostics
  off its result stream.
- Log useful events and safe identifiers rather than entire payloads by default.
  Use exception tracebacks where they help diagnosis, without exposing secrets.
- Keep configuration parsing in a clear boundary, apply documented defaults,
  and report invalid settings before starting dependent operations.
- Introduce concurrency only for a demonstrated need. Define resource ownership,
  bound work, propagate failures and handle cancellation; do not block an async
  event loop with synchronous I/O.

## Tests

- Test observable behaviour and contracts rather than private implementation
  details. A useful test should survive a refactor that preserves behaviour.
- Add regression coverage for bugs and behaviour changes. Cover meaningful
  boundaries, invalid inputs and failure paths as well as the successful case;
  do not add tests that merely repeat an implementation or pin prose wording.
- Keep ordinary tests deterministic and independent of live services, hardware,
  real credentials and execution order. Use temporary directories and control
  clocks or randomness when they affect results.
- Mock at external boundaries when useful, without mocking away the behaviour
  being tested. Keep realistic fixtures and assert meaningful outcomes; test
  call order only when it is part of the contract.
- Separate unit tests from integration and hardware tests so their requirements
  and side effects are explicit. Exercise real integrations when the change
  depends on behaviour that mocks cannot establish.
- Give tests descriptive names and keep setup small enough to understand the
  scenario. Parameterise related cases when this clarifies their differences.
- Run the checks appropriate to the change and the required project checks in
  `AGENTS.md`. Report what ran and any failures; do not claim coverage from
  tests that were skipped or could not run.

## Documentation, tooling and review

- Document public interfaces and surprising contracts: inputs, outputs, units,
  side effects, exceptions and important limitations. Avoid docstrings that only
  repeat the function name or type annotations.
- Update examples and user-facing documentation when behaviour changes. Keep
  coding guidance durable; put individual debugging histories in issues or
  change descriptions rather than growing this file into a session log.
- Use the configured linter and test runner. Adopt additional tools through a
  deliberate project-wide decision, not by silently introducing requirements
  that the repository does not enforce.
- Optimise from measurements. Consider algorithmic complexity and I/O volume
  before micro-optimising; retain clarity unless evidence justifies complexity.
- Keep changes focused and reviewable. Remove obsolete callers and documentation
  when replacing behaviour; do not retain compatibility shims without an actual
  compatibility requirement.
- Use Conventional Commits for commit subjects and PR titles:
  `type(scope): description`. Name new branches `type/short-kebab-case-description`.
- Explain the problem, resulting behaviour, validation and material limitations
  in change descriptions. Call out migrations or compatibility changes explicitly.

## References

- [PEP 8: Python style guide](https://peps.python.org/pep-0008/)
- [Python exception handling](https://docs.python.org/3/tutorial/errors.html)
- [Python typing and runtime limitations](https://docs.python.org/3/library/typing.html)
