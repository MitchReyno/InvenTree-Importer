# T00 follow-up: optional, path-aware CI

## Ownership, authorization and scope

This follow-up starts at `interactive-app` commit `abffa9c5538315f6b75870c45179ee17fefa08ab` on `ci/conditional-nonblocking-checks`. The user explicitly authorized non-required CI and path-aware checks, a separate ready PR to `interactive-app`, and the necessary task/plan adjustment. The coordinator owns independent review and merge; this owner must not launch a reviewer or merge. Ready means available for review, not reviewed or merge-approved.

Changed files are limited to `.github/workflows/`, the narrow stdlib selector/tests in `.github/scripts/`, and this handover. T01 concurrently owns the intake server, contracts, root workspace, lockfile and plan updates. No root manifests, locks, plans, application code, skills, agents, local datasets or other worktrees were edited. No Docker, inventory requests, provider operations, server actions or root `.env` access were used. Tests use disposable local Git histories and the ordinary offline project checks.

## Actual external configuration (coordinator provenance)

The coordinator reported completing the authorized repository change at **2026-11-01T07:49:48Z**: ruleset **26298509** previously contained `required_status_checks` for `CI` (integration ID `15368`) and `non_fast_forward`, applying to `~DEFAULT_BRANCH` and `refs/heads/interactive-app`. The coordinator removed **only** `required_status_checks` through the authenticated API and verified by GET that only `non_fast_forward` remains. Enforcement stays active; conditions and bypass actors were preserved. The historical ruleset name, **Require CI checks to pass**, was intentionally left unchanged. This workflow owner did not perform or independently re-verify that external write.

Optional means no branch-ruleset requirement, **not** `continue-on-error`, tolerated test failures, a success-forcing aggregate or a suppressed signal. The obsolete aggregate `CI` job is removed. Every selected failed test/lint/install job remains failed and makes the workflow fail; unselected jobs skip through native job-level boolean conditions. The lightweight **Changed paths** job always runs and remains a real failing check if its tests or selection fail. There are no workflow-level `paths` filters that leave an expected required aggregate pending. No additional external rule change is requested from this owner.

## Implemented selection contract

`ci.yml` still runs for every PR and for pushes to `main` and `interactive-app`. It checks the selector's regressions, computes five explicit boolean outputs, and passes typed boolean inputs into the existing local reusable Test and Lint workflows.

| Changed path | Selected checks |
| --- | --- |
| Markdown anywhere, including application/CI documentation | Markdown only, unless also a mirrored skill/agent dependency below |
| Non-Markdown under `backend/` | Backend tests and backend lint |
| Non-Markdown under `spikes/` | Backend tests and backend lint (conservative coverage of repository-only fixture/adapter dependencies) |
| Non-Markdown under `frontend/` | Frontend typecheck, tests, build and lint |
| Root `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.node-version` | Frontend checks, Markdown lint and targeted shared workflow sync |
| `frontend/package.json` | Frontend checks and targeted shared workflow sync |
| Resources under `.agents/skills/`, `.claude/skills/`, `.claude/agents/`, `.codex/agents/` | Targeted shared workflow sync; also Markdown lint for Markdown or backend lint for Python; Python under either skill tree also selects backend tests |
| `docs/InvenTree API.yaml` | Backend tests only: the test stub reads this API route contract |
| `.remark*` or `.gitignore` | Markdown lint |
| Non-Markdown under `.github/workflows/` or `.github/scripts/` | All existing checks, so workflow/filter changes validate their consumers |
| Empty diff, unrelated paths such as `LICENSE` or issue-template YAML | No application/lint jobs; selector regression check still runs |
| Missing comparison history, no merge base, new/deleted branch zero SHA | All existing checks, with a visible warning rather than a false empty diff |

The output keys are `backend`, `backend_lint`, `frontend`, `markdown`, `workflow_sync`. Caller job output names use `backend-lint` and `workflow-sync`; reusable workflow inputs use `backend`, `frontend`, `workflow-sync` for Test, and `backend`, `frontend`, `markdown` for Lint. Comparison to the string `'true'` is explicit before passing actual booleans to the called workflows. Required typed inputs avoid accidentally running an unfiltered reusable workflow.

