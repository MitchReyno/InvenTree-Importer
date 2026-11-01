# Stage 1C — importer adapter engineering handover

Task: establish the approved importer/application boundary against the shared two-lot fixture, without weakening canonical ownership, effect certainty or selected approval. Repository: MitchReyno/InvenTree-Importer. Tickets: none. Decisions owner: Mitch; coordinator owns shared contracts and publication. Snapshot: 2026-11-01 04:58 UTC. Refresh the exact local branch/HEAD and all preserved worktrees using `bash spikes/importer-adapter/state.sh` before reviewing or continuing.

## 1. Where things stand

| Item | State |
| --- | --- |
| Baseline | Shared commit `a4e16686a4c6f563a9dc28aefd94481af5dedf77`, after merged Stage 0; initiative integration trunk is `interactive-app`. |
| Owner branch | `feat/spike-importer-adapter`; implementation candidate, awaiting fresh independent review. Use the live-state script for exact HEAD. |
| Publication | No push, PR, merge, deployment or live inventory write by this owner. Coordinator must obtain a fresh review, owner fixes and a clean re-review before publishing. |
| Other work | Parallel provider/coordinator owners and every existing worktree/data set preserved. Shared schemas, fixtures, root docs and manifests/locks are unchanged. |
| Background work | Final normal suite finished successfully; no background validation remains running. Results and retained evidence are below. |

This is the tracked handover specifically requested by the user, rather than an external portable pack. Paths in repository documents remain repository-relative under project policy; the receiving prompt supplies the absolute checkout path outside repository files. No separate provider/runtime or Django service implementation is implied.

## 2. The plan in one page

Read the shared guide `spikes/shared/README.md`, its schema and fixture; the user's local `intake-shared-fixtures-and-spikes` handover and full product/design/plan snapshots remain the authoritative product input. Stage 1C proves read-only preparation, persisted questions, frozen selected approval, canonical start/adoption, supervised serial execution, truthful progress/cancellation and selected repair. `docs/import-execution-plan.md`, backend architecture and existing execution contracts retain all engine safety constraints.

The common case retains source `SPIKE-TWO-LOTS-001`, shared Part `resistor-100r`, and physical contributions `lot-a`/`lot-b`. First approve only lot A and its shared prerequisites/evidence. A second approval uses the original known shared Part PK/IPN, the same source and lot B's original stock key. The real SDK sends actual loopback HTTP; the fake retains records, media, barcodes, faults and request traces in its private SQLite database. Engine journals and registry use one stable owned state root. Later incomplete approvals never create a new namespace to bypass the earlier run.

Native Observation datagrams are best-effort projection hints. Canonical validated snapshots survive dropped IPC and absent application result publication. Approval intents bind the exact Plan.revision and embedded artifact bytes before dispatch; starting after redelivery inspects canonical state first. Existing initialized runs are adopted, not implicitly resumed. Missing journals and earlier unresolved claims require explicit supported recovery. No live server capability is established by the fake.

## 3. Decisions, rationale and alternatives

