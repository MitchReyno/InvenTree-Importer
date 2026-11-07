# Bench Intake — proposed architecture after the Stage 1 spikes

Status: proposed design, reconciled on 2026-11-01. This is not an implemented application architecture or permission to start production integration. The [delivery plan](plan.md) records the outstanding gates. The current application boundaries remain in [repository architecture](../../../../../ARCHITECTURE.md).

## Product and authority boundaries

Retain Capture, Processing, Review, Approve and Results navigation. Processing exposes Overview, Reading, Identifying, Research, Images and Inventory; app-wide progress must distinguish a stage, a logical operation and its actual attempts. The backend owns facts, revisions, dependencies, questions and approvals. The browser presents and edits them; agent research proposes evidence-backed values and never approves or performs inventory writes.

Preserve distinct physical lots, shared Part identity, inherited defaults versus explicit overrides, original evidence, selected human values and earlier outcomes. Selecting a subset must not authorize stock or media effects for an unselected lot. Research success means a validated proposal is available, not that inventory exists.

## Evidence ledger

These are separate investigations, not a combined end-to-end result. Test counts and reproduction details belong in the linked owner handovers. GitHub references identify the reviewed work even before the dependent branches land; their files are not assumed present on the initiative trunk.

| Investigation           | Reviewed implementation and handover                                                                                                                                       | What the evidence supports                                                                                                                                                                                | What it does not support                                                                                                                                                       |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared contract         | [PR #22](https://github.com/MitchReyno/InvenTree-Importer/pull/22), commit `20a46a1`; [handover](https://github.com/MitchReyno/InvenTree-Importer/blob/2d852e2/docs/handovers/spike-shared-contracts.md)                                      | Exact-byte synthetic assets, strict versioned message/schema consistency and importer-valid expected proposal; LF checkout protection                                                                     | Transactional acceptance, authentication, general research quality or production authorization                                                                                 |
| 1A subscription runtime | [PR #23](https://github.com/MitchReyno/InvenTree-Importer/pull/23), implementation `c1be7bf`; owner handover `docs/handovers/spike-subscription-runtime.md` in that branch | Local personal Codex PNG plus locally extracted PDF text, correlated question/continuation, proposal and cancellation; local Claude PNG/native PDF, question and denied Write; reviewed offline hardening | Full Stage 1A acceptance, remote entitlement, account-side no-overage guarantees, native Codex PDF, Claude continuation/cancellation parity or native stale-permission restart |
| 1B durable coordination | [PR #26](https://github.com/MitchReyno/InvenTree-Importer/pull/26), implementation `9cf0b80`; owner handover `docs/handovers/spike-durable-coordination.md`                 | Real Django/PostgreSQL/DBOS outbox, crash/redelivery, payload/version ownership, persisted questions releasing a serial lane, stale rejection and compatible restart                                      | Real provider, HTTP transaction boundary, distributed application ownership, arbitrary workflow migration or exactly-once external effects                                     |
| 1C importer adapter     | [PR #24](https://github.com/MitchReyno/InvenTree-Importer/pull/24), integrated `e3ce087`; owner handover `docs/handovers/spike-importer-adapter.md`                        | Real importer SDK/loopback HTTP against a persistent owned fake, immutable selection/approval, canonical adoption, bounded IPC, cancellation, partial outcomes and selected repair                        | Production approval storage/authentication, SSE cursors, Windows IPC, coherent restore or live-target compatibility                                                            |

All three bounded candidates obtained clean independent review after findings were addressed. Runtime clearance is for publication of a **partial investigation**, not completion of its unmet acceptance criteria. Runtime observations preceded the environment-hardening fix; the real SDK's intercepted spawn boundary was tested after the fix without new inference. Historical Codex ambient sanitation, billing routing and charges remain unknown. Neither an observed successful run nor an offline sentinel test establishes account billing guarantees.

## Decision 1 — retain separate application and importer authorities

Recommend Django/DRF/PostgreSQL for product state and an explicit DBOS worker entry point for bounded durable coordination. The spike used Django 5.2.8, DBOS 2.10.0, PostgreSQL 17.11 and psycopg 3.2.12; these are observed investigation versions, not final production pins. Web startup, autoreload and migrations must not launch worker lanes.

PostgreSQL owns batches, stable lots/Parts, evidence references, proposal revisions, selected values, questions, approvals, command intents and UI projections. The importer retains canonical registry/journals, effect certainty, target continuity, writer ownership and supported repair policy. Do not copy those policies into Django or claim one atomic transaction across PostgreSQL, importer SQLite and remote inventory.

Retain the existing engine rather than build a new executor: the adapter demonstrated the required bounded seam while preserving unknown effects and cross-round identity. A rewrite has no supporting evidence here. Celery remains an alternative if DBOS later fails an application requirement; Temporal/distributed apply add operational and ownership contracts not justified by these single-worker results.

## Decision 2 — keep the application outbox and bind actual runtime metadata

Commit the domain revision, immutable intent and outbox together in PostgreSQL. Deliver with a stable workflow ID and payload/version digest. A duplicate ID alone is insufficient: verify the persisted runtime's version and full arguments before acknowledgement, and verify the actual executing application version and authorized intent before accepting emissions. Conflicting runtime metadata needs a durable explicit conflict disposition, not silent rebinding or generic retries. Healthy unrelated work must remain dispatchable.

Keep DBOS as the scheduler; do not add a competing application lease scheduler. Application identity/revision checks remain necessary even when DBOS owns execution. Compatible workers must drain outstanding work; incompatible deployments must fence it or expose explicit review, never reinterpret inputs or approved plans. Same-cursor SQL enqueue was optional and untested, so it does not replace the proven application outbox.

## Decision 3 — questions finish commands, answers create immutable continuations

Persist the question and waiting result, then finish the command and release its lane. An authenticated application answer binds the original question ID/revision and attempt/input context, passes domain validation, produces a new immutable input and starts a new attempt. Reject obsolete or conflicting answers/results; retain old evidence without overwriting current selected facts. Do not hold a worker or an importer preparation lock while waiting for a person.

Native provider permission requests are different from application planning questions. Never replay a stored answer into an obsolete in-memory permission request. Production permission/restart policy remains gated by native tests; the synthetic coordinator's stale-answer tests do not close the runtime gap.

## Decision 4 — local subscription runner is the bounded candidate, not remote entitlement

Continue with an officially supported own-computer personal runner as the candidate route. Resolve login, subscription eligibility and effective runtime/billing configuration before inference; otherwise report an explicit login/capacity/unsupported state. No paid API fallback, copied credential stores, raw provider runtime exposed to the browser or implied permission for unattended remote deployment. A different host, OAuth/SIWC integration or product deployment needs current official support and explicit authorization for that route.

Research receives only staged immutable evidence, trusted versioned instructions and bounded proposal tools, with no inventory-write authority. Reject duplicate JSON keys/non-finite values, unsupported envelopes, escaping/symlinked paths and mismatched artifact bytes. Preserve the accepted byte snapshot. The reviewed trusted-local containment tests do not prove protection against concurrent hostile filesystem mutation or effective native sandbox/tool isolation; those require a production threat model and verification.

Do not promise provider parity. Native PDF versus local text extraction, actual media reads, continuation/cancellation, quota fixtures and native permission behavior must be labeled separately per adapter. Begin with one active research job per account and explicit child bounds only after the first provider passes its production gates.

## Decision 5 — frozen approval precedes start-or-adopt

Read-only preparation materializes recorded choices and the complete selected dependency closure. Missing choices become persisted typed questions. Freeze exact Plan revision/bytes, selected scope, media bytes/hashes, source/contribution IDs, config/target/private-state binding and importer build before approval. A revision or effect change returns to review. Authorization and immutable approval persistence belong to the application, not the provider or local file substitute used in the spike.

Persist the approval-to-intent/canonical-location binding before dispatch. Use the narrow public `inspect_binding` seam and canonical validation to find an existing execution. Adoption is observation, not a writer lease or an instruction to execute/resume. A reservation without a usable journal is recovery-required. A missing application result, timeout or worker restart must not trigger blind execution or a new namespace. Dispatch and explicit supported resume/repair retain the engine's ownership checks.

Keep one serial supervised apply child and a separate cancellation channel. Cancellation prevents new work at supported boundaries; accepted or uncertain remote requests are not undone. DBOS replay may redeliver an immutable intent, but may not wrap an inventory mutation in an unconditional retry.

## Decision 6 — preserve original identities across selected rounds

Later rounds use the same source and original contribution keys, with explicit known shared Part PK/IPN resolution and fresh read-only preparation. Filter the selected v2 scope before expansion so a `part_of` dependency cannot silently authorize its parent lot. The adapter did not establish v1 dependency-only extraction; expose no such production control without a separate contract.

Unknown stock creation remains unknown even if a matching-looking record exists or later disappears. Do not payload-match, recreate or clear a claim on assertion alone. Selected attachment repair uses supported content/domain verification; historical uncertain attempts remain retained. Earlier unresolved same-source ownership blocks later write rounds. Do not bypass that block with a new source, state root, dropped claim or retry identity.

## Decision 7 — bounded observations, durable application cursors, canonical recovery

The spike's bounded lossy Unix datagrams establish that observation backpressure need not control importer effects. They are not the production transport or a durable event stream. The CLI events export is completion-only. Persist a separate application cursor/projection for polling/SSE reconnect, reconcile it against canonical snapshots and retain attempt/operation distinctions. Provider attempt sequences and importer invocation sequences are not application cursors.

A stale or lost projection must not imply execution failure or authorize a retry. Cursor persistence, reconnect behavior and bounded production IPC remain unimplemented gates. Windows support needs its own transport tests rather than a claim based on Unix evidence.

## Deployment, media and release constraints

The candidate deployment retains HTTPS, application/API plus built frontend, PostgreSQL, durable workers, media storage and isolated apply; a supported personal research runner may be separate. This is a proposed topology, not remote-provider deployment approval. Keep reviewer/approver roles and target credentials server-side, separate research from apply secrets and audit the human approval identity. Service-account access is not proof of a user's target permissions.

Store immutable originals by hash. Define an explicit EXIF/orientation coordinate frame, deterministic crop/rotation recipes, output destinations and frozen approved derivative bytes. Source snapshots and generated/enhanced imagery must remain distinguishable from originals. Image-coordinate parity and hostile upload/evidence handling were not established by these spikes.

Before live release, test coherent restoration of application/media/workflow state and canonical importer authority, including a backup older than remote effects. Define retention so workflow cleanup cannot delete product approvals/evidence or recovery journals. Verify the persistent fake against the actual target version separately; only an explicitly approved pilot may write live inventory. No current result authorizes live writes, distributed writers, unsupported overwrites or migration of active plans.
