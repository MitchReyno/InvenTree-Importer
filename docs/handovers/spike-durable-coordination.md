# Bench Intake Stage 1B: durable coordination — engineering handover

Task: prove the bounded Django/PostgreSQL/DBOS dispatch, human-wait and restart boundary using only synthetic shared fixtures. Repository: [MitchReyno/InvenTree-Importer](https://github.com/MitchReyno/InvenTree-Importer). Tickets: none. Decisions owner: Mitch; implementation defaults below are the Stage 1B owner's, pending independent review and Stage 1D reconciliation. Snapshot: 2026-11-01, with exact observed-run timestamp in the retained JSON report.

Refresh read-only state from the checkout: `sh spikes/durable-coordination/state.sh`. The user explicitly requested this tracked handover; paths here are portable repository-relative paths or environment-based references, not machine-specific checkout paths.

## 1. Where things stand

| Item | State |
| --- | --- |
| Branch | `feat/spike-durable-coordination`, originally based on shared commit `a4e16686a4c6f563a9dc28aefd94481af5dedf77`; user-authorized `git merge --no-edit feat/spike-shared-contracts` integrated `20a46a1b46a5011fd89f96b375908561c7cefaa5` in local merge `451e7c7`. Use the state script for current hashes. |
| Integration trunk | `interactive-app`; Stage 0 is merged according to the latest task instructions. Older planning snapshots' Stage 0 status and references to targeting main are superseded. |
| Publication/review | Not pushed; no PR opened. Independent review rejected candidate `878884101981ac38a5c093ea82e223722a95795e` with P1 actual-runtime-version binding and P2 unsupported synthetic journey findings. Owner fixes and new evidence are recorded in section 11; clean independent re-review is outstanding before coordinator publication. |
| Runtime | Real Django 5.2.8 ORM/migrations, DBOS 2.10.0 and PostgreSQL 17.11; Python 3.12.3, psycopg 3.2.12 and SQLAlchemy 2.1.6. Complete Python resolution is isolated in `spikes/durable-coordination/uv.lock`. |
| Process evidence | Current report: six legitimate DBOS workflows SUCCESS and ACKed, five logical jobs succeeded, one answered durable question. Three deliberately conflicting runtime rows ERROR with zero emissions, false ACKs and durable `runtime_metadata_conflict` dispositions; one deliberately unowned-ID row ERROR without extra app emissions. Three unsupported submissions rejected before any Job/Intent/Outbox rows. Both command SIGKILLs return `-9`; both recovered worker commands retain recovery count 2. |
| Local services | Probe-owned workers and PostgreSQL clusters are stopped by the harness. Database files/logs remain locally for inspection; no existing user service or inventory database was used or stopped. |
| Other owners | Stage 1A/1C worktrees and all shared files were preserved. No additional agents or threads launched. No shared manifest, lock, fixture, schema, root architecture or application source was edited. |

## 2. Authoritative plan and implemented scope

Read the source pack's `HANDOVER.md` and `artefacts/product.md`, `artefacts/design.md`, `artefacts/plan.md` in full under `$HOME/.agents/handovers/intake-shared-fixtures-and-spikes/`. They are source snapshots, not new permission. The latest user task authorizes Stage 1B and overrides older Stage 0/branch status. The shared contract at `spikes/shared/README.md` and adjacent schema, input/confirmed manifests, JSONL transcript and outcomes remain coordinator-owned; shared updates arrive only through the authorized branch merge, not owner edits.

The implementation follows Stage 1B: application transactions persist job/intent/outbox; stable workflow identity and payload binding survive duplicate delivery; DBOS alone claims a single serial workflow lane; questions are application records and finish the command; answers create immutable continuations; stale replies/results are rejected; a compatible restart recovers interrupted work and an incompatible version does not reinterpret it. This is an investigation under `spikes/`, not the Stage 2 application, an import approval model, an HTTP service or a new inventory execution engine.

The synthetic runner **replays** `bench-intake-spike/1` messages. It does not read the pictures semantically, infer a quantity, call a provider, establish subscription entitlement, execute an approved import or write inventory. The expected proposal is deliberately available to this synthetic runner; unlike Stage 1A, there is no claim that a model independently produced it.

### Files and responsibilities

| Location | Responsibility |
| --- | --- |
| `spikes/durable-coordination/pyproject.toml`, `uv.lock` | Isolated, pinned spike dependencies; no backend dependency expansion |
| `coordination/boundary.py` within the spike | Strict UTF-8 JSON, duplicate-key/nonfinite rejection, shared schema, canonical message content, exact-byte SHA and artifact containment/integrity |
| `coordination/models.py`, `migrations/` | Real Django application Job, immutable-by-API Intent, Outbox, accepted Emission and Question tables; migration 0002 adds durable outbox conflict disposition |
| `coordination/store.py` | Atomic intent creation, current-attempt/revision checks, sequence deduplication, persisted questions and immutable answer continuation |
| `coordination/runtime.py` | Explicit DBOS workflow/step registration and queue; fixture-only runner, worker entry, bounded fault pauses |
| `entry.py` | Separate migrate, submit, dispatch, answer, status and worker processes; real SIGKILL hooks at the requested commit boundaries |
| `probe.py` | Creates a new private persistent cluster; real child-process faults, SQL observations, adverse controls, cleanup of only owned processes |
| `backend/tests/spikes/test_durable_coordination.py` | Ordinary offline regression tests and explicit real-process opt-in |
| `spikes/durable-coordination/evidence/process-probe.json` | Portable observed SQL/result snapshot from the final standalone probe; full local logs/database are not committed |

## 3. Decisions, alternatives and plan adjustments

1. **Outbox default retained** — user/design requirement, implemented by the Stage 1B owner on 2026-11-01. Django `transaction.atomic()` encloses job, original manifest bytes, intent and outbox. DBOS enqueue is separate; acknowledgement is later. `on_commit` alone would lose committed work after a process crash. Same-cursor DBOS enqueue was optional and was not tested or adopted: no claim of transaction sharing with arbitrary Django transactions is made.
2. **Payload identity is application policy** — implementation owner, 2026-11-01, `store.py` and `runtime.py`. Workflow ID is `intake-` plus SHA-256 of canonical `(batch_id, job_id, attempt_id)`. A separate digest covers the normalized request plus explicit workflow application version. Reusing the stable ID with changed capabilities or version fails before enqueue; the worker also verifies actual `DBOS.workflow_id` equals the application intent ID. Do not assume DBOS compares arbitrary duplicate-ID arguments. Input revision separately hashes exact manifest bytes; semantic JSON normalization must not replace that hash.
3. **Explicit single worker, no ready hook** — user/design requirement, `entry.py worker` and `runtime.py`. Ordinary Django setup/migrations do not import the worker or launch DBOS. A real SQL assertion confirms the DBOS schema does not exist after application migrations/setup; only explicit worker startup creates it. The serial queue uses both global and per-worker concurrency 1. The outbox delivers commands; it has no independent lease/job-attempt scheduler.
4. **Application question plus completed workflow** — user/design requirement, verified against actual DBOS. Persist the question, then accept a waiting result referencing exactly those stored questions, then return the workflow. DBOS SUCCESS means the bounded command finished, not research finished: the application remains `waiting_for_user`. No `receive`, parked workflow or paid control plane is used.
5. **Immutable answer continuation, not in-place resume** — design requirement plus fixture-bounded implementation default. The trusted CLI supplies an actor separately from the answer's claimed actor. The original attempt/question/revision must still own the current job. The counted-20 answer is appended to a new input, verified against the exact authored confirmed-manifest bytes, and inserted as `attempt-2` with a new outbox in the same transaction as the recorded answer/current-attempt move. The first intent's bytes are unchanged. This is intentionally not a general question-answer or authentication service.
6. **Compatible-worker drain, not active workflow migration** — implementation default supported by observed DBOS fencing. Pin `bench_intake_command_v1`, `synthetic_runner_v1` and `coordination-v1`. Continuations inherit their original app version. A process labelled `coordination-v2` cannot consume old queued or pending work; restoring v1 drains it. This tests actual version isolation with the same fixture implementation, not a migration of genuinely changed application semantics. Retain compatible code for outstanding application questions too, even if their first DBOS command has already completed. If compatibility cannot be retained, require an explicit reviewed recovery disposition; never relabel old work or silently migrate an approved plan.
7. **Dependency isolation and local Postgres acquisition** — user requirement plus owner setup choice. Initial discovery found uv and PostgreSQL 12.22 binaries, no compatible preinstalled PostgreSQL. Django 5.2 correctly rejected PostgreSQL 12; the test was not weakened. The owner downloaded the official [Postgres.app 2.9.6 PostgreSQL 17 image](https://github.com/PostgresApp/PostgresApp/releases/download/v2.9.6/Postgres-2.9.6-17.dmg), mounted it read-only, copied the versioned binaries into owned ignored `.temp/coordination-tools/`, and detached the image. No GUI, Homebrew installation or existing cluster was modified. These version pins are reproducibility choices, not a production support/security-version decision.
8. **Small bounded app, no production expansion** — owner scope decision. A Django CLI command represents the command-side web transaction, so the required kill window uses a real separate Django process but not HTTP. Source identities `SPIKE-TWO-LOTS-001`, `resistor-100r`, `lot-a` and `lot-b` are preserved. The independent second-batch manifest is generated in the private copied bundle, with a new batch ID and exact new byte digest; no shared fixture is edited. Both batches use the same synthetic evidence and yield proposals only.
9. **Adverse controls must have explicit dispositions** — owner test adjustment. Login/capacity/interrupted/failed result acceptance and corrupt-output controls execute in explicit outer transactions that are rolled back after checking real DB behavior. Their observed outcomes are recorded separately. The initial probe retained only legitimate dispatched commands and the unowned-ID control. After review, the probe additionally retains three deliberately conflicting runtime commands with false ACKs and durable conflict dispositions; these are blocked for review, not stranded invisible work or automatic retry candidates. Legitimate commands still finish and ACK.

Rejected/unselected alternatives: a second generic lease scheduler (unnecessary competing authority); blocking DBOS receive for human waits (serial-slot release not assumed); replacing the importer or integrating inventory writes (Stage 1C/production scope); global dependency upgrades (ownership violation); SQLite or mocked DBOS as dispatch proof (cannot establish the required PostgreSQL/runtime behavior); a full web stack/DRF application for this transaction spike (adds scope without improving the requested durability observation).

## 4. Initial candidate verification and fault evidence (historical)

This section describes rejected candidate `8788841` and its report observed at `2026-11-01T04:57:38.255679+00:00`, recoverable from that Git revision. These successful controls did not catch P1/P2 and are not review clearance. Section 11 and the current [report](../../spikes/durable-coordination/evidence/process-probe.json) supersede the acceptance snapshot. The tested hardware/OS was Apple Silicon macOS; PostgreSQL reports aarch64, 17.11 (Postgres.app). The probe asserts intermediate states before proceeding; reports contain final SQL projections, not fabricated time-series.

| Boundary/control | Actual observation and assertion |
| --- | --- |
| Application rollback | Throw inside an enclosing real PostgreSQL transaction after `submit`; Job, Intent and Outbox counts all remain zero. |
| Ordinary Django startup/migration | No `dbos` schema after setup and app migration; no worker implicitly launched. |
| Commit before enqueue | Separate submit process commits Job/Intent/Outbox, then SIGKILL; return `-9`, one pending outbox, no DBOS workflow row. A later dispatcher finds it. |
| Enqueue before ACK | Dispatcher enqueues, prints boundary and SIGKILLs itself before app ACK; return `-9`, app outbox remains unacknowledged. Workflow reaches SUCCESS. Redelivery acknowledges the same ID, leaves one DBOS workflow row and exactly three accepted emissions. |
| Changed payload/version duplicate | Same batch/job/attempt with changed capabilities, or identical request with different version, raises a payload-binding conflict. No new intent is allocated. |
| Actual runtime ownership | A direct DBOS enqueue with a different workflow ID but valid current application intent/digest reaches ERROR before running the synthetic step; original accepted emissions remain exactly three. This deliberate negative control is the sixth DBOS row, not a failed authorized command. |
| Duplicate emission/conflict | Exact sequence redelivery returns duplicate; changed content under the same sequence raises conflict. Transport object-key order is normalized; integer spellings such as `1.0` normalize without losing integer identity. |
| Human wait/serial capacity | First job is `waiting_for_user`, its question unanswered, its DBOS command SUCCESS. A different `batch-second-intake` finishes on the same concurrency-1 queue before answering the first question. |
| Answer/new input | Wrong question revision and wrong authenticated actor rejected. Correct answer stores the answer and new immutable input/attempt/outbox. First intent bytes unchanged; new input revision differs. |
| Obsolete result | After continuation ownership moves, old-attempt waiting result and mismatched old input result are rejected; old answered attempt cannot answer again. |
| Worker process restart | Worker pauses after three app emissions including success commit, before DBOS checkpoints the step. SQL shows DBOS PENDING but app succeeded; SIGKILL worker, start same version/executor identity, DBOS recovers and finishes SUCCESS. Exactly three accepted emissions remain. |
| Incompatible deployment | v2 worker leaves a v1 command ENQUEUED; after a compatible v1 claims it and is killed before emitting, v2 also leaves it PENDING without emissions. Restored v1 recovers it to SUCCESS. This is fail-closed isolation, not automatic v2 migration. |
| Artifact corruption | Schema-valid successful result pointing at bytes with the wrong SHA is rejected before app success publication; prior two events remain and app state remains running. |
| JSON/path adversaries | Ordinary tests reject duplicate nested keys, NaN, ±Infinity, overflow-to-infinity, lossy integer rounding, UTF-16 transport, unknown protocol/provider, changed artifact bytes, traversal and escaping symlinks. |
| Other terminal statuses | Shared login/capacity/interrupted/failed examples are schema-validated and accepted as distinct app states in rolled-back DB controls, not represented as real provider conditions. |

### Commands and actual results

Commands below run from repository root; prepend an installed compatible PostgreSQL `bin` directory to PATH for real tests. The local owner used the isolated copied Postgres.app binaries described above, not the preinstalled 12.22 server. The final standalone probe command used `--state .temp/coordination-probe-ownership`; use a new nonexistent state directory for reproductions.

```sh
uv sync --locked --project spikes/durable-coordination
COORDINATION_SPIKE_REAL=1 uv run --locked --project backend pytest backend/tests/spikes/test_durable_coordination.py backend/tests/spikes/test_shared_contracts.py -o addopts='' -q
uv run --locked --project spikes/durable-coordination python spikes/durable-coordination/probe.py --state .temp/coordination-probe-new
uv run --locked --project backend ruff check --config backend/pyproject.toml spikes/durable-coordination backend/tests/spikes/test_durable_coordination.py
pnpm install --frozen-lockfile --offline --store-dir "$PNPM_STORE_DIR"
pnpm test
pnpm lint:backend
uv lock --check --project spikes/durable-coordination
sh spikes/durable-coordination/state.sh
git diff --check
```

- Focused final shared + coordination suite with real fault probe enabled: **54 passed in 17.58s** (35 unchanged shared-contract checks plus 19 coordination cases, including the real-process matrix). A second standalone final probe passed and produced the retained report. This is real DBOS/PostgreSQL evidence, not a skipped test counted as runtime coverage.
- Final root normal-suite run of `pnpm test`: **1,961 backend passed, 2 skipped, 43 scanner/TUI deselected** in **222.27s**, plus **2 frontend tests passed**. The extra skip is the explicit PostgreSQL opt-in; the other is the baseline skip. The final runtime-ID negative control was added afterward and exercised by the final focused real-process suite above. Earlier pre-extra-decoder-case runs also passed: direct backend **1,958 / 2 skipped / 43 deselected** in 248.87s and first root `pnpm test` with the same counts in 229.35s plus 2 frontend tests.
- Targeted backend-configured ruff and full `pnpm lint:backend` **passed**. `uv lock --check --project spikes/durable-coordination`, the read-only state script and `git diff --check` **passed**. Final owned-cluster `pg_ctl status` reported **no server running**, as intended. No scanner/TUI behavior, skills or agents changed; scanner-only suite was not run.
- Existing pinned Node/pnpm tools were used and a frozen offline install reused the existing package store without changing lockfiles. Python dependency environments remain separate; the normal backend suite does not import Django/DBOS or auto-install spike dependencies.

### Gotchas: failed attempts and corrections, not hidden passes

- Initial PostgreSQL 12.22 cluster could initialize, but real Django migration rejected it with the supported-version check (PostgreSQL >=14). It was stopped and retained; no bypass or downgraded acceptance criterion was used. Compatible isolated binaries resolved the issue.
- First DBOS startup rejected the too-long application name. It was shortened to `intake-coordination-spike`, inside DBOS's documented runtime limit, then the real startup/recovery probes were rerun.
- First waiting-result probe failed because Django JSONField `answer=None` compares against JSON null, not SQL NULL. Application filters now use `answer__isnull=True`. The real question/serial-lane probe passes and would catch this regression.
- A preliminary migration-generation invocation reported a connection-refused warning while checking history against a deliberately unused port. Migration generation succeeded; all subsequent actual app migrations ran against the owned real cluster.
- `rg` was not available in this execution environment; scoped file discovery and installed-package inspection used available filesystem tools. No repository toolchain installation was performed merely to replace it.

## 5. Review process and next steps

1. Coordinator selects a fresh independent read-only re-reviewer of the owner fixes, full branch diff and current report — gate: reviewer preserves all owners' work, the rejected-candidate review cluster and all adverse rows, and uses an isolated new cluster for reproduction. Initial independent review found P1/P2; the owner does not self-declare their clearance.
2. Owner addresses findings only in owned files, then obtains clean re-review — gate: do not publish PRs or push this branch before the required review sequence/coordinator authorization. Shared schema/architecture changes must be requested through the coordinator, not edited by this owner.
3. Reconcile Stage 1A/1B/1C evidence into Stage 1D decisions — gate: do not equate the fixture runner with actual provider behavior, command success with research completion, or DBOS replay with safe replay of an inventory mutation.
4. If DBOS is chosen for production, design supervision, unique executor identities and compatible-worker retention, including unanswered app questions; implement actual endpoint authentication/authorization and general immutable input storage separately. An old pending workflow can occupy the global serial slot; restore/drain its compatible worker rather than expecting an incompatible worker to take it over.
5. Keep the outbox unless a separately reviewed same-cursor alternative proves rollback, encoding, duplicate-ID and migration ownership semantics. No same-cursor result is supplied by this spike.

## 6. Skills to use

| Skill | When and why |
| --- | --- |
| `reviewing-code` | Fresh independent review of implementation and adverse tests; read the actual code before deciding whether the spike's claims hold. |
| `proving-changes` | Reproduce any requested additional failure boundary against actual processes/DB, not mocks. |
| `handover` | Further transfers and reviewer/owner final state, decisions and limitations. |
| `github-pr-tools` | Coordinator-authorized eventual publication and PR/CI context, not permission to publish now. |
| `gh-stack` | Only if the coordinator creates dependent published layers above shared contracts. |

If a skill is unavailable, perform the named capability directly without weakening its ownership/review gates. No new skills/agents were created or modified.

## 7. Hard rules and ownership

- Own only `spikes/durable-coordination/**`, `backend/tests/spikes/test_durable_coordination*.py` and this handover. Preserve other branches/worktrees, untracked files and live services. Root/backend manifests/locks, architecture and shared fixtures/schema remain coordinator-owned.
- No production DB, inventory server, paid API, credential copying, cloud coordinator or provider invocation. Do not use the fixture source namespace for real imports. No approved inventory effects exist here.
- Do not launch agents/threads, push, publish PRs or deploy from the owner task. The latest user authorized only the local shared-branch `--no-edit` merge recorded above; no further merges are authorized. Fresh review, owner fixes and clean re-review precede coordinator publication. Use Conventional Commits; eventual initiative target is `interactive-app`, not main.
- Never reuse a changed payload under an existing workflow ID, silently replace old input bytes or reinterpret an old workflow/approved plan. App answers authorize proposal continuation only, not inventory writes.
- Repository paths stay portable. Locally generated DB/log paths are runtime-discovered and kept private; they are not examples to paste into tracked files.

## 8. Limitations and remaining gates

- **Production implementation deliberately absent:** no HTTP/DRF, user login, browser integration, general Batch/Part/lot model, approvals, SSE cursor, provider process supervision, login/quota recovery, cancellation protocol, inventory adapter, object store, backup/restore or retention policy. The CLI's separate trusted actor argument is a boundary demonstration, not authenticated network identity.
- **Synthetic runner only:** fixed transcript, fixed attempt-1/attempt-2 journey, counted-20 answer and bounded fixture identity checks. The shared test suite validates the actual expected proposal through the real importer parser/validator; the isolated worker's own domain check only enforces the fixture's source/Part/lot/quantity/batch identities and artifact integrity, not arbitrary importer documents. Promote neither this bounded check nor fixture auth to production validation.
- **Immutable-by-API, not hostile DBA protection:** intents are never updated by the store API; there are no PostgreSQL immutability triggers, row-level security or malicious-DB-administrator defenses. Artifact containment/digests are checked in an operator-owned staged bundle, not a proof against adversarial concurrent filesystem namespace replacement. A production artifact store must own those guarantees.
- **Explicit supervised delivery:** outbox delivery is a bounded CLI pass, invoked by the probe. A production supervisor/poller and monitoring remain to be designed. Durability is demonstrated under eventual compatible dispatcher/worker execution, not autonomous availability with every process stopped. No second generic scheduler was introduced.
- **Single sequential worker lifecycle:** the fixed executor ID is deliberate for this one-worker kill/restart probe. Do not run two live workers with that same identity or assume this proves multi-host failover, lease expiry or protection from a surviving old child. These belong to deployment design and the importer owner. The version probe is metadata fencing with unchanged fixture code, not an arbitrary workflow-code/DBOS-version upgrade test.
- **Runtime/package support is pinned evidence:** only the recorded Python/Django/DBOS/driver/PostgreSQL/macOS combination was executed. PostgreSQL 14+ is Django's minimum, not proof that every allowed server version/platform is covered. Package pins need a separate production security/support review; no current-latest or long-term-support promise is made.
- **Fault-matrix scope:** Stage 1B command commit, enqueue ACK loss, human wait, obsolete result and incompatible-version rows are covered. The related app-result/DBOS-checkpoint loss is additionally covered. Canonical importer reservation/journal gaps, remote uncertain writes, stock/attachment repair, old child still alive, cancellation during SDK sends, UI event loss and backups predating remote effects are not proven here; they remain Stage 1C/later gates. No exactly-once external effect claim is made.
- **Shared integration:** no shared contract edits were needed. Coordinator may add a root spike index/architecture link after reconciling owners; production boundaries remain unchanged. Combining all three spikes into one real-provider/fake-inventory journey remains separate work.

## 9. Open items needing a human

| Item | Owner | Gate |
| --- | --- | --- |
| Adopt DBOS versus another coordinator after independent review and other spike evidence | Mitch/coordinator | Stage 1D and production dependency decision |
| Supported provider/auth/deployment route and final runner host | Stage 1A/Mitch | Any real subscription-backed execution; not needed for this synthetic spike |
| Production retention, backup/restore and inventory pilot authorization | Mitch later | Production operation/live writes; none authorized by this change |

No unanswered human question blocks fresh independent review of Stage 1B.

## 10. Locations, retained state and transfer prompt

- Worktree: the coordinator-provided checkout for branch `feat/spike-durable-coordination`; discover its current root with `git rev-parse --show-toplevel`. The main checkout and all parallel worktrees are preserved; `git worktree list` is read-only.
- Tracked entry point: this file. Read-only refresh: `spikes/durable-coordination/state.sh`. Reproducer/operator guide: `spikes/durable-coordination/README.md`. Observed portable evidence: `spikes/durable-coordination/evidence/process-probe.json`.
- Latest owner retained local cluster: `.temp/coordination-owner-rereview-v1/pg`, with sibling `worker-*.log`, `postgres.log`, copied `bundle/` and generated `evidence.json`; PostgreSQL is stopped. The older owner `.temp/coordination-probe-ownership/` and reviewer `.temp/coordination-review-8788841-independent/` are preserved untouched. Do not restart, migrate, reseed or reset the reviewer cluster. Earlier directories are historical, not current acceptance evidence; preserve them until review is complete.
- Local isolated binaries: `.temp/coordination-tools/postgres-17/bin`; original downloaded image remains local, detached. Python environments: `spikes/durable-coordination/.venv` and `backend/.venv`; neither is committed. New `.temp` data is ignored by existing repository policy; no shared ignore changes were needed.
- External source pack: `$HOME/.agents/handovers/intake-shared-fixtures-and-spikes/`, with product/design/plan snapshots read in full. Existing online design hub is linked from that pack; no Notion writes were performed. Memory: none created.

Transfer: continue Stage 1B review on `feat/spike-durable-coordination`; first read this handover and current AGENTS/guidelines, run the read-only state script, inspect the final diff/report, and reproduce the real probe in a **new** owned cluster. Use the reviewing-code and proving-changes skills as appropriate. Return concrete findings to the owner; do not push/open PRs or modify shared files. Preserve all unrelated work and distinguish simulated provider events from actual Django/DBOS/PostgreSQL observations.

## 11. Independent review findings and owner fixes — 2026-11-01

### Rejected candidate and changed decisions

The independent reviewer reproduced two material failures on `878884101981ac38a5c093ea82e223722a95795e`. Passing the original process matrix did not prove either boundary. The user requested owner fixes, new owned PostgreSQL clusters, preservation of the reviewer's retained cluster/logs/adverse rows and an authorized `--no-edit` merge of shared branch `20a46a1` before the review-ready commit. That merge completed cleanly as `451e7c7`; no shared source, schema, fixture, architecture or dependency manifest was directly edited. No other worktree, service or local data was changed.

1. **P1 actual execution version and duplicate runtime metadata** — reviewer finding; implementation owner fix. The public DBOS 2.10.0 `DBOS.application_version` property is compared against the immutable intent version in the workflow before the step, and in the emitting step. This uses the actual running process version, not a supplied argument or the intent's own digest calculation. The workflow-level check also executes before adopting a cached step result. After `DBOSClient.enqueue` returns, the dispatcher reads the handle's public `get_status()` projection and compares persisted version, workflow/queue/class/config names and deserialized positional/keyword inputs to the expected binding. Checking after enqueue covers a concurrent first writer as well as an ordinary duplicate; DBOS enqueue itself must not be assumed to compare version or arguments.
2. **P1 explicit conflict, not implicit retry or rebinding** — owner default chosen to meet the user's explicit-disposition requirement. New migration `0002_outbox_conflict` adds an additive `Outbox.conflict` field. An adopted runtime metadata mismatch records `runtime_metadata_conflict`, keeps ACK false/deliveries zero, and marks the current app job `dispatch_conflict` atomically. The CLI prints a safe identifier/code, continues unrelated deliveries and exits 1. Subsequent passes report the same conflict without enqueueing or changing either version. No reset, automatic ID replacement, payload rewrite or workflow-version relabeling is implemented. Enqueue failures before a handle is returned still propagate without ACK; they are not claimed as durable quarantine coverage for every DBOS error.
3. **P2 unsupported synthetic journeys** — reviewer finding; implementation owner fix. Before entering the submit transaction, `request_input` now checks that the attempt/stage has an authored transcript request and its manifest matches that attempt's original/confirmed input. Only the batch ID may vary for the second-intake control; exact request/input/evidence hashes still bind the consumed bytes. An unknown attempt, original input under attempt-2, or confirmed input under attempt-1 is rejected before any Job/Intent/Outbox writes. The transcript selection requires exactly one final terminal result. The runner additionally requires a persisted result emission before returning command success. Raising only inside a dispatched workflow was rejected because it would still commit unsupported work.

These are fixture-runner and coordination-boundary fixes, not shared protocol restrictions or production provider logic. Alternatives rejected: trusting caller-supplied version/digest alone (the demonstrated P1 bypass), trusting enqueue success as duplicate identity proof (DBOS does not compare all payload metadata), silently repairing/relabeling the conflicting row (changes immutable command meaning), and adding a generic retry scheduler (competing authority, unnecessary for this spike).

### Same-procedure real before/after reproduction

The owner independently reran both reported cases against an untouched `git archive 8788841` source snapshot and then the fixed checkout. The same scratch adverse procedure, same installed isolated packages, same two job IDs, same shared manifest/transcript bytes and fresh cluster per run were used; only the source root differed. It called the real Django store and separate entry/worker processes with real DBOS/PostgreSQL, not a mock runtime. Scratch source/script were removed after observation; persistent databases/logs and generated reports remain. This was a local command-side spike, not an HTTP/browser or provider test.

- **Before P1** at `2026-11-01T05:15:52.036127+00:00`: submit confirmed request as v1; directly enqueue its correct stable workflow ID, intent ID and digest with app version v2; start v2 worker; normal dispatcher exits 0. Observed runtime SUCCESS/v2, intent v1, app succeeded, three emissions and ACK true. This reproduces the reviewer's silent-version-rebinding failure.
- **After P1** at `2026-11-01T05:15:56.561814+00:00`: identical case reaches runtime ERROR/v2 before any app emission; intent stays v1. Normal dispatcher exits 1 with `runtime_metadata_conflict`, app `dispatch_conflict`, ACK false. The bad runtime row and intent remain available for review.
- **Before P2**: schema-valid original request with `attempt-3` commits counts `[1,1,1]` for Job/Intent/Outbox; v1 worker reaches DBOS SUCCESS, app stays queued, zero emissions, ACK true — permanently stranded work.
- **After P2**: the same submission raises `Unsupported synthetic attempt/stage`; counts `[0,0,0]` remain before starting any worker. There is no runtime row to dispatch or strand.

Portable unedited generated observations are [review-before.json](../../spikes/durable-coordination/evidence/review-before.json) and [review-after.json](../../spikes/durable-coordination/evidence/review-after.json). Corresponding private state/log roots are `.temp/coordination-owner-before-8788841/` and `.temp/coordination-owner-after-review-fixes/`, plus sibling `.log` captures. Both clusters are stopped. The reviewer's `.temp/coordination-review-8788841-independent/` was not opened for writes, migrated or reused.

### Expanded real process matrix and checks

The full current [process-probe.json](../../spikes/durable-coordination/evidence/process-probe.json) is copied unchanged from the new owner `.temp/coordination-owner-rereview-v1/evidence.json`, observed at `2026-11-01T05:13:11.659358+00:00`. Versions remain Python 3.12.3, Django 5.2.8, DBOS 2.10.0, psycopg 3.2.12, SQLAlchemy 2.1.6 and PostgreSQL 17.11 (Postgres.app), macOS arm64. The spike-local environment/lock were reused; no install or shared infrastructure change was needed for these fixes.

- **Runtime adversaries:** correct-ID/correct-digest wrong-version row rejected after attempted v2 execution and before dispatch; a separate wrong-version row detected by the dispatcher while still ENQUEUED and later rejected by v2 execution; correct-version/wrong-digest row quarantined and rejected. All three finish ERROR, keep zero emissions and false ACKs, retain original intent/runtime versions, and remain explicit conflicts after redelivery plus compatible v1 restart. Worker logs contain the version-ownership or payload-binding failure, not an unexplained queue failure. A healthy command submitted after all conflicts still reaches SUCCESS with exactly three accepted emissions and ACK true while dispatch continues to report conflicts.
- **Submission and terminal guards:** three schema-valid unsupported attempt/input submissions use separate real Django CLI processes and each exits 1 with zero committed application rows. Ordinary tests also reject missing, non-final and repeated terminal transcript entries. A focused local guard injection calls the undecorated step against real PostgreSQL while replacing only the emission selection with an empty list, DBOS version property with a controlled value and connection cleanup with a no-op to preserve the enclosing rollback transaction; successful completion is rejected without emissions. That injection is explicitly not DBOS durability evidence and leaves no committed rows.
- **Inherited controls rerun:** atomic rollback, migration without worker startup, both real SIGKILL dispatch windows, stable-ID redelivery, changed-payload/version duplicates, sequence conflicts, first question/second-batch serial-slot release, immutable counted-answer continuation, obsolete answer/result rejection, SIGKILL after app result before DBOS checkpoint, incompatible queued/pending fencing and compatible drain, corrupt output rejection, outcome acceptance and unowned runtime-ID rejection all still pass.
- **Final SQL:** ten DBOS rows: six legitimate SUCCESS, three payload/version-conflicting ERROR and one unowned-ID ERROR. Nine application intents/outboxes: six ACKed with empty conflict, three unacknowledged with explicit conflict. Eight logical jobs: five succeeded, three dispatch conflicts. One durable answered question. No unacknowledged non-conflict outbox remains. Both command kill return codes are `-9` and the two recovered legitimate workflows have recovery count 2.

Commands run from root (real commands prepend the installed isolated PostgreSQL 17 `bin` directory to PATH):

```sh
COORDINATION_SPIKE_REAL=1 uv run --locked --project backend pytest backend/tests/spikes/test_durable_coordination.py backend/tests/spikes/test_shared_contracts.py -o addopts='' -q
uv run --locked --project spikes/durable-coordination python spikes/durable-coordination/probe.py --state .temp/coordination-owner-rereview-v1
uv run --locked --project backend ruff check --config backend/pyproject.toml spikes/durable-coordination backend/tests/spikes/test_durable_coordination.py
pnpm test
pnpm lint:backend
uv lock --check --project spikes/durable-coordination
sh spikes/durable-coordination/state.sh
git diff --check
```

Actual results: final focused real suite **60 passed in 26.94s**; earlier expanded real suite **60 passed in 25.25s** before the additional local terminal-guard injection; standalone full probe **passed** and produced the tracked report. Offline focused suite **59 passed, 1 explicit opt-in skip**. Final root `pnpm test` **1,967 backend passed, 2 skipped, 43 scanner/TUI deselected in 222.99s**, plus **2 frontend tests passed**; log retained at `.temp/coordination-review-fixes-normal-tests.log`. Targeted Ruff, full `pnpm lint:backend`, isolated lock check, state script and whitespace check **passed**. Initial Ruff found four loop-variable closure warnings in the new test probe; moving the assertion helper outside the loop and binding the wait predicate fixed them before the successful runs. All new owner clusters were stopped by finalizers and `pg_ctl status` confirmed no server running. Scanner-only tests were not run: scanner/TUI, skills and agent definitions are unchanged.

An additional offline Django migration-graph check compared `MigrationLoader(None).project_state()` to `ProjectState.from_apps(apps)` with `MigrationAutodetector`; it reported **no model/migration drift**, without connecting to any database. Migration 0002 itself was applied by each new fixed-code real probe cluster. No retained reviewer/old-owner database was migrated.

### Remaining limits and clean re-review gate

No unmet Stage 1B runtime observation is hidden as a skipped pass, but clean independent re-review is still required; these are owner results, not reviewer clearance. No push, PR, new agent, paid API, live provider or inventory write occurred. All section 8 limitations remain: command-side CLI instead of HTTP, authored synthetic provider, single fixed executor, eventual supervised dispatch, no hostile-DB-admin defenses or arbitrary workflow-code migration, no remote exactly-once claims and no live release authorization. The expanded tests cover actual metadata mismatches, not every DBOS retention/cancellation/error repair. A poisoned runtime ID is intentionally blocked for explicit review rather than automatically made runnable; a production repair procedure remains separate design work. The old reviewer-reported concurrent eight-submission result is independent-review history, not a new owner concurrency stress run.

For clean re-review, first read this section and current guidance, refresh state, inspect the fix commit plus original diff, then rerun the retained probe with a **new** nonexistent state directory. Preserve every existing review/owner cluster and all parallel worktrees. Return concrete findings or exact-hash clearance to the coordinator; do not publish or silently repair retained adverse rows.
