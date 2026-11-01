# Separate CI lint and test checks

## Scope and dependency

Mitch requested separate frontend/backend lint checks and corresponding test names, then explicitly requested a stacked PR above the existing CI PR #25. This layer is `ci/split-lint-and-test-checks`, initially based on `ci/pre-commit-and-required-gate` at `3790a7c47f8916429fe7be04766d4463c25b47ef`. While validation ran, Mitch merged #25 into `interactive-app` at `9c269f91579c4cea6f6461c16478d9dc645aca46`. The merged tree exactly matched the parent, so this layer fast-forwarded to that merge without changing its reviewed content and now targets `interactive-app`. Parent commits remain unchanged; do not merge automatically or change branch protection.

Read `.github/workflows/ci.yml`, the root README and architecture, and the parent [tooling handover](commit-hooks-and-ci.md). Its single-lint-job description records the earlier layer; this document describes the requested follow-up. No importer/provider/UI behavior, local hooks, manifests, locks, fixtures or inventory is changed.

## Decisions and alternatives

- Use scope-first slash-separated check names per Mitch's latest preference: `backend/lint`, `frontend/lint`, `markdown/lint`, `backend/test` and `frontend/test`. GitHub's displayed job names establish the check names; internal backend/frontend job IDs remain stable for the aggregate gate.
- Replace the combined lint job with three independent jobs, with no dependencies between them. Each reports its own real failure; one language's failed lint cannot skip another. Markdown remains advisory alongside backend/frontend lint, without `continue-on-error` masking.
- Install only the toolchain each lint job needs. Backend runs the exact Ruff command owned by the root `lint:backend` script, using uv without a Node installation. Frontend and Markdown use the pinned Node/pnpm toolchain and frozen workspace installation without Python.
- Rename the existing separate test jobs rather than introduce another test matrix or alter test selection. Frontend retains its typecheck, unit tests and build; backend retains the normal non-TUI pytest suite including shared workflow/fixture checks. This request does not remove existing required validation or reclassify all Python integration cases as unit-only tests.
- Keep **CI** as the sole aggregate gate over the two blocking test jobs, with `always()` and strict success/success handling. All lint jobs are excluded; failed, cancelled or skipped tests still fail the gate. Existing branch rules naming old backend/frontend checks may need a deliberate human update; this PR does not edit shared settings.
- Prefer explicit jobs to a matrix with conditional Python/Node setup: the small toolchain-specific blocks stay readable and no expression has to select a runtime or command. No new reusable workflow or helper abstraction is warranted.

These are a presentation and isolation change to CI, not a relaxation of test or lint coverage. Retain the earlier known Markdown warnings rather than bulk-edit unrelated reference documents.

## Validation and independent review

- Normal `pnpm test`: **1,943 backend passed, 1 skipped, 43 scanner/TUI deselected; 2 frontend passed**. No test selection changed.
- Backend Ruff, frontend ESLint, frontend typecheck/build, actionlint 1.7.7, remark on all three changed Markdown files and `git diff --check`: **passed**.
- The actual aggregate shell command was executed for all 16 success/failure/cancelled/skipped test-result combinations; only success/success returned zero. Parsed workflow comparison verified both test jobs are unchanged except display names, the aggregate is unchanged, all three lint jobs are independent and unmasked, and the backend lint command exactly matches the root script's scope.
- Whole-repository Markdown lint returned **exit 1 with the same 27 inherited warnings**, not a pass. No unrelated Markdown was bulk-fixed. Parent hosted CI also passed backend/frontend/aggregate while that known advisory lint failed; those hosted results predate this layer.
- No permanent configuration-shape tests, new tools in repository manifests, local hook installation or protection-setting changes were added. Scratch probes exercised actual commands rather than adding maintained YAML-structure assertions.

Fresh independent review cleared the scope-first candidate with **no material findings**. The reviewer independently compared test-job bodies, unchanged aggregate semantics, exact Ruff scope, independent toolchain-specific lint jobs and documentation, and checked whitespace. It did not duplicate the author suites/actionlint/lint/gate probes. Cleared SHA-256 values: workflow `e5b32b101dab78cc3b01e2f3214810926bb2bac05b4fbb023b616bf4bc8c3eab`; README `b801915737b2c5ac692d48a71287357e5869de46e0f629ef4cae4af3b2316139`; architecture `2eeacfde1bb5b16dffcb749a3d0fc8d62ad69b3adaacd283fc004af8b35d6301`; pre-record handover `e80e1a5b8a7f2a04b577639aa8876cd2e8289b37cfd156e74ec139c62fab2f43`. Only this handover's validation/base record changed afterward. Hosted GitHub scheduling/check-name behavior remains to be observed after publication; local review does not establish those results. Whole-workflow cancellation can cancel the aggregate too, but cannot make unsuccessful test dependencies produce a successful gate.

## Continuation and limits

1. Validation and fresh independent review are complete for the recorded candidate; obtain re-review for substantive changes.
2. Commit/push only this follow-up layer, open its PR against `interactive-app` because #25 already landed, and subscribe to exact-head CI plus PR comments/reviews. Use `gh-stack` for the dependency lifecycle and `github-pr-tools` for PR publication; read current PR text before editing.
3. Preserve the merged parent, worktrees and local data. Verify the PR diff contains only this follow-up. Do not merge automatically, rewrite published history, install common hooks or modify repository protection.

Prior hook fault-matrix results remain parent evidence, not new results from this layer. Local command validation does not execute GitHub's runner provisioning, concurrency or cancellation machinery. No production, live inventory or provider action is authorized.