1. **Reuse the stock engine rather than rebuild it** — user Stage 1C brief, 2026-11-01. The existing handlers already checkpoint outputs, preserve unknown creates and verify attachment bytes. Rewriting these policies in an application would multiply safety contracts without evidence of a benefit.
2. **Extract a narrow public inspection seam** — owner source inspection, 2026-11-01. `Registry.locate` requires a known run ID, while IDs are allocated inside execute and reservations can precede journal creation. `execution.adoption.inspect_binding` plus registry-owned `inspect_binding` discovers by deterministic location/revision and current same-source claim, including completed historical runs. This avoids copying the demo's private registry SQL into an application. It does not execute, resume, clear claims, invent run IDs, change schemas or authorize writes; ordinary engine locks remain mandatory.
3. **Persist exact approval before dispatch; adopt instead of replay** — user design/brief, implemented by owner. A content-addressed intent stores Plan bytes, selected scope, source/input/config/artifact hashes, target, fake database nonce, build and relative private state binding. Redelivery retains the same key. There is no atomic application-Postgres-to-engine-SQLite transaction claim. Files are a bounded local spike substitute; Stage 1B owns actual transactional dispatch/outbox evidence.
4. **Freeze artifact bytes in the prepared plan** — owner, following existing engine behavior. Original-byte hashes and embedded base64 bytes are validated; source edits after approval cannot silently change the applied packet image. Existing evidence and metadata policies remain unchanged. Archives/provenance are explicitly disabled for this selected artifact experiment, not silently dropped requested work.
5. **Filter v2 before expansion; explicitly resolve known Part across rounds** — owner after inspecting `stockfile` and `DomainPreview`. V2 expansion generates `part_of` for subsequent same-Part lines. Filtering expanded lines would leave a dangling reference or tempt importing the parent stock. Filtering raw v2 lines keeps the shared Part and only selected lots. Later known PK/IPN is checked against the fake before preparation and frozen into engine baseline identities. v1 `part_of` extraction is explicitly unsupported in this adapter; no extra parent lot is approved implicitly.
6. **Questions end preparation instead of parking an apply slot** — user design/brief. Missing synchronous choices raise a typed waiting exception after saving a shared-schema question. Preparation lock exits, and another intake can prepare. Answers validate shared context/question revision and offered values; local fingerprints include planning input, candidates and scope. Supplier creation uses the engine's explicit callback mode (`create_suppliers=False`); the callback's recorded `new` choice is still an explicitly previewed create, not a global configuration write.
7. **Unix datagram IPC with lossy projection and canonical fallback** — owner default, not a production protocol decision. Nonblocking 4096-byte sends bound transport/backpressure without making observer latency a dispatch dependency. A separate stdin channel requests cancellation, including on supervisor loss. Full engine observations remain invocation-retained; an application cursor/SSE store and Windows transport are deferred. Socket EOF/reset is normal and cannot alter engine effects.
8. **Keep serial isolated processes and all native reconciliation rules** — user brief. The existing SDK/global ledger remain within one child at a time. A private apply lock prevents a replacement while the old child lives; canonical engine guards protect source ownership. A timeout leaves the same child under caller control; no automatic kill/new execution or generic mutation retry exists.

Defaults not separately approved by a human: local intent/question file layout, Unix datagram transport, source/lockfile build fingerprint, synthetic actor labels and one-Part known-PK/IPN materialization. These remain spike choices pending reconciliation with the other owners.

## 4. Changes and public contracts

| Files | Responsibility |
| --- | --- |
| `spikes/importer-adapter/adapter.py` | Private fixture initialization, strict JSON/schema boundary, selected materialization, callback adaptation, immutable preparation/approval, source/dependency build digest and start/adopt orchestration. |
| `spikes/importer-adapter/questions.py` | Persistent typed questions, candidate/input fingerprints, answer allowlists, obsolete/conflicting answer refusal and waiting exit. |
| `spikes/importer-adapter/supervisor.py`, `worker.py` | Isolated child/environment, cancellation, bounded structured IPC, explicit selected repair and fresh-process canonical snapshot fallback. |
| `spikes/importer-adapter/fake_server.py` | Persistent one-shot successful-application ack loss and held acknowledgements, extending the existing loopback fake only. |
| `backend/src/invimport/execution/adoption.py`, `ownership.py` | Public canonical binding inspection and registry-owned lookup; no schema or engine execution-policy changes. |
| `backend/tests/spikes/test_importer_adapter.py` | Actual SDK/HTTP/process/persistence regressions, including two approval rounds and failure matrix below. |
| `backend/ARCHITECTURE.md` | Public adoption seam, authority/lease distinction and limitations. |
| `spikes/importer-adapter/README.md`, `state.sh`, this handover | Reproduction, read-only live state, engineering decisions and review transfer. |

`inspect_binding(plan, directory)` returns `None` only when no registered binding/earlier unresolved claim is found and the deterministic directory is unoccupied. A matching initialized binding returns run ID, registry state and canonically validated snapshot. A registered missing/unsafe journal returns `recovery_required` with no snapshot. Missing authority, conflicting revision, multiple bound runs, unmatched incomplete claim or another earlier unresolved same-source claim fails closed. Inspection is not a writer lease and does not prove remote continuity. Existing engine execute/resume/repair retain target continuity, current-record identity and claim checks.

## 5. Fault evidence and validation

