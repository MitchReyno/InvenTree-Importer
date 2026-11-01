# Proposed TypeScript data model: owner handover

## Scope and decisions

Snapshot: 2026-11-01. Decision owner: Mitch Reynolds. Latest request: publish this data model as a PR and duplicate/adapt the earlier whole-application design for TypeScript as another PR. Start at the [model index](../typescript-data-model/README.md), then read all six chapters. This is documentation, not an application, migration or live-write authorization.

Earlier in the thread Mitch chose a quick Python implementation and asked to preserve its solution design separately. He then reopened the TypeScript option, accepted a selective clean-slate approach and requested its data model. The earlier Python design is preserved unchanged on `docs/bench-intake-solution-design`. Do not merge these proposals into one contradictory active architecture or infer that Python canonical history is to be discarded.

## Branches and delivery state

| Item | Recorded state |
| --- | --- |
| New model branch | `docs/typescript-data-model`, own worktree refreshed onto `40ea1f1ef3aba20865b10f96926eb19b7217a79e` after Stage 1E merged |
| New files | `docs/typescript-data-model/README.md`, six chapters and this handover; reviewed design prepared for authorized publication |
| PR dependency | Base `feat/spike-shared-contracts` while PR #29 remains open toward `interactive-app`; adapted whole-app branch `docs/bench-intake-typescript-design` sits above this model |
| Earlier Python design | Separate worktree/branch, uncommitted docs retained; not copied or rewritten |
| Stage 1E | [PR #33](https://github.com/MitchReyno/InvenTree-Importer/pull/33) merged into `feat/spike-shared-contracts` at `2026-11-01T06:53:04Z`; merge commit [40ea1f1](https://github.com/MitchReyno/InvenTree-Importer/commit/40ea1f1ef3aba20865b10f96926eb19b7217a79e), reviewed head [74edc06](https://github.com/MitchReyno/InvenTree-Importer/commit/74edc068ea0a5f65f0994983eddba878dd77e2bb) |
| Dependency | Shared-contract [PR #29](https://github.com/MitchReyno/InvenTree-Importer/pull/29) remains open/draft at refreshed merge snapshot, not landed in `interactive-app`; update dependent bases when it lands |
| Initiative trunk | `interactive-app`; never merge automatically |

Refresh with `git status --short --branch`, `git rev-parse HEAD` and `git worktree list`. PR/CI state is time-sensitive: use authenticated read-only GitHub operations before relying on this snapshot. Stage 1E's exact-head CI subscription completed with all six checks successful; its comment/review subscription reported the merge, independently confirmed through GitHub reads and by Mitch. The coordinator did not perform the merge. No review-iteration loop or deployment was authorized. Only its reviewed owned file groups were committed, and its implementation/test fingerprints remain unchanged.

## Model summary and alternatives

The coordinator recommends PostgreSQL as the new TypeScript product and execution-journal authority, plus private immutable blobs. Keep sources/contributions, physical lots/shared Part proposals, retained evidence, candidate assertions, human selections/defaults, immutable research inputs, question continuations, exact plans/approval rounds and actual remote-request/effect history distinct. Cross-batch composite FKs and transactional commands prevent mixing otherwise valid IDs from unrelated work.

Subsequent user decisions: host the separate Bench Intake database/role in the existing InvenTree PostgreSQL instance; use InvenTree identity through a supported integration; require the user to possess every permission needed by the supported feature set, with a blocking initial-load error otherwise. The model now specifies issuer/subject identity, effective user-permission plus token-scope checks, distinct denied/unverified/sign-in states, no privileged-service bypass and current checks before approval/dispatch/privileged requests. Added adverse acceptance cases for missing rights/scopes, unavailable introspection and mid-run revocation. Exact deployed-version permissions, identity claims and reliable introspection remain untested qualification gates; no live configuration, credentials or inventory were inspected/changed. Shared PostgreSQL is not permission to share InvenTree tables or credentials. These documentation additions postdate the bounded independent model re-review.

Unlike Python's application-to-filesystem seam, approval/run reservation/initial journal can commit together in PostgreSQL. Remote inventory effects still cannot join that transaction. A lost response, surviving process or old restored database does not authorize replay. Non-expiring source guards, stable host process exclusion and an external restore activation gate remain required. Choosing PostgreSQL is a design recommendation, **not a proven TypeScript executor or job-runtime capability**.

Alternatives considered: port every Python table/feature (rejected as unnecessary breadth); keep Python executor under a TypeScript app (valid other architecture, not this requested clean-slate model); universal EAV/event sourcing/workflow engine (rejected); a single opaque batch JSON (cannot express required identity/authority constraints); expiring writer leases (cannot prove an old process stopped). Authentication tables remain maintained-library-owned rather than another bespoke auth system.

## Validation, review and limitations

Final checks passed: configured Markdown lint on all eight new Markdown files; all 19 local links; balanced fences for 12 diagrams; whitespace and portable-path checks including untracked content; and extracted illustrative TypeScript under strict no-emit TypeScript checking. The initial compiler check found a global DOM `Selection` name collision; it was renamed to `FieldSelection` and the same check passed. No application/backend suite, PostgreSQL DDL, provider login/inference, target call or production migration was exercised by this design.

Independent design review found two material gaps: source serialization did not explicitly prevent repeated stock creation in a later preparation, and batch-only FKs did not guarantee exact job/attempt/message ownership. The owner added cumulative contribution-history checks under the source guard at preparation/approval/request authorization, original-run-only recovery, exact-parent composite FKs and adverse acceptance cases. The owner also made shared Part/lot preparation review bindings relationally explicit. Clean bounded re-review confirmed both findings resolved and no remaining material issues in the changed relationships. This is design clearance, not DDL/runtime/concurrency acceptance. Final merge-status and handover-only updates occurred afterward; they do not change model semantics.

A subsequent fresh independent reviewer read the complete model and handover, including the shared-instance and InvenTree-permission additions, and reported clean bounded clearance for a design-only PR with no material blockers. It checked cumulative contribution history, exact-parent FKs, exact approval, delegated authority, current rights, worker separation, unknown effects and restore gating. It checked official InvenTree API documentation for the limited OAuth2/OIDC route but did not qualify the installed server or rerun tests. Only publication/dependency and review-record prose changed after that clearance.

The table catalogues describe keys, columns, nullability and cross-row rules; they are not executable migrations. The worked example and adverse acceptance matrix are future requirements, not claimed test passes. Actual ORM/SQL constraints, exact-byte vectors, process exclusion, cursor ordering, restore and TypeScript target behavior require their own implementation evidence. No estimated effort or table count should be read as guaranteed code size or a demand to scaffold future features upfront.

Stage 1E's independent reviewer reproduced 44 combined/shared cases with zero skips on fresh owned PostgreSQL/process/fake-target state. Its proof replays retained provider output plus authored adverse controls; it does not establish fresh inference, native billing/permission/restart parity, production browser auth/SSE, restore or live target compatibility. That separate PR does not commit this design to Python.

## Next steps and hard rules

1. Publish the reviewed data-model PR on the stated dependency base under Mitch's explicit request, followed by the separately reviewed adapted whole-app PR. Leave the Python proposal unchanged. Never merge automatically.
2. Resolve implementation library pins and first host/provider/effect scope before producing real migrations. Validate every SQL and command invariant, not only generated types.
3. Implement the narrow manual/fake-target vertical slice before broad feature parity. Use the worked two-lot example and adverse matrix as acceptance scenarios, deriving expectations independently.
4. Never move/reset/migrate Python canonical history, share personal credentials, fall back to paid APIs, infer unsupported subscription deployment permission or mutate live inventory. New source/target aliases cannot bypass uncertainty.
5. This design's publication is explicitly authorized; obtain separate scoped authorization for implementation or a live pilot. Neither the design PR nor Stage 1E publication grants migration/live-write permission. Refresh dependency bases if consolidation lands.

No worktree, untracked skill, local dataset, canonical run or retained spike evidence may be removed. Use portable repository paths and one source line per Markdown paragraph. Every design guarantee is proposed until implemented/tested. Ordinary source edits and provider/runtime native permission requests have different authority; preserve that boundary.

## Skills and locations

Use **github-pr-tools** for PR reads/authorized operations; **gh-stack** for dependent bases; **handover** for future transfer; **openai-docs** tools for Codex research; **browser-harness** for implemented UI checks; **pr-review-loop** only when explicitly asked to iterate review. No skill files changed. The working locations are discoverable with `git worktree list`; all new tracked-intended paths are listed above. No cloud document/transfer pack is necessary for this repository-native design.
