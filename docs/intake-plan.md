# Bench Intake — revised delivery plan

Status: proposed on 2026-11-01 after the independently reviewed Stage 1 investigations. Read the [reconciled design](intake-design.md) for evidence, decisions and authority boundaries. This plan supersedes the older Stage 0-in-progress and generic-main-target assumptions, not the product's approval, source-identity or uncertainty requirements. It does not start production implementation or authorize live inventory writes.

## Delivery and publication

Use `interactive-app` as the initiative trunk and `feat/spike-shared-contracts` as the spike consolidation branch, per Mitch's superseding decision on 2026-11-01. Shared contracts landed in PR #22; runtime #23, coordination #26, importer adapter #24 and reconciliation #27 have since merged into the consolidation branch. Keep remaining spike follow-ups based there rather than retargeting them individually to the initiative trunk. Draft PR #29 proposes the combined branch for `interactive-app`; combined validation and fresh independent integration review precede any separately authorized merge. Do not merge automatically. Unrelated tooling PRs #25 and #28 remain separate from spike acceptance.

Each owner supplies a comprehensive tracked engineering handover covering decisions, alternatives, changed acceptance criteria, verification and limitations. Fresh independent review precedes PR publication; fixes need clean re-review. Preserve all worktrees, evidence and local data. Tests, review clearance and publication are distinct from acceptance of all product gates or permission to deploy.

## Stage 0 — foundation: merged

PR #21 merged the backend/frontend restructuring into `interactive-app`. The Python importer remains uv-managed under `backend/`; the React/TypeScript/Vite scaffold is browser-local and is not connected to an application service. Root guidance and commands now use the new layout. The user's old-layout main checkout and local data remain untouched. No Django service, upload API, authentication or inventory integration is implied by the scaffold.

## Stage 1 — bounded evidence and remaining gates

| Stage             | Current disposition                                                       | Acceptance still required before its production use                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shared            | Reviewed exact-byte fixture/schema and LF correction, PR #22              | Promote versioned contracts only after exercising actual consuming boundaries; schema validation is not authorization                                                                                              |
| 1A runtime        | Partial observed local personal-route investigation, clean review, PR #23 | Effective runtime/tool/billing policy after hardening; native permission restart/stale-reply handling; first-provider supported deployment/auth/capacity lifecycle; separately gated parity for the other provider |
| 1B coordination   | Bounded real Django/PostgreSQL/DBOS evidence, clean re-review, PR #26     | Application HTTP/auth transaction boundary; production supervision, ownership and version/retention operations; no arbitrary migration claim                                                                       |
| 1C adapter        | Bounded persistent fake/real SDK evidence, clean review, PR #24           | Real application approval/outbox binding, transport/cursor projection and restore; live-target compatibility before separately authorized pilot                                                                    |
| 1D reconciliation | This proposed design and plan                                             | Independent review, user decision on recommendations, and the combined fake-target seam proof below                                                                                                                |

1B demonstrated an application outbox, stable ID plus full payload/version binding, real crash/redelivery, human waits releasing the lane and explicit conflict disposition. Same-cursor enqueue remains untested and is not needed for the retained outbox design. 1C demonstrated that reusing the engine is viable without relaxing unknown-write protections; a new executor is not justified by the evidence.

1A remains open rather than blocking synthetic coordinator, adapter or capture work. Local Codex observations used PNG plus PDF text extraction; Claude observed PNG/native PDF but not continuation/cancellation parity. Historical Codex environment/billing routing remains unknown. Offline hardening and quota fixtures must not be presented as new native inference or account entitlement evidence. No API-key fallback or copied personal credentials is permitted.

### Stage 1E — combined seams before promoting spike code

This explicit addition closes the gap between three separately passing investigations and an integrated interface. Use a new owned persistent fake target and private application/workflow state; preserve the existing spike evidence. Do not simply copy the fixed synthetic runner into production or concatenate its fixture transcript with a successful importer result.

1. Select one exact shared protocol revision. Validate a retained provider-produced proposal and its original evidence through the real importer, without substituting the expected-proposal oracle. A fully synthetic lane remains useful, but label it synthetic. A new live-provider run is gated by supported login/runtime policy first.
2. Translate actual provider progress/question/result into the outer application envelope. Persist the question, release the lane, accept an authorized answer and create a new input/attempt. Prove changed-payload/runtime conflicts and stale results cannot replace selected facts. Native permission replies remain a separately tested runtime boundary.
3. Commit exact selected approval and apply intent in the application transaction, deliver through the durable dispatcher and invoke the importer start-or-adopt seam. Kill after approval commit, after enqueue, after canonical reservation and after engine result before application publication. Recovery must identify the original command/run or report recovery-required, never allocate a fresh write namespace.
4. Exercise serial child exclusion, accepted-request cancellation, dropped progress, unknown stock and attachment acknowledgement loss. Recover the projection from canonical state; repair only supported selected effects. A later original lot uses the same source/Part identity, and unresolved earlier ownership still blocks it.
5. Record which paths are actual provider, synthetic transcript, real database, real SDK/fake target, local-file substitute or mock. Reconcile any incompatible schema change with a new version/examples/conformance checks before consumers adopt it.

Acceptance: one retained fake-target journey binds evidence → proposal → persisted question/continuation → exact selected approval → canonical execution → truthful result/recovery, with adverse seam cases. An inability to settle unknown creates is a valid conservative outcome, not a reason to weaken the gate. Browser/SSE and production authentication are not implicitly proved by a command-side seam harness.

## Stage 2 — persistent capture and draft model

Prerequisite: merged foundation and reviewed domain contracts. A provider-independent capture slice may proceed while 1A remains open, after the user accepts the revised direction; it must not expose unproven research/apply routes as working features.