The focused suite uses the actual installed SDK, real local HTTP, SQLite and fresh executable children, not monkeypatched inventory methods. The reservation-death case injects an immediate process exit at the real post-claim/pre-RunStore boundary; all earlier claim writes are genuine. Fake server restarts retain the database, original port and consumed fault. The tests contain synthetic approvals/answers and no real credentials.

| Required fault/boundary | Evidence and observation |
| --- | --- |
| Commit before dispatch | Approval intent exists with zero stock before `Child` starts; later delivery completes it. Local-file commit evidence, not a Django/PG transaction test. |
| Result publication loss / duplicate intent | First child result discarded; redelivery adopts same canonical run/outputs with unchanged fake records. Completed round A remains discoverable after round B supersedes the completed claim. |
| Reservation before journal death | Fresh process exits77 after canonical reservation but before journal initialization; inspection returns recovery required and redelivery makes no Part/stock. |
| Old child alive / redelivered intent | Fake holds accepted stock response while duplicate child attempts dispatch; duplicate fails ownership, original is settled/cancelled under the same binding. |
| Unknown stock create | Fake applies stock then closes connection without response. Unknown canonical outcome survives redelivery and explicit supported selected repair; stock count stays1; later same-source lot-B write is blocked. |
| Unknown attachment upload | Fake retains uploaded bytes then drops ack. Redelivery does not upload; selected engine repair uses supported remote-byte verification without adding another attachment. Original unknown attempt remains historical. |
| Cancellation during accepted request | Held accepted stock response receives cancellation through pipe; original accepted effects remain, no later POST/PATCH is dispatched, and redelivery adopts rather than retries. |
| Lost/dropped IPC and observer failure | Raising renderer is isolated. A deliberately blocked consumer causes nonzero child IPC drops; child still completes and fresh canonical snapshot recovers all operations without network. |
| Selected attachment repair | Persisted before-application attachment403 leaves known stock intact; restart and selected repair keep original run/operation revision and stock rows, then second approval completes. |
| Same-source unresolved prior run | Both failed attachment and unknown create/upload cases block later lot-B execution under original state root/source. No alternate identity or namespace is used. |
| Sequential rounds | Exact original source/barcode keys; quantities10/20, batchesSPIKE-A/SPIKE-B, one Part and two stock records. Known shared PK/IPN binds round2. |
| `part_of` | Real parser shows full v2 lot B refers to lot A; selected raw v2 lot B becomes standalone without extra parent stock. v1 dependency-only extraction rejects explicitly. |
| Frozen approval / build drift | Changed preapproval config, changed importer build, changed intent bytes and changed selection refuse; postapproval source packet edit does not replace approved embedded bytes. |
| Missing registry / changed revision | Real reserved registry loses authority or receives mismatched plan/location; inspection rejects and never creates another run. |

Final owner validation used the task-owned locked backend environment (Python3.12.3, `inventree==0.13.5`). A passed test is owner evidence, not independent approval.

| Check | Result |
| --- | --- |
| `backend/.venv/bin/python -m pytest backend/tests/spikes/test_importer_adapter.py -vv` with a new retained base directory | **11 passed in23.25s**, after the final deterministic held-response/cancellation gate change. |
| Execution/demo/shared/spike aggregate during implementation | **415 passed** before that final test-fixture timing change; the complete final normal suite below reran the included regressions. |
| `pnpm test` | **Frontend2 passed; backend1954 passed, 1 existing skipped, 43 deselected in251.80s.** Slow scanner/TUI selection remains excluded by the normal command; no scanner/TUI behavior changed. |
| `pnpm lint:backend` | Passed across backend and mirrored project workflow Python. |
| `backend/.venv/bin/ruff check --config backend/pyproject.toml spikes/importer-adapter` | Passed; this extra invocation includes repository-only spike sources outside the normal backend lint scope. |
| `git diff --check` and `bash spikes/importer-adapter/state.sh` | Passed; state script is read-only and prints branch, recent commits, preserved worktrees and base-to-HEAD statistics. |