Backend's normal suite already includes `backend/tests/test_project_workflow_sync.py`, so a selected backend suite handles those assertions without duplication. Otherwise **Test / Shared workflow sync** runs that test file alone when relevant. That test reads both mirrored skill trees, both agent formats, root workspace scripts and frontend script targets: skill documentation/resources and frontend manifest changes must not lose that coverage. Ordinary documentation does not select the backend suite. Shared-skill Python selects backend lint because Ruff already owns those scripts and backend tests because the crop/logo behavioral tests execute those scripts; Ruff now also covers the new CI Python scripts. The explicit API-spec YAML exception selects backend tests because the stub's route allowlist is derived from it. These two backend-test dependencies were corrected in the material review follow-up below.

Frontend jobs explicitly call `pnpm --filter @invimport/frontend typecheck`, `test`, `build` and `lint`, not expanding root aggregate aliases. This preserves the frontend boundary when T01 adds server/contracts to root commands. The existing frozen root workspace install remains shared; dependencies and toolchain changes therefore select the relevant current consumers. Markdown still calls the existing root `lint:markdown` command. No nonexistent TypeScript server tests or placeholder jobs were added.

## Git comparison, permissions and failure behavior

The detector uses checkout with `fetch-depth: 0` and `persist-credentials: false`, and workflow permissions are limited to `contents: read`. It does not call the GitHub API, require `pull-requests: read`, fetch fork names or interpolate branch names/untrusted paths into a shell. Default PR merge checkout contains the head through its parents, including fork PRs; tests/checks still execute on the normal checkout, while the selector compares event base/head SHAs.

- PR: `git diff --name-only --no-renames -z BASE...HEAD --`, using the merge base to exclude changes present only on a newer target branch.
- Push: `git diff --name-only --no-renames -z BEFORE AFTER --`, covering every pushed commit and comparing actual endpoints even for a force-push.
- Both revisions must be full lowercase 40-character commit SHAs. Unsupported events or malformed payloads fail selection instead of skipping work.
- `--no-renames` deliberately represents a move as deletion plus addition, selecting both old and new owners. NUL-separated parsing preserves spaces, newlines and other unusual filename bytes without shell parsing. Names are never written to Actions outputs or logs.
- Zero SHAs or unavailable Git comparisons select every check and warn. Full history normally supplies both endpoints; a force-pushed-away commit may be unavailable. Checkout failure itself fails visibly rather than pretending an empty change set.

There is no API file-list pagination/truncation and no native workflow `paths` 300-file selection ceiling. A 351-file real-Git regression verifies that a relevant file beyond 350 documentation paths is still selected. The bounded number of git subprocesses does not scale with file count.

## Decisions and rejected alternatives

1. **Keep existing reusable workflows, add one detector and native job `if` conditions.** This retains independent failure signals and avoids duplicating all check implementations into per-path workflows. Keeping the old required aggregate would contradict optional checks and could mishandle intentional skips.
2. **Native Git plus a small stdlib script instead of a third-party paths action.** This adds no action/dependency/API-token surface, supports fork PRs without elevated permissions, avoids API path-count limits and explicitly tests both sides of renames/deletions. YAML-only event filters cannot share per-job selection and have truncated-diff behavior. The script is not a generic rules engine: it is this repository's explicit dependency map.
3. **Targeted workflow-sync coverage instead of full backend tests for shared docs or workspace commands.** Mirrors and command delegates remain validated without paying the importer-suite cost for ordinary documentation. Backend and frontend code paths are asymmetric by default.
4. **Conservative all-check fallback for unavailable history.** A new branch or unreachable force-push base is not evidence that no relevant files changed. It is preferable to run extra checks with a warning than silently skip them. This is the deliberate exception to documentation-only cost savings.
5. **One frozen workspace install per selected Node consumer, as before.** No dependency caching framework, command-wrapper layer, new framework or speculative server test scaffolding was introduced. Full-history checkout trades a modest checkout cost for reliable comparisons.

## Verification

Validation used Python 3.12.3, uv 0.11.29, the pinned Node 24.22.2 and pnpm 12.16.1. The ambient shell Node was older; the already-installed matching toolchain was placed on PATH for pnpm checks, without changing repository toolchain declarations or global configuration.

