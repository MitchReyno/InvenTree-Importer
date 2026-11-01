# Code formatting owner handover

This record separates the original formatter qualification from the later executor/readability expansion. Results and pending steps describe their recorded stage; the later PG/process evidence does not retroactively change the original limits.

## Plan recorded before implementation

Scope: shared formatter configuration, root package scripts/lockfile, opt-in pre-commit integration, project-local VS Code settings/recommendations and developer documentation. No application behavior, inventory access, service startup, global editor settings or shared hook installation. This owner works independently from capture/executor owners; they should reconcile the root manifest/lock after this PR merges, not copy unmerged siblings.

Public workflow: pinned Prettier for TS/TSX/JS/JSX/CJS/MJS/JSON/JSONC/CSS, existing uv-managed Ruff for Python, existing remark for Markdown with unwrapped prose. Provide explicit code write/check commands; hooks format changed eligible files without staging them. Workspace editor mappings enable format-on-save after developers install recommended extensions and project dependencies and trust the workspace. Recommendations cannot silently install extensions. Do not introduce a second Markdown or Python formatter.

### Package research

Prettier 3.9.10 npm metadata reports MIT, Node >=14 and no runtime dependencies; the registry showed a recent release. The [official package](https://www.npmjs.com/package/prettier) supports the required web languages without plugins. Its [VS Code extension](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode) uses project-local Prettier and its config/ignore files.

Qualify against Node 24.22.2 / pnpm 12.16.1, not merely the advertised engine range.

Alternatives assessed:

- Biome is maintained, MIT/Apache-2.0, but would add another lint/format ecosystem without replacing ESLint for a demonstrated need.
- ESLint formatting alone does not cover CSS/JSON; a bespoke formatter is inappropriate.
- Keep locked Ruff for Python, not a Prettier plugin.

Package metadata/tests are not a full security audit. Future dependency upgrades need the same compatibility checks.

Sequence:

1. Inspect shared/app guidelines, hooks, ESLint, package and generated artifact contracts (completed before this plan). Existing ESLint uses correctness rules, not stylistic formatting rules.
2. Add exact Prettier dependency and shared style configuration aligned with existing single-quote/no-semicolon TypeScript. Define an allowlisted extension surface plus generated/evidence/local-data ignore boundaries. Do not format original references, generated contracts/vectors, synthetic fixture bytes or immutable migrations.
3. Add code CLI commands, changed-file Prettier/Ruff format hooks and per-language editor defaults. Retain syntax/Ruff lint/ESLint/remark hooks and normal staging semantics. Keep legacy Python untouched: touched-file enforcement, not a false claim of a clean Python baseline. Baseline only eligible web code if needed for a useful code check.
4. Document exact language coverage, commands, prerequisites, ignores, baseline strategy and no CI-format enforcement unless genuinely needed. Update architecture only for shared tooling ownership.
5. Exercise real format/check/write/idempotence and hook invocation with temporary TSX/CJS/CSS/JSON/Python fixtures, including ignored byte-sensitive files, syntax failure and partially staged edits in an isolated Git repository. Never install hooks in shared worktrees. Verify frozen installation, frontend typecheck/lint/tests/build, generated-contract drift and fast intake tests, backend normal suite and mirrored workflow consistency as appropriate. Record actual results and limitations here before publishing a ready PR into `interactive-app`.

## Implementation and verification

No implementation edits preceded the plan above. Work starts from merged `interactive-app` commit `b0e1fe7de83b68fb72590f47244624394ed12202` on independent branch `chore/code-formatting`; no unmerged capture/executor work was imported.

### Implemented surface and ownership

- Root `package.json` adds exact development dependency `prettier: 3.9.10` plus `format`, `format:check`, `format:python`, `format:python:check` and `test:formatting`. Existing `format:markdown`, lint/test scripts and application dependencies retain their roles. Prettier was already present transitively through `json-schema-to-typescript`; this makes its developer-tool ownership explicit rather than relying on accidental transitive availability. The pinned pnpm regenerated the lockfile, including optional-edge metadata for existing packages; no application dependency versions were intentionally changed.
- `.prettierrc.json` selects existing single-quote/no-semicolon style, preferred width 100 and no embedded-language formatting. The latter keeps generated code inside generator template literals untouched. `.prettierignore` is an extension allowlist and exclusions, not a second formatter implementation. HTML/YAML/SQL/Markdown/Python and binary/media files are not Prettier inputs. All docs (including future preserved reference HTML/screenshots/JSON), backend/spikes, mirrored agent assets, generated contracts/vectors, fixtures, migrations and local/build/cache/worktree artifacts are outside this rollout.
- `.pre-commit-config.yaml` runs real Prettier and Ruff format commands on changed files before existing Ruff lint/ESLint/remark checks. Existing syntax/large-file checks remain. The formatter hooks never stage content; pre-commit reports rewrites as failures, stashes/restores unstaged edits and can roll back conflicting fixes. `backend/pyproject.toml` adds formatter-only evidence/generated/local-data exclusions, with `--force-exclude` on explicit Python CLI/hook paths; lint selection remains `F`/`B`.
- `.vscode/settings.json` maps web languages to local Prettier and Python to backend's uv-environment Ruff, with per-language format-on-save. It explicitly maps Ruff's owning config and supports conventional Unix/Windows environment executable paths. Root `.gitignore` admits only the two shared VS Code files, not arbitrary developer editor state. `.vscode/extensions.json` recommends Prettier/Ruff; it cannot install them. Root-opened trusted workspace, installed extensions/dependencies and PATH for CLI hooks are prerequisites. Custom uv environment locations need an editor path override. The [Ruff settings reference](https://docs.astral.sh/ruff/editors/settings/) documents config/executable selection; maintained [extension guidance](https://github.com/astral-sh/ruff-vscode/issues/486) confirms `${workspaceFolder}` configuration expansion.
- Markdown remains remark-only, unwrapped, with editor soft wrap and Markdown format-on-save disabled. No fixed prose width, Prettier Markdown plugin, Python Prettier plugin, SQL formatter, lint replacement or new CI formatting gate is added. Existing path-aware CI and exact generated-artifact drift checks remain in force, with no success masking or required-check changes.
- `README.md` documents CLI/editor/hook coverage, prerequisites, ignored surfaces, explicit restaging and broad-command caveats. `ARCHITECTURE.md` records shared tooling ownership. The only new executable source is a Node built-in test module (`tooling/tests/formatting.test.mjs`), covered by the explicit runtime/test exemption from the standalone-utility `.cjs` rule; no bespoke formatter or utility abstraction was added.

### Baseline strategy and plan adjustments

The initial web/code check correctly failed on 29 existing files. Those eligible frontend/contracts/intake-server source, tests, CJS commands and JSON configurations received only package-generated formatting so `pnpm format:check` has a useful clean baseline. There are no application logic/layout edits. Generated output, canonical vectors, migration `0001_foundation.sql`, fixture helpers/evidence, mirrored skills/agents and original references are unchanged. Preserved source text inside generator templates stays unchanged and actual drift verification passes.

Legacy Python is deliberately not mass-reformatted. A read-only Ruff format check on `backend` reports **158 files needing formatting and 12 already formatted**, exiting nonzero as expected. New/changed Python is enforced at save/commit time; `hooks:check` and a Python format command without explicit paths can rewrite/check far more legacy code and are documented accordingly. No Python source files were changed in this task. This is not a claim that every repository file complies with all formatters.

Qualification caught a Prettier chain-layout stabilization corner: the first repository-wide pass left `intake-server/src/api/server.ts` requiring another normalization pass. This was not bypassed or hidden: rerunning the package reached a stable result; a subsequent full write printed every file unchanged, and repeated checks passed. Fixture write/check/write cycles are stable. This is evidence for the qualified fixtures/final baseline, not a universal proof that the upstream formatter is idempotent for every possible input. The initial ignore allowlist was also corrected to ordinary gitignore extension patterns before qualification; no custom formatting workaround was introduced.

### Verification evidence

All Node commands use the pinned Node **24.22.2** and pnpm **12.16.1**; Python is **3.12.3**, locked Ruff **0.17.0** and pre-commit **4.7.0**. npm version/engine/license metadata and actual installed behavior were checked. Prettier's MIT development dependency is compatible with the repository license, has no runtime dependency tree of its own and adds no shipped application runtime. The package-manager supply-chain policy check and frozen install pass; neither is a complete security audit.

| Check                                                                  | Actual result                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile`; `uv sync --project backend --locked` | Pass with checked-in pins/lockfiles                                                                                                                                                                                                               |
| `pnpm format:check` and repeat `pnpm format`                           | Pass; final write reports every eligible file unchanged; tracked diff SHA-256 identical before/after                                                                                                                                              |
| `pnpm test:formatting`                                                 | 3 tests pass: all 11 opted-in web/code extensions, Python CLI/hook formatting, invalid syntax failure, explicit-path ignores, byte preservation, repeat-write stability and index/unstaged-edit preservation                                      |
| Real Git hook fixture                                                  | `pnpm hooks:install` installs only inside a disposable standalone Git repo; actual `git commit` fails on formatter rewrites, leaves staged originals intact, then succeeds after explicit staging. No shared worktree hooks are installed/changed |
| Partial staging fixture                                                | Real `pre-commit run prettier` reports changes/failure without staging and preserves the unstaged marker; already-formatted staged content plus an unstaged edit passes without moving that edit into the index; malformed TSX still fails        |
| `uv run --project backend pre-commit validate-config`                  | Pass                                                                                                                                                                                                                                              |
| `pnpm typecheck`; `pnpm lint:frontend`; `pnpm build`                   | Pass, including frontend/contracts/intake-server typechecks and real Vite production build                                                                                                                                                        |
| `pnpm contracts:check`                                                 | Pass repeatedly after generator/source formatting; generated exact bytes retain their producer's formatting                                                                                                                                       |
| `pnpm test`                                                            | Frontend 2, contracts 3 and fast intake-server 37 tests pass; backend **2038 passed, 4 skipped, 43 deselected** in 253.89 seconds. Skips/deselections are not counted as passing coverage                                                         |
| `pnpm lint:backend`                                                    | Pass for backend and both mirrored skill trees                                                                                                                                                                                                    |
| `pnpm workflow-sync`                                                   | 7 pass; mirrored files and host-adapted agents remain unchanged                                                                                                                                                                                   |
| Targeted remark checks on README, architecture and this handover       | Pass; existing no-fixed-wrap policy retained                                                                                                                                                                                                      |
| `git diff --check` and protected-path diff checks                      | Pass; no changes in generated contracts, vectors, migrations, mirrored workflows or shared synthetic fixtures                                                                                                                                     |

The first staged repository hook invocation passed syntax, Prettier and ESLint checks, then correctly failed because existing remark aligned this handover's table without wrapping prose. That rewrite was inspected and explicitly restaged; no formatter auto-staging or failure suppression was added. Python hooks skip in this PR's actual staged file set because no Python source changed; the disposable real-commit fixture independently proves Python formatting and lint integration.

The formatting tests use temporary owned repositories and installed tools, delete their fixtures at completion, and never contact inventory/provider services. They install hooks only in the explicitly verified standalone fixture repository. No global credentials/editor configuration or shared hook files are changed. No real inventory, Docker service, migration or provider session was accessed. The ordinary tests use synthetic/local test boundaries, not live inventory.

### Limits and next owner

These were the original submission limits, before the later executor expansion below.

Actual VS Code GUI save interaction was not exercised, nor were Windows executables run; the editor configuration is qualified against public extension contracts and local formatter behavior. Developers still need to install the recommended extensions, install project dependencies and trust the root-opened workspace. Scanner/TUI and PG/process suites are not locally run: this task changes formatting only and starts no Docker or database services. Their source is mechanically formatted where eligible, but local passing fast tests do not prove those integration tiers. Existing CI selection remains responsible for its selected checks.

Publish this coherent PR ready into `interactive-app`, not main, without merging or launching another agent. The coordinator assigns fresh independent review after ready publication; review findings and fixes belong in this record before merge. No independent approval is claimed yet. Subscribe PR feedback and exact pushed-head CI to the coordinator's source thread.

Capture owner reconciliation: this PR owns root formatter/editor/pre-commit policy. Its only intentional root manifest additions are the exact Prettier devDependency and five scripts above; retain capture's independent dependencies/scripts when refreshing from merged trunk and regenerate the single lockfile with pinned pnpm. Frontend/contracts/server source changes here are mechanical baseline changes against the merged snapshot; capture should refresh after this merge and reformat its changed eligible files, not import an unmerged sibling branch. This task did not touch the other owners' worktrees or the user's unrelated editor files.

## Continuation plan after user-requested pause

A fresh owner resumed on 2026-11-01 after Mitch explicitly requested continuation. All 42 staged files and the clean unstaged worktree were preserved; the original plan was not backdated.

The remaining plan was:

1. Inspect staged source/configuration.
2. Rerun formatter/isolated real-hook tests and check protected paths/generated drift.
3. Record results and publish a ready PR to `interactive-app`.

Existing package qualification remained the basis; no new dependency/service was needed. Preserve byte-sensitive originals, generated outputs, vectors and SQL. No shared hooks, real inventory endpoint, provider session or credential store was touched.

Capture remained the post-merge integrator. No unmerged sibling code was imported; independent review/merge belonged to the coordinator.

### Continuation results before scope expansion

Live `interactive-app` was still `b0e1fe7de83b68fb72590f47244624394ed12202`, with no formatting PR. Fresh checks passed:

- `pnpm format:check` and `pnpm contracts:check`.
- All three `pnpm test:formatting` cases, including real isolated commits and partial-index preservation.
- Staged `pre-commit run`: syntax, Prettier, ESLint and remark. Python correctly skipped because no Python source was staged.
- Protected-path diffs and staged/unstaged whitespace checks.

The first sandboxed run passed pure formatting but failed the two hook cases because the host uv cache was inaccessible. Host-cache access passed unchanged tests. Pre-commit restored the handover's unstaged additions; no shared hook was installed.

Earlier workspace/backend results remain the prior owner's evidence. This continuation stage added documentation only and did not rerun the full suite.

This harness exposes no event-subscription API. The coordinator will poll live exact-head CI and PR feedback with github-pr-tools instead; no subscription is claimed. Independent review is still pending.

## Prospective readability scope update

Mitch expanded the task after ready publication to address condensed new TypeScript and its guidelines. Before editing, the owner inspected capture repository/snapshot and executor verification read-only.

The prospective plan was:

1. Format temporary representative capture repository/JSX and executor copies.
2. Separate mechanical expansion from structural readability problems.
3. Improve shared/frontend/server guidance for branches, named operations and responsibility boundaries.
4. Verify coverage and unchanged source bytes, update the ready PR and obtain fresh review.

No unmerged feature code would be edited/imported. The coordinator initially proposed formatter/guidelines first, then feature-owner integration and formatting before final review. Structural changes remained with feature owners or a bounded follow-up, preserving safety rather than prompting blanket refactoring.

### Readability diagnosis and temporary-copy evidence

Readability problems observed:

- Capture repository combined awaited SQL, row extraction, projection and fallback decisions.
- Capture JSX compressed entire queues/forms onto single lines.
- Executor modules compressed validations, callbacks and declarations.

Shared guidance now covers explicit statement/declaration lines and branches, named intermediates, transaction order and cohesive extraction without quotas. Frontend guidance adds named props/handlers and scannable JSX; server guidance adds query/predicate/effect order. Wrapping alone is not a structural refactor.

The real Prettier CLI formatted temporary copies using original relative source paths:

| Sample                | Lines before → after | Longest line before → after |
| --------------------- | -------------------- | --------------------------- |
| Capture repository    | 162 → 384            | 291 → 149                   |
| CaptureWorkspace      | 113 → 615            | 1039 → 141                  |
| Executor verification | 77 → 137             | 229 → 142                   |
| Executor apply        | 133 → 268            | 313 → 238                   |

Each path was included by the actual ignore policy with the TypeScript parser. Second formatting was byte-identical; SHA-256 checks proved original worktrees unchanged.

SQL/string literals and structural expressions remained. `printWidth` is a preference, not a hard maximum; no config change was warranted. These local copies were qualification evidence, not imported sibling implementation.

The coordinator then revised the order prospectively:

1. Merge the reviewed bounded executor fix.
2. Refresh this branch from merged `interactive-app` and format the new executor TypeScript, preserving single-send transport.
3. Make only obvious behavior-preserving declaration/guard corrections, recorded separately from mechanical output.
4. Capture integrates merged guidance/formatter and formats its code before final review.

No unmerged sibling implementation was imported.

### Expanded implementation and current qualification

Executor integration followed its reviewed fix on `interactive-app` at `8ae745c4d6a48877c10b635350e52875bc4fb9fc`. The transport conflict used merged source followed by formatting; exact output comparison proved single-send behavior was preserved.

Commit `5e6aced` separately records mechanical executor module/test expansion. Twenty-five merged executor/neighbor files, including transport, exactly equal package formatting of trunk source. Migrations, generated contracts/vectors and synthetic fixtures stayed unchanged.

Manual edits were limited to `execution/plan.ts` and `response.ts`:

- Explicit braces around existing branches/loop bodies.
- Separate operation/contribution set declarations and bytes/digest declarations.

No predicates, evaluation order, SQL, timeouts, quantities, retained bytes or network policy changed. The guidance does not claim every module was structurally refactored.

Capture's required original `07-table.png` exceeds the 500 KiB hook limit. Exclude exactly `^docs/bench-intake/reference/07-table\.png$`; retain the default limit elsewhere and all original bytes.

A fourth real isolated-hook test passed a 512001-byte file at that path and rejected adjacent `08-table.png`. This is one user-required historical-reference exception, not a general evidence exclusion or raised limit.

Fresh expanded-implementation checks passed:

- Full workspace `pnpm typecheck`.
- Contracts 3/server 39 fast tests, including actual HTTP421 single-send.
- PostgreSQL 17/17 and process 6/6, including real COMMIT-ACK loss and surviving physical children.
- All four formatting/real-hook tests.
- `pnpm contracts:check`, `pnpm format:check`, targeted Markdown and whitespace/protected-path checks.

The first fast invocation was blocked before tests by sandbox denial of tsx IPC; host access passed unchanged tests. The expected DBOS queue-collision diagnostic's asserted case passed.

PostgreSQL reused the existing owned service with isolated random databases. No duplicate service, shared restart or protected inventory access occurred.

At final submission, the coordinator still needed fresh exact-head independent review and selected CI before merging PR43.

After merge, capture must retain its manifest/lock changes, format its actual TypeScript/TSX, check generated bytes and revalidate functional/visual behavior before final review. Remaining structural fixes belong to capture or an explicit follow-up; formatting does not prove good decomposition.

VS Code/Windows, legacy Python and unsupported actual-InvenTree capability limits remain in force.

### Queued user-requested Markdown follow-up

Mitch requested a separate Markdown readability follow-up after the expanded PR43 work. At that point it remained queued for the formatting owner after merge:

- Audit maintained entrypoints, architecture, guidelines and active design/plan documents.
- Agree bounded coordinated scope, then use a fresh non-stacked branch/worktree from merged trunk.
- Shorten coherent paragraphs, add useful structure and remove repetition while preserving decisions/safety.
- Keep unwrapped source, byte-preserved originals and truthful historical evidence; coordinate capture-owned docs through the coordinator.

This entry records the request as it stood then; it does not backdate completed Markdown work or authorize rewriting provenance.