Retained local evidence: `.amp/in/artifacts/adapter-final-focused.log`, `adapter-final-normal-suite.log`, `adapter-final-workspaces/` and `adapter-final-persistent-evidence.txt`. The last file is a read-only SQLite summary of the final persistent fake records/journals: completed and selected-repaired scenarios each have one Part/two stock rows with quantities10/20 and original barcode keys; stock ack loss retains uncertain attempts without a second stock; attachment repair retains the original uncertain attempt. Earlier `adapter-focused.log`, `adapter-fault-workspaces/`, `adapter-persistent-evidence.txt` and `adapter-normal-suite.log` are superseded development evidence. Private artifacts are retained in this checkout, not committed or suitable as portable canonical authority.

### Development failures corrected

- Initial question regression exposed that the full planner deliberately ignores company callbacks when automatic supplier creation is enabled. The adapter now selects the existing explicit callback mode, preserving the engine instead of changing callback semantics.
- Initial ack-loss probe did not consume its fault because SDK query parameters were included in the raw request path. The fake now matches the parsed URL path; the real unknown-write tests then passed.
- Initial event-drain threads reported connection resets on normal child exit. Drain now treats closed/reset datagrams as projection loss and exits; later focused tests have no thread-exception warnings.
- The cancellation test originally relied on a delayed HTTP response. It now holds an accepted response behind a bounded event gate, observes explicit child cancellation receipt, then releases that same response; this makes the in-flight cancellation boundary deterministic without weakening the assertions.
- Initial Ruff found one unused test import; removed. No failed assertion was weakened to manufacture success.

## 6. Plan adjustments, limitations and unmet criteria

- This is an importer integration spike, not an application delivery. Real Django/PG approval commit/outbox, enqueue-ack loss, provider waiting jobs, authenticated humans, application revisions/cursors, SSE, production credentials, retention and coherent backup/restore are not implemented or claimed. Stage 1B and subsequent application work own those gates.
- The fixture starts from the already-confirmed research proposal and confirmed input manifest. Its durable planning question is an actual supplier-choice callback, not invented OCR or a second recount. Full provider continuation with a newly materialized input/attempt after an answer remains the coordinator/provider boundary; these callback answers are stored planning decisions, not permission replies to a provider session.
- Unknown creates remain conservatively unresolved. No supported generic path is added to clear an uncorrelated stock create merely because the fake contains a matching-looking row. Thus the unknown-create scenario deliberately cannot advance to a completed second round.
- The adapter supports the fixture's v2 shared Part path. v1 `part_of` dependency-only extraction, arbitrary existing-record overwrites, historical stock corrections and broader taxonomy/PO changes are not delivered. The native engine still supports its previously documented policies; this experiment does not narrow or expand them.
- Build fingerprints require the actual compatible code and dependency lock. Changed builds reject rather than migrate active approved plans. Real upgrade/backup-predating-effects exercises are untested and remain release gates.
- IPC is bounded and lossy, but the current native Observation object still retains invocation events. No total-memory bound, durable event cursor, Windows process/IPC portability, distributed writer or exactly-once remote effect claim is made.
- Local trusted intent/question files are not an authorization server, encrypted secret store or adversarial multi-user filesystem boundary. Application authentication/roles, symlink-safe uploads, robust cross-file transactional acceptance and deployment hardening remain future work. The supervisor pins fake target/config/state and strips inherited live credentials; all test traffic is loopback.
- Power-loss durability of approval directory entries, journal corruption at every possible syscall, live InvenTree version/uniqueness/capability behavior and a restored old backup after newer remote effects are untested. Existing engine fault regressions are supplementary evidence, not a live-target guarantee.
- Root/shared docs, fixture schema and dependency manifests were intentionally not edited. Coordinator follow-up request: link this completed spike and reconcile adoption/identity/IPC decisions in shared design/plan after independent review; no shared-contract change is requested for the implementation.

## 7. Next steps and review process

1. Refresh local state and review the base-to-HEAD change using the code-review skill; gate: preserve all worktrees/local data and do not publish.
2. Independently inspect the public adoption seam, target/config/source/build approval binding, questions, cancellation, IPC/backpressure and real fault assertions. Re-run focused actual-SDK cases and inherited ownership/store/executor protections. Treat reservation/missing authority and unknown writes as hard review gates.
3. Return every blocking finding to this owner. Owner makes scoped fixes with regression tests and updates this handover; obtain a fresh clean re-review of the corrected exact HEAD before coordinator publication.
4. Coordinator reconciles Stage 1A/1B/1C contracts and decides production interfaces. Initiative PR base is `interactive-app`; this owner does not push/open PRs/merge.

