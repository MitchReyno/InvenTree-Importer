# Repository layout and workspace handover

## Scope and base

This initiative change relocates the existing uv-managed Python project intact
into `backend/`, adds a root pnpm workspace and an explicitly incomplete
React/TypeScript/Vite intake scaffold in `frontend/`. It starts from main commit
`db9fd4180ab43edddf4119f5311ad673711c382e`. It does not change the import package
name, CLI, execution contracts or implement a new backend/workflow engine.
Shared docs, guidance, agent definitions, skills and CI remain at root. Historical
stage handovers/evidence are retained as historical command/path records.

Work occurs in an isolated worktree, without moving user .env, caches, local
imports, existing virtual environments or platform execution/scanner journals.
No live inventory, vendor API or credentials are used for validation. Publication
requires the parent's independent exact-commit review; no merge is authorized.

## Changes and engineering decisions

- Move Python metadata/lock/version, `src`, `tests`, `scripts` and tracked importer
  `config` under `backend`; retain hatch's existing src-layout wheel boundary.
  Recreating `backend/.venv` is safer than moving an environment with embedded
  paths. Python dependencies and CLI/package identity remain unchanged.
- Root pnpm owns command delegation and a single lockfile; frontend owns its
  dependencies/scripts. Make exposes normal backend/frontend checks and explicit
  scanner/workflow-sync targets. CI has separate Python and frontend jobs with
  explicit project/cwd/config selection.
- Source-location discovery recognizes the exact known backend source layout,
  workspace markers and historical flat fallback. It does not search arbitrary
  cwd/ancestor repositories. Root `.env` and backend config remain deterministic.
  Omitted cache/scanner export defaults alias backend cwd to root local data;
  explicit relative arguments and external cwd preserve their original meaning.
  State override and platform journal policy are unchanged. No global chdir.
- Use None only to distinguish omitted cache options from explicit relative paths;
  resolve at library consumption boundaries so CLI and direct library calls agree.
  Cache constants stay relative for existing callers supplying them explicitly.
- Installed wheels retain the historical package-relative config/env fallback,
  without bundling config or adopting an unrelated repository. Explicit config/env
  paths remain necessary outside source checkout; improving distribution of config
  is deferred rather than silently changing an existing limitation.
- Pin Node 24.22.2 (maintained LTS), pnpm 12.16.1, React 19.3.1, Vite 8.3.5 and
  TypeScript 6.0.3 after official documentation/registry availability and peer
  checks. TypeScript 7 is deferred because the selected typescript-eslint supports
  below 6.1. Task-local tools avoid changing the host's Node 23/pnpm 8 setup.
- Frontend is deliberately local file-metadata selection/removal only. It has no
  upload, processing, importer calls, persistence, root env loading or Vite proxy.
  Tests cover selection/removal/clear, duplicate filenames and no fetch calls.
  Full product mockup conversion and workflow packages were explicitly excluded.
- Update active root docs/commands, mirrored skill supporting scripts and both
  agent hosts together; retain exact mirrored copies rather than symlinks.

