# Bench Intake Stage 1B: durable coordination — engineering handover

Task: prove the bounded Django/PostgreSQL/DBOS dispatch, human-wait and restart boundary using only synthetic shared fixtures. Repository: [MitchReyno/InvenTree-Importer](https://github.com/MitchReyno/InvenTree-Importer). Tickets: none. Decisions owner: Mitch; implementation defaults below are the Stage 1B owner's, pending independent review and Stage 1D reconciliation. Snapshot: 2026-11-01, with exact observed-run timestamp in the retained JSON report.

Refresh read-only state from the checkout: `sh spikes/durable-coordination/state.sh`. The user explicitly requested this tracked handover; paths here are portable repository-relative paths or environment-based references, not machine-specific checkout paths.

## 1. Where things stand

| Item | State |
| --- | --- |
| Branch | `feat/spike-durable-coordination`, based on shared commit `a4e16686a4c6f563a9dc28aefd94481af5dedf77`; implementation and this handover are conventional local commits. Use the state script for current hashes. |
| Integration trunk | `interactive-app`; Stage 0 is merged according to the latest task instructions. Older planning snapshots' Stage 0 status and references to targeting main are superseded. |
| Publication/review | Not pushed; no PR opened; no independent review claimed. Ready for a fresh read-only reviewer, then owner fixes and clean re-review before coordinator publication. |
| Runtime | Real Django 5.2.8 ORM/migrations, DBOS 2.10.0 and PostgreSQL 17.11; Python 3.12.3, psycopg 3.2.12 and SQLAlchemy 2.1.6. Complete Python resolution is isolated in `spikes/durable-coordination/uv.lock`. |
| Process evidence | Five authorized DBOS workflows finished SUCCESS; five committed outboxes acknowledged; one durable question retained with its answer; four logical jobs succeeded, including a different second batch. One deliberately unowned direct runtime enqueue finished ERROR without accepting app emissions. Two killed command processes returned `-9`. Both killed/recovered authorized worker workflows have recovery count 2 rather than 1. |
| Local services | Probe-owned workers and PostgreSQL clusters are stopped by the harness. Database files/logs remain locally for inspection; no existing user service or inventory database was used or stopped. |
| Other owners | Stage 1A/1C worktrees and all shared files were preserved. No additional agents or threads launched. No shared manifest, lock, fixture, schema, root architecture or application source was edited. |

## 2. Authoritative plan and implemented scope

Read the source pack's `HANDOVER.md` and `artefacts/product.md`, `artefacts/design.md`, `artefacts/plan.md` in full under `$HOME/.agents/handovers/intake-shared-fixtures-and-spikes/`. They are source snapshots, not new permission. The latest user task authorizes Stage 1B and overrides older Stage 0/branch status. The shared contract at `spikes/shared/README.md` and adjacent schema, input/confirmed manifests, JSONL transcript and outcomes remain unchanged.

The implementation follows Stage 1B: application transactions persist job/intent/outbox; stable workflow identity and payload binding survive duplicate delivery; DBOS alone claims a single serial workflow lane; questions are application records and finish the command; answers create immutable continuations; stale replies/results are rejected; a compatible restart recovers interrupted work and an incompatible version does not reinterpret it. This is an investigation under `spikes/`, not the Stage 2 application, an import approval model, an HTTP service or a new inventory execution engine.

The synthetic runner **replays** `bench-intake-spike/1` messages. It does not read the pictures semantically, infer a quantity, call a provider, establish subscription entitlement, execute an approved import or write inventory. The expected proposal is deliberately available to this synthetic runner; unlike Stage 1A, there is no claim that a model independently produced it.

### Files and responsibilities

| Location | Responsibility |
| --- | --- |
| `spikes/durable-coordination/pyproject.toml`, `uv.lock` | Isolated, pinned spike dependencies; no backend dependency expansion |
| `coordination/boundary.py` within the spike | Strict UTF-8 JSON, duplicate-key/nonfinite rejection, shared schema, canonical message content, exact-byte SHA and artifact containment/integrity |
| `coordination/models.py`, `migrations/0001_initial.py` | Real Django application Job, immutable-by-API Intent, Outbox, accepted Emission and Question tables |
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
9. **Adverse controls must not strand test work** — owner test adjustment. Login/capacity/interrupted/failed result acceptance and corrupt-output controls execute in explicit outer transactions that are rolled back after checking real DB behavior. Their observed outcomes are recorded separately. Only actual dispatched commands remain committed at probe completion; all five have acknowledged outboxes and SUCCESS DBOS status.

Rejected/unselected alternatives: a second generic lease scheduler (unnecessary competing authority); blocking DBOS receive for human waits (serial-slot release not assumed); replacing the importer or integrating inventory writes (Stage 1C/production scope); global dependency upgrades (ownership violation); SQLite or mocked DBOS as dispatch proof (cannot establish the required PostgreSQL/runtime behavior); a full web stack/DRF application for this transaction spike (adds scope without improving the requested durability observation).

## 4. Verification and fault evidence

The retained [report](../../spikes/durable-coordination/evidence/process-probe.json) was observed at `2026-11-01T04:57:38.255679+00:00`. The tested hardware/OS was Apple Silicon macOS; PostgreSQL reports aarch64, 17.11 (Postgres.app). Python/ORM/runtime versions are in that report. The probe asserts the intermediate states below before proceeding; the report contains the final SQL projection rather than fabricating a time-series from final state.

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

1. Coordinator selects a fresh independent read-only reviewer of this branch/diff and the tracked report — gate: reviewer preserves all owners' work and uses an isolated new cluster for any reproduction. No review has been performed by this owner on behalf of an independent reviewer.
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
- Do not launch agents/threads, push, publish PRs, merge or deploy from the owner task. Fresh review, owner fixes and clean re-review precede coordinator publication. Use Conventional Commits; eventual initiative target is `interactive-app`, not main.
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
- Latest retained local cluster: `.temp/coordination-probe-ownership/pg`, worker logs `.temp/coordination-probe-ownership/worker-*.log`, `postgres.log`, copied `bundle/` and generated `evidence.json`; PostgreSQL is stopped. Earlier failed/intermediate probe directories are historical, not the acceptance evidence. Preserve them until review is complete; no automatic deletion/reset is supplied.
- Local isolated binaries: `.temp/coordination-tools/postgres-17/bin`; original downloaded image remains local, detached. Python environments: `spikes/durable-coordination/.venv` and `backend/.venv`; neither is committed. New `.temp` data is ignored by existing repository policy; no shared ignore changes were needed.
- External source pack: `$HOME/.agents/handovers/intake-shared-fixtures-and-spikes/`, with product/design/plan snapshots read in full. Existing online design hub is linked from that pack; no Notion writes were performed. Memory: none created.

Transfer: continue Stage 1B review on `feat/spike-durable-coordination`; first read this handover and current AGENTS/guidelines, run the read-only state script, inspect the final diff/report, and reproduce the real probe in a **new** owned cluster. Use the reviewing-code and proving-changes skills as appropriate. Return concrete findings to the owner; do not push/open PRs or modify shared files. Preserve all unrelated work and distinguish simulated provider events from actual Django/DBOS/PostgreSQL observations.