## 8. Skills to use

| Skill | When | Purpose |
| --- | --- | --- |
| reviewing-code | Fresh independent review and corrected re-review | Evaluate behavior, safety and smallest required fixes against this brief. |
| handover | Owner/reviewer transfer | Refresh exact live state, decisions, tests and remaining gates. |
| github-pr-tools | Coordinator's later authorized publication | Authenticated PR/check handling; publication is not authorized to this owner. |

If these skills are unavailable, perform the same read-only code review, state refresh and authenticated publication workflow manually without weakening their gates.

## 9. Hard rules and gotchas

- Never use live inventory, global config writes, user canonical state, alternative source identities/state roots to evade uncertainty, generic mutation replay or legacy fallback. Do not delete/reseed existing workspaces. No agents/threads/push/PR from this owner.
- The old main checkout predates backend relocation. Run commands in this branch/worktree and use runtime-discovered repository-relative paths; don't migrate user data to compensate for old layout.
- The environment's default PATH did not expose `rg`; source searches used scoped `git grep` rather than a recursive whole-filesystem scan. Initial Python checks reused the existing locked shared-contract development interpreter read-only. Final checks used a task-owned `backend/.venv` installed with locked `uv sync`; the first offline attempt failed because flexparser was absent from the cache, then an isolated online cache installation succeeded. Frozen offline pnpm installation also succeeded with an isolated package store. No manifest/lock or global configuration changed; reproduce with the declared package tools rather than modifying shared environments.
- SDK fake faults must match parsed request paths, not query-bearing strings. A before-application403 and an applied-but-no-response fault intentionally have different certainty/recovery behavior.
- Questions must be answered with their original exact input/attempt/question revision. The automatic synthetic `new` answer is test-only; it is not a general human authorization policy.
- Keep the fake server's original port, database nonce, state root and journal files on restart. A completed run can be adopted after another round, but an unresolved same-source round still blocks new mutations.
- Review artifacts and scratch belong under ignored `.amp/in/` where needed. The local Git exclude entry is narrowly `/.amp/in/`, preserving all existing rules and tracked files; it does not ignore all `.amp/`.

## 10. Open items needing a human

| Item | Owner | Gates |
| --- | --- | --- |
| Exact independent-review clearance | Coordinator/fresh reviewer, then implementation owner | PR publication; owner checks do not clear this gate. |
| Production adoption/approval/cursor and deployment choices | Mitch/coordinator after all spikes | Stage 1D and application implementation. |
| Live-target compatibility and separately approved pilot | Mitch | Any real inventory write; none authorized here. |

## 11. Locations and transfer

- Worktree: this checkout on `feat/spike-importer-adapter`, based on the shared commit above; all changed paths are listed in section4. The state script lists all other worktrees read-only.
- Product/design/plan: user's external `intake-shared-fixtures-and-spikes` handover pack, plus committed shared guide/schema/fixture and `docs/import-execution-plan.md`.
- Reproduction/evidence: `backend/tests/spikes/test_importer_adapter.py`, `spikes/importer-adapter/README.md`; retained owner artifacts, when generated, are under `.amp/in/artifacts/` and are not portable execution authority or committed data.
- Memory: none written. No PR/ticket was created by this owner. Source records and engine journals are private synthetic local data, not a supported export/migration format.

### Receiving-agent kickoff

Continue Stage 1C in the existing adapter worktree. First read this entire tracked handover and run `bash spikes/importer-adapter/state.sh`. Independently review the exact implementation HEAD against shared commit `a4e16686a4c6f563a9dc28aefd94481af5dedf77`, especially canonical adoption, immutable selected scope, unknown effects and reservation-without-journal handling. Use reviewing-code for review and handover for transfer. Preserve all existing worktrees/local state. Do not push, open a PR, merge, launch other agents or call live inventory. Report findings to the coordinator; the owner must fix them and a clean fresh re-review must precede publication.