- `python3 -m unittest discover -s .github/scripts -p 'test_*.py' -v`: **13 passed**. Includes matching/nonmatching/asymmetric paths, application/config/manifest changes, shared resources/agent formats, docs-only exclusions, mixed paths, empty diff, multi-commit push and deletion, rename out of backend and into frontend, newline/space filenames, divergent PR base versus push endpoints, unavailable history/no merge base/zero SHA, invalid SHA/event rejection, 351 changed files, and event-file-to-`GITHUB_OUTPUT` integration.
- `uv run --project backend ruff check --config backend/pyproject.toml .github/scripts`: **passed**.
- `uv run --directory backend ruff check --config pyproject.toml . ../.agents/skills ../.claude/skills ../.github/scripts`: **passed**, matching the expanded backend CI lint scope.
- `uv run --directory backend pytest tests/test_project_workflow_sync.py`: **7 passed**.
- `uv run --directory backend pytest`: **2038 passed, 4 skipped, 43 deselected** in 245.43 seconds. Skips/deselections are not counted as passing coverage.
- `pnpm install --frozen-lockfile`: **passed**, no manifest/lock changes.
- `pnpm typecheck`, `pnpm test:frontend`, `pnpm build`, `pnpm lint:frontend`: **passed**; frontend **2 tests passed**, production build succeeded. These root delegates call the same package commands now used explicitly in CI.
- `pnpm --filter @invimport/frontend typecheck`, `pnpm --filter @invimport/frontend test`, `pnpm --filter @invimport/frontend build`, `pnpm --filter @invimport/frontend lint`: **passed**, repeating the final workflow's exact package-scoped commands; **2 frontend tests passed**.
- `pnpm lint:markdown`: **passed** across the repository. `pnpm exec remark docs/handovers/bench-intake-T00-ci.md --frail --no-stdout` also **passed** for the new handover.
- `actionlint .github/workflows/ci.yml .github/workflows/test.yml .github/workflows/lint.yml` using upstream actionlint **1.7.12**: **passed** after the final workflow edits.
- `git diff --check`: **passed**.

## T01 integration interface and remaining limits

After this CI PR merges, T01 should incorporate it before changing the workflow files, avoiding parallel edits to this owner’s branch. Add actual server/contracts checks only once their package scripts exist:

1. Extend `CHECKS` in `.github/scripts/ci_paths.py` with `intake` (or separate `server`/`contracts` outputs if those are meaningfully independent). Both the all-check fallback and workflow-change selection automatically include keys in `CHECKS`.
2. Select the new output for non-Markdown under the actual `intake-server/` and `contracts/` roots. Select it for `WORKSPACE_INPUTS` too, since root pnpm manifests/lock and Node version affect their toolchain. Add actual shared TypeScript/ESLint config paths introduced by T01 to every consumer's selection. Do not add guessed future file paths without their consumers.
3. If frontend imports `contracts`, select `frontend` for contract code/manifests too; if another package imports server/contracts, model that dependency explicitly. Server-only changes must not select the Python importer or frontend unless they genuinely affect them. Plain Markdown under either new package stays Markdown-only.
4. Expose the new detector job output in `ci.yml`, pass an explicit boolean into each relevant reusable workflow, declare the corresponding required boolean `workflow_call` input, and gate actual jobs with `if: ${{ inputs.intake }}` (or the split equivalents). Preserve failures, native skips and the absence of any required aggregate/`continue-on-error`.
5. Use package-scoped commands for the new checks, just as frontend now does. A root aggregate `pnpm typecheck`/`build` must not cause a frontend-only job to run the server suite. If `test_project_workflow_sync.py` begins reading additional server/contracts command targets, add those manifests to `workflow_sync` selection.
6. Extend the executable selector regressions for server-only, contracts-only, root dependencies, shared configs, documentation-only, unknown paths, and cross-owner renames/deletions; rerun actionlint with the new output/input wiring and the actual package commands. No server/contracts output exists before that integration: landing such code without extending this map would leave it unchecked except for root/workflow changes.