Add Django/DRF/PostgreSQL, explicit application authentication, stable batches/lots/shared Parts, inherited defaults/overrides, typed assertions and evidence groups. Store validated immutable originals by hash and durable references; distinguish observations, interpretations and selected human values. Add optimistic revision checks and idempotent submission keys. Connect capture/inbox only to implemented endpoints and label fixture mode visibly.

Acceptance: original bytes survive restart with matching hashes; two packets remain distinct; one photo can support multiple items; conflicting browser edits are explicit; defaults change only inherited values; upload validation and authorization hold; exports use portable references. Existing CLI behavior remains supported.

## Stage 3 — processing and the first real provider

Prerequisite: persistent drafts plus Stage 1E command seams and the first provider's unresolved runtime/auth/permission gates. Choose production pins only after current compatibility/support checks; observed spike versions are not deployment commitments.

Add stage/dependency projections, immutable runner inputs, trusted instruction versions, stale-output acceptance checks, persisted questions/continuations, login/capacity/error states and bounded cancellation. Start with one active research job per account and explicit child bounds; measure before expanding. Preserve human-selected values through reprocessing and retain sources without exposing raw runtime or secrets to the browser.

Acceptance: one item can reach review while another waits; edits invalidate only dependent results; actual supported photo/PDF processing and question continuation survive runner/browser restart; duplicate/stale outputs cannot become current; research cannot dispatch inventory writes. Quota fixtures and supported native capabilities remain separately identified. The second provider need not reach parity before this slice, but unsupported controls stay unavailable.

## Stage 4 — review, media and exact approval

Prerequisite: persisted proposals and versioned outputs; UI exploration may use visibly labeled fixtures earlier. Implement evidence/source comparison, shared Part and duplicate-stock decisions, blocking issues, reasoned warning dismissal and revision-aware review. Implement EXIF/orientation coordinates, deterministic crop/rotation recipes and frozen selected output destinations. Read-only preparation must show exact selected creates/reuses/updates/attachments before immutable approval.

Acceptance: shared Part/media edits invalidate affected reviews while lot-only edits stay local; selected dependency closure adds no unselected stock/media; post-preview changes return to review; approved bytes and target/build remain bound. Mobile and keyboard interactions need rendered/interaction checks. Unsupported overwrites, historical edits, v1 dependency-only extraction and active-plan migration remain hidden or explicitly rejected.

## Stage 5 — apply, results and selected recovery

Prerequisite: exact authenticated approval and the combined transaction/adoption proof. Connect serial supervised execution without copying spike-local file persistence or treating Unix datagrams as a production protocol. Persist approval/intent/run bindings, durable application cursors and canonical snapshot reconciliation for polling/SSE. Keep prior rounds, known effects and unknown attempts visible.

Acceptance: duplicate delivery/result-publication loss adopts the same run; missing journals report recovery-required; the alive original child excludes another writer; cancellation retains accepted/unknown effects; selected attachment repair does not recreate stock; lost progress recovers without replay; second-round lots retain source/contribution/Part identity; unresolved same-source ownership cannot be bypassed. No generic mutation retry or distributed-writer claim.

## Stage 6 — second provider, operations and separately approved pilot

Add the second provider only after its own route/media/continuation/cancellation/permission tests, without assuming parity. Validate the supported host/toolchain and clean installation; exercise phone capture, accessible narrow-screen review and browser reconnect. Define retention and perform coherent application/media/workflow/journal restore, including a backup predating remote effects. Test compatible-worker deployment with outstanding questions and runs.

Before a pilot, independently compare the fake contract against the actual target InvenTree version without mutating inventory. A live import needs separate explicit approval of target and selected effects. Read back pilot fields/media and rerun/recovery behavior. No current PR, test pass or personal provider login authorizes that pilot.

## Fault matrix and decision gates

Retain every earlier safety requirement; the evidence column deliberately limits claims to what ran.

| Fault                                                         | Existing bounded evidence                                   | Remaining release requirement                                                    |
| ------------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Domain commit before enqueue; enqueue before ACK              | 1B real PostgreSQL/DBOS process kills                       | Repeat through real authenticated application/approval boundary and adapter seam |
| Wrong runtime metadata under correct command ID               | 1B explicit unacknowledged conflict, no accepted emissions  | Operational conflict UI/runbook; never silently rebind                           |
| Question waits; old result/answer arrives                     | 1B lane release and stale rejection                         | First native provider/permission restart and application authorization           |
| Canonical reservation before journal; result publication loss | 1C recovery-required and adoption                           | Real application transaction/dispatcher integration                              |
| Old apply child remains alive                                 | 1C serial/canonical exclusion                               | Production supervision/loss/restart with same state/target binding               |
| Remote create/attachment applies but ACK is lost              | 1C preserves unknown stock; supported attachment repair     | Live-target compatibility; no payload-match create replay                        |
| Cancellation in accepted request; progress drops              | 1C supported settlement and snapshot recovery               | Durable application cursor/SSE, supported production transport                   |
| Second selected round shares a Part                           | 1C one Part/two original lots; unknown earlier claim blocks | Real application approval/identity persistence                                   |
| Incompatible workflow code                                    | 1B version fencing and compatible drain                     | Deployment/retention procedure, not arbitrary migration                          |
| Backup predates remote effects                                | Not proved                                                  | Coherent restore/reconciliation exercise before live release                     |

Human decisions still gate final runner host/auth route, any remote/OAuth deployment, final package pins, retention/access roles and pilot permission. No dates, throughput targets or automatic production start are committed by this plan. Keep the separate [importer execution plan](import-execution-plan.md) authoritative for engine internals; this application plan neither replaces its safeguards nor changes the legacy CLI default.