Official references checked: [Node release support](https://nodejs.org/en/about/previous-releases),
[pnpm installation](https://pnpm.io/installation),
[Vite guide](https://vite.dev/guide/), [React versions](https://react.dev/versions),
[pnpm CI action](https://github.com/pnpm/action-setup/tree/v4) and published package
metadata from the official npm registry. These verify tool availability/constraints,
not production behavior or importer integration.

## Validation record

Commands below are run from repository root unless noted. uv/pnpm caches and tool
installation are task-owned temporary directories, never user import directories.

Passed owner validation:

- Fresh `uv sync --project backend --locked --extra scanner`: Python 3.12.11,
  unchanged uv lock, relocated editable package.
- `pnpm install --frozen-lockfile`: root workspace, two projects, no resolution
  changes; pnpm 12.16.1.
- `pnpm typecheck`, `pnpm lint:frontend`, `pnpm test:frontend` (2 tests),
  `pnpm build`: all pass, Vite production assets built.
- `make lint-backend`: all backend Python and both shared skill script trees pass
  configured Ruff checks.
- Focused paths/env/cache/workflow-sync: 42 passed, 1 existing skip. New tests
  prove root/backend/external subprocess cwd behavior, exact state override and
  retained bytes, flat/worktree layout, unrelated installed layout exclusion,
  config/env identity and explicit-relative cache I/O.
- `make test-scanner`: 43 passed, 1908 deselected, 43.87 seconds.
- `uv build --project backend --wheel`: built the unchanged package identity;
  wheel installed in a fresh separate environment; external wheel discovery and
  explicit environment/CLI help smoke pass.
- `git diff --check`: pass.
- Final `make test`: 1907 passed, 1 existing skip, 43 scanner deselected in
  207.06 seconds; frontend 2 passed in 912 milliseconds. All previously missed
  skill/script checks run again; relocation introduces no new skip.
- Root `pnpm backend --help` delegation and actual `pnpm dev` loopback HTTP smoke
  pass; owned Vite process stopped afterward. The first dev smoke expected the
  wrong HTML title; correcting the assertion to the actual scaffold title passed.
- CI YAML parsed and push branches asserted as main plus interative-app; pull
  request trigger retained.

The first normal run exposed a relocated test-fixture lookup error: logo/crop/skill
checks inferred the shared root from CONFIG_DIR.parent, which is now backend.
That produced 18 missing-script errors and 49 unintended skips (1840 passed,
50 skipped, 43 deselected, 203.98 seconds). The correction uses the shared repository fixture root; no product workflow is
bypassed. Focused correction checks pass all 67 logo/crop/skill tests; the final
normal result above restores all intended coverage. A first mechanical import rewrite briefly caused a collection
error in the skill test; retaining its config-loader import fixed it before rerun.

Actual happy and partial demos pass prepare/preview/execute/status/completed
resume. Partial recovery includes stopping/restarting the persistent fake server,
retrying the original failed operation and confirming all Part/stock/PO/line records
and PKs unchanged. Each has one Part, two stock lots, one PO, two contributions.
Poisoned inherited proxy/target settings are ignored by the private child.
Installed-wheel external-cwd discovery and CLI help pass in a fresh environment.

The initial standalone wheel assertion incorrectly expected site-packages
in the fallback config directory; the historical fallback is the interpreter lib
parent. This was a validation expectation error, not a runtime change.

## Initiative branch adjustment

After the initial local review candidate, the user explicitly requested the
initiative trunk named `interative-app` (spelling preserved). The restructuring
feature branch stays `refactor/backend-frontend-layout`; its PR now targets
`interative-app`, not main. The trunk starts at the existing main base after a
remote existence check. This is a branch/review destination change, not a merge
or a change to the agreed implementation scope. Future initiative PRs use this
trunk. No existing branch is overwritten. Push CI covers both main and the
initiative trunk; pull-request CI remains target-independent.

## Review, shifts and limits

An independent reviewer approved runtime/implementation commit
`208609273595f5f2a21239dd23ef8cae6c1d6e08` with no unresolved material findings.
The review inspected the rename/content diff, all changed consumption boundaries,
unchanged execution/state modules, mirrored workflows, CI and active guidance.
The initial fixture-root failure and initiative-trunk CI correction were cleared.

Independent validation (separate from owner totals):

- Paths/env/cache/config/workflow sync: 122 passed, 1 existing skip; corrected
  logo/crop/skill checks: 67 passed, zero skips; configured Ruff/diff-check pass.
- Synthetic root/backend/external I/O proves actual env/config/product-cache
  consumption and explicit-relative cache isolation, plus direct uv cwd behavior.
  Actual scanner default/explicit pending exports target the expected directories.
- A fresh wheel contains all 97 current Python module bytes exactly, excludes
  checkout-only files, ignores unrelated workspace defaults, and runs the real CLI
  vocabulary with explicit caller-relative config.
- The fresh installed wheel runs the actual loopback partial demo, persistent
  server restart, original-ID evidence repair and completed resume; all inventory
  record contents/PKs remain unchanged. Poisoned inherited proxy/target is ignored.
- Frontend typecheck/lint/2 tests/build pass. A separately copied workspace performs
  a frozen offline install with 197 reused packages and zero downloads.

Reviewer environment failures are retained as evidence: the first script-test
invocation hit the sandbox's home uv-cache denial (24 failures, 43 passes); using
the populated task cache gives all 67 passes. Its first wheel-demo bind was denied
by the loopback sandbox, leaving an owned incomplete fake workspace; a new owned
workspace under scoped permission passes. No live service was contacted. These
failed environment attempts are not counted as successful source coverage.
The reviewer did not repeat the complete normal/scanner suites; targeted independent
I/O, distribution, scanner-export and demo checks supplement the owner's full runs.

This final successor contains documentation only: final evidence, review disposition
and a maintained-plan command selecting configured Ruff. It requires a brief exact
successor-delta review before publication. No merge is authorized.

No release claim is made for the scaffold's future backend integration. Fake demo evidence establishes loopback behavior only;
production capabilities, durable execution rollout limits and real inventory
approval rules stay as documented in the existing operator/execution docs.

Operator instructions and path semantics are in
[repository-layout.md](../repository-layout.md); the maintained architecture remains
[ARCHITECTURE.md](../../ARCHITECTURE.md). Existing root data needs no migration.
