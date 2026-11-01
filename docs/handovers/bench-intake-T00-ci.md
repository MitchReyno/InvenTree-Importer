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
| Resources under `.agents/skills/`, `.claude/skills/`, `.claude/agents/`, `.codex/agents/` | Targeted shared workflow sync; also Markdown lint for Markdown or backend lint for Python |
| `.remark*` or `.gitignore` | Markdown lint |
| Non-Markdown under `.github/workflows/` or `.github/scripts/` | All existing checks, so workflow/filter changes validate their consumers |
| Empty diff, unrelated paths such as `LICENSE` or issue-template YAML | No application/lint jobs; selector regression check still runs |
| Missing comparison history, no merge base, new/deleted branch zero SHA | All existing checks, with a visible warning rather than a false empty diff |

The output keys are `backend`, `backend_lint`, `frontend`, `markdown`, `workflow_sync`. Caller job output names use `backend-lint` and `workflow-sync`; reusable workflow inputs use `backend`, `frontend`, `workflow-sync` for Test, and `backend`, `frontend`, `markdown` for Lint. Comparison to the string `'true'` is explicit before passing actual booleans to the called workflows. Required typed inputs avoid accidentally running an unfiltered reusable workflow.

Backend's normal suite already includes `backend/tests/test_project_workflow_sync.py`, so a selected backend suite handles those assertions without duplication. Otherwise **Test / Shared workflow sync** runs that test file alone when relevant. That test reads both mirrored skill trees, both agent formats, root workspace scripts and frontend script targets: skill documentation/resources and frontend manifest changes must not lose that coverage. Ordinary documentation does not select the backend suite. Shared-skill Python selects backend lint because Ruff already owns those scripts; Ruff now also covers the new CI Python scripts.

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