The root README **Commit hooks and CI** paragraph and root architecture **Workspace and data ownership** paragraph describe the previous aggregate gate. They are shared files intentionally left to the concurrent root-documentation owner, not silently edited here. T01/coordinator must replace those two active CI descriptions with the optional/path-aware behavior above when reconciling root documentation; in particular remove the README instruction to require **CI**. Historical handovers remain historical. This handover is the current CI contract for this isolated task.

Local tests exercise actual Git histories but cannot themselves prove hosted fork permissions, GitHub rendering of skipped reusable jobs or GitHub's runner execution. Hosted CI results on the ready head should be inspected by the coordinator; no fork PR or destructive branch-force-push was created just to test infrastructure. Selector regressions always run even when application jobs are skipped. The normal backend suite excludes scanner/TUI tests by existing pytest configuration; scanner dependencies and Docker/live services were not introduced. Any external CI review/rate-limit failures remain visible, not force-passed. Independent review, ruleset provenance and merge authorization are separate from these local checks.

## Material review follow-up after PR #39

The user merged [PR #39](https://github.com/MitchReyno/InvenTree-Importer/pull/39) before the independent reviewer reported two material P2 dependency omissions. This focused correctness follow-up starts on `fix/ci-backend-consumer-paths` from fetched `origin/interactive-app` commit `0134e1bf4d92fd4c6f6e5e78cccf72885637facb`. The original branch/history and other worktrees remain intact; no reset, clean, sibling-branch import or size-driven deletion was used. The coordinator will resume the original reviewer after the separate ready PR; this owner does not launch a reviewer or merge.

### Findings and smallest fixes

1. **Shared skill Python did not select its behavioral consumers.** `backend/tests/test_crop_scripts.py` runs the crop/grid scripts with uv against synthetic images; `backend/tests/test_logo_scripts.py` imports and exercises company-logo scripts with mocked downloads. Mirror equality and Ruff cannot catch the regressions those tests cover. A Python change under either `.agents/skills/` or `.claude/skills/` now selects `backend`, retaining `backend_lint` and `workflow_sync`. Although the behavior tests execute the Claude copies, a Codex-only change must also select the backend suite: its included workflow-sync assertions catch a missing mirror update, and a correctly mirrored change must run the behavioral checks. Ordinary skill Markdown/JSON/images still select only their existing targeted sync/Markdown checks, not the backend suite.
2. **The API schema under docs is executable test input.** `backend/tests/support.py` sets `SPEC_FILE` to `docs/InvenTree API.yaml`; `spec_paths()`/`spec_path_regexes()` derive the InvenTree stub's accepted routes from that file, and `InvenTreeStub.__init__` consumes them. This exact path now selects `backend` only. It does not unnecessarily select lint, frontend or all documentation. The existing native Git delete/add representation of renames preserves old-path ownership even if the spec is removed or moved into an unrelated YAML name.

No new output, reusable-workflow input, job, package command or dependency was necessary. The existing backend suite is the source of truth rather than introducing a second selected test list that could drift. Splitting out another backend behavioral job was rejected as unnecessary scope for these two omissions. Selected job failures continue to fail: no workflow YAML, optional-check rules, exit handling or failure masking changed.

### Regression evidence and checks

New tests first ran against the unchanged selector: **16 tests ran with 7 failing assertions/subtests**, reproducing all four independent crop/logo mirror cases, API-spec modification, deletion and rename omissions. The existing resource/docs/asymmetry controls passed. The same test command after the source fix passed all 16 tests. The API-spec deletion/rename cases exercise actual disposable Git histories on both push and PR comparisons, rather than assuming paths are present in a supplied list.

- `python3 -m unittest discover -s .github/scripts -p 'test_*.py' -v`: **16 passed** after the fix.
- `uv run --project backend ruff check --config backend/pyproject.toml .github/scripts`: **passed**.
- `uv run --directory backend ruff check --config pyproject.toml . ../.agents/skills ../.claude/skills ../.github/scripts`: **passed**, matching the existing CI lint scope.
- `uv run --directory backend pytest tests/test_crop_scripts.py tests/test_logo_scripts.py tests/test_project_workflow_sync.py`: **49 passed**, no skips, including the actual skill behavioral consumers and mirror/workspace assertions.
- `uv run --directory backend pytest tests/inventree`: **818 passed**, exercising the API-spec-backed local stub consumers.
- `pnpm exec remark docs/handovers/bench-intake-T00-ci.md --frail --no-stdout`: **passed**, using the pinned Node/pnpm toolchain already available for the original task.
- `git diff --check`: **passed**.

The original full-suite and actionlint evidence above belongs to PR #39; this follow-up reruns the relevant behavioral suites and selector/Ruff checks rather than presenting the old full-suite run as new evidence. No workflows, application behavior or frontend files changed. No Docker, real server, root `.env`, inventory/provider calls, secrets, root manifests, locks, guidelines, skills or datasets were touched. Synthetic local stub traffic in ordinary tests is not a live InvenTree request.

### T01 handoff and limits

T01 should integrate this fix from trunk before reconciling its new server/contracts selector outputs; preserve both explicit backend dependencies and all 16 selector regressions. This follow-up deliberately adds no competing output/input extension. The current dependency map remains explicit: later consumer additions must update it. Ordinary docs stay cheap, but an executable schema or script must be classified by its actual consumers rather than its directory label. Hosted CI execution and independent re-review remain separate from local validation; this owner has not claimed approval or merge permission.

### Planning chronology, reuse assessment and remaining-work plan

**Truthful chronology:** the new standing requirement to write a task-specific plan before implementation arrived after this follow-up had already been implemented, checked, committed as `45ac04d76c25de59c711441a4e398226670896d4`, and published as ready [PR #40](https://github.com/MitchReyno/InvenTree-Importer/pull/40). Before that implementation, this owner read the selector, its tests and the actual crop/logo/API-stub consumers, then added failing regressions before changing the source. However, no task-specific written plan preceded those edits; this section does not claim retroactive compliance. Existing work is preserved. The following plan is recorded before any further implementation changes, and no further source change is currently needed.

**Goal and researched approach:** use the existing `select_checks()` dependency map to select the already-maintained backend suite for Python under either skill mirror and for the exact API-spec path. The authoritative local consumers are `backend/tests/test_crop_scripts.py`, `backend/tests/test_logo_scripts.py` and `backend/tests/support.py`; their execution/import/route-contract reads justify these two fix points. Keep resources/docs cheap, keep YAML-only API changes free of unnecessary lint, preserve both sides of renames/deletions, and leave selected failures real. The 16 detector regressions, 49 behavioral/sync tests and 818 InvenTree tests recorded above demonstrate those choices without live inventory access.

**Reuse and package alternatives:** retain the repository's native Git comparison, stdlib selector/unittest harness, existing reusable workflows and existing pytest consumers. This correction adds two dependency rules, not a new detector or test framework. A maintained third-party path-filter action is a viable alternative if the repository later needs richer general filtering, but replacing the existing detector would add an action dependency and migration/revalidation work without removing the need to declare these same consumer dependencies correctly. Workflow-level path filters alone do not replace the existing per-job dependency map. No new package is justified here, and no unverified package behavior is relied upon; the relevant uncertainty was resolved by reading actual local consumers and running their existing tests.

**Remaining sequence (small, documentation-only):**

1. Record this chronology, consumer analysis, alternatives and plan in this handover without changing the completed source/tests or overwriting another owner's work.
2. Run `pnpm exec remark docs/handovers/bench-intake-T00-ci.md --frail --no-stdout` and `git diff --check`; compare against `45ac04d76c25de59c711441a4e398226670896d4` to verify that only this handover changed. A failing check must be resolved, not masked. Source tests need not be rerun for this documentation-only addition; their exact existing results remain attributed above.
3. Commit/push the documentation to the same open PR #40, refresh its description and exact-head CI subscription to the source coordinator thread, and report the new ready head. Do not merge, launch a reviewer, introduce a sibling branch's changes, or reduce work to meet a line-count target. T01 still integrates the two rules and regressions via trunk.

For future implementation tasks, the task-specific written plan must precede the first implementation edit; reading/analyzing code is necessary but not a substitute for recording that plan. The standing requirement does not require waiting for user approval.
