# T06 — durable processing and application questions

## Prospective implementation plan

Recorded before implementation on the merged T04 base `10bd6c85c81d02a0a5970b002c79f55f9d41fe87`. The approved implementation plan and T01–T04 handovers govern this task. T04's independent review fixes require guarded global navigation, pinned action identity and complete retained-byte verification.

### Scope and limits

Retain immutable manual-evidence input manifests, logical stage jobs, attempts, authenticated runner messages, bounded proposals and typed application questions. A human answer updates capture through its public caller-transaction seam and creates a fresh immutable continuation, command, outbox record and durable event atomically. Waiting ends the old command and frees the account lane. A browser closing does not cancel work. Current human selections survive reprocessing; proposals cannot select values or approve effects.

The runner is provider-neutral and restricted to a synthetic adapter until T07 qualifies actual native authentication, inference and tool isolation. Fixture results must say synthetic explicitly. No provider login, credential copying, paid inference, media decoding/upload, inventory mutation, new authentication, SSE or generic shell tool is included. The original repository environment's inventory server remains strictly read-only, including denial probes.

### Ownership and integration

The T06 owner changes new processing modules, tests, `contracts/src/processing.ts`, migration `0006_processing.sql` and processing components in individual TSX files. The coordinator owns shared contract registration/generation, manifests and lockfile, server/main wiring, frontend/App and Batch routing, CaptureHeader, ActivityIndicator, existing capture mutation/grant seams and central plan/root architecture. Proposals precede those edits; this owner does not independently change reserved files, add packages or regenerate shared artifacts. T05 owns media and migration 0005. T06 initially supports retained manual notes without sibling imports; supported media descriptors and retention pins are integrated only from merged public media interfaces. Unknown or unresolved media fails explicitly rather than creating fictional evidence.

### Public seam proposal

HTTP commands use actor/target/context supplied by the existing server binding and protected origin/CSRF boundary. `GET /api/v1/batches/:id/processing` reads scoped processing state and a same-snapshot stream cursor. `POST /api/v1/batches/:id/processing` accepts expected capture revision, subject IDs and explicit stages; each command has a versioned idempotency payload. `POST /api/v1/batches/:id/processing/:jobId/cancellation` cancels only the named current attempt with its expected revision. `POST /api/v1/batches/:id/questions/:questionId/answers` binds question revision, attempt, input digest, capture revision and typed answer; exact duplicate adopts its original receipt. Runner envelopes are not browser API commands and require a separately injected private channel identity.

Capture needs a lock/materialize seam before job/question locks and an apply-locked-edit seam reusing existing domain validation, with event emission deferred to the caller's final event phase. Quantity answers map to existing exact quantity selections; clarification answers map to retained human notes. Processing must not copy capture SQL policy or open a nested transaction. Media resolution/pinning occurs after batch/subject locks and before job locks; collection uses the same owning media lock so input retention and collection cannot race. Final exact signatures and DTO registration are agreed with the coordinator before use.

### Design decisions and alternatives

Use existing TypeBox/AJV, PostgreSQL/pg and DBOS packages; no added runtime dependency is planned. Existing pinned APIs and licenses remain unchanged. Application authority stays in PostgreSQL; DBOS is bounded delivery, never attempt or account ownership. Existing full-payload delivery checks and canonical exact-string scalar rules are reused. A separate processing runner role receives no apply grants, inventory credentials or generic SQL/browser tool. A native permission callback is ephemeral runner state and cannot become an application question or survive restart.

Persist explicit per-stage dependencies rather than treating the whole mutable batch as an instruction. Retain exact manifest/message bytes and digests rather than trusting JSONB or browser reconstruction. A new answer/reprocess command creates a new attempt; it never reopens the old terminal attempt. An account lane is a durable conditional claim, not a browser timer or in-memory mutex. Start with one lane per actor/account; broaden only with measured provider capability evidence.

### Implementation sequence

1. Settle shared capture/media signatures and register strict versioned DTOs.
2. Add independent additive schema with exact-parent constraints, append-only authority and typed state transitions.
3. Implement immutable input construction, scoped snapshots, idempotent start/cancel/answer commands and final event publication.
4. Implement private authenticated envelope acceptance and bounded runner dispatch with exact retained command/input/profile checks.
5. Add guarded Processing UI and pinned typed question forms using styled-components/current palette/original prototype hierarchy.
6. Qualify adverse cases against isolated real PostgreSQL, actual HTTP and DBOS/process restart boundaries, then inspect desktop/narrow browser views with recordings off.
7. Complete handover, required checks and ready nonstacked PR to `interactive-app`; independent reviewers and merge remain coordinator responsibilities.

### Verification and adverse proof

Test immutable manifest hash/content and dependency changes; same command/message with changed payload/version must conflict. Test wrong actor/batch/subject/parent/message/attempt/profile/input/channel, sequence gaps and stale human edits. Test exact question-answer duplicate adoption after lost response, changed answer conflict, typed invalid answer rollback and whole transaction rollback before commit. Test question releases the lane and another lot progresses, cancellation/restart cannot revive an old question or native permission handle, old output cannot overwrite current human selections and a new attempt preserves history. Use independent expected values and negative controls rather than helper-call-order assertions. Run actual public-boundary PostgreSQL/HTTP/process qualification; synthetic runner outcomes do not prove actual provider support. Run normal and relevant unit/type/lint/build/format/generation checks and inspect safe browser screenshots.

### Service and safety allocation

Reuse the existing owned PostgreSQL service with bounded pools and random isolated databases/roles. Heavy tests and any new preview require coordinator allocation; existing previews, data and processes remain preserved. Do not load root `.env`, touch protected inventory, copy personal secrets or start a duplicate service. Portable repository paths and coherent short Markdown apply throughout.

## Decisions and results

Implementation is in progress; shared integration, merged media consumption, approved form-library adaptation, browser checks and final review remain pending.

### Capture seam delegation

Before capture edits, the coordinator delegated sole writing of `intake-server/src/capture/repository.ts` to T06 for the lock/apply/publish extraction. T05 does not edit that file. The extraction reuses existing capture validation and revision history in the caller transaction; it does not introduce a parallel selection policy. The internal result distinguishes pre-publication facts from the final response cursor, permits one matching apply and one obligatory publication, and rolls back on missing or duplicate lifecycle operations. Existing capture/T04 regressions remain required alongside new answer atomicity tests.

### Readability review during implementation

The user required readable source beyond formatter output. The coordinator reinforced explicit named types, runtime validation separate from integrity, blank lines and meaningful function responsibilities. T06 split job materialization, immutable authority, envelope authentication/replay/reference checks, selected-attempt transitions and answer adoption/context validation into owning modules before adding more runtime surfaces. No new formatting tool or package was added.

### Approved form-state adaptation

During implementation, the user approved React Hook Form after the coordinator's comparison. The coordinator owns its exact dependency and lockfile integration in T05 first. Before adapting `QuestionAnswer.tsx`, T06 will use the merged dependency for field state, validation errors and submission while keeping TypeBox/AJV as the validation vocabulary. The adaptation must preserve pinned question/attempt/input identity, exact string quantities, synchronous dirty navigation reporting, stable lost-acknowledgement payload/key and polling that never resets dirty input. No dependency is added independently and no current field semantics are changed merely to fit the library.

### Observed qualification before shared UI/media integration

| Boundary                          | Observed result  | Scope                                                                                                                                                                      |
| --------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Processing PostgreSQL/public HTTP | 3 passing cases  | Exact input/message/idempotency binding, lane release, answer COMMIT-ACK adoption, downstream continuation, stale/cancel/interrupt, role denials and publication lifecycle |
| Synthetic DBOS child processes    | 2 passing cases  | Actual separate worker, retained question across web/worker restart, second-lot progress, fresh answer, reaped original process and changed workflow payload rejection     |
| Existing capture/T04 PostgreSQL   | 11 passing cases | Capture history/scope, manual preparations/approvals/source history, pre-0004 upgrade and complete sealed preparation display                                              |
| Existing T04 process file         | 3 passing cases  | Separate supervised fake worker journey, lost approval acknowledgement and original-run recovery                                                                           |
| Question component tests          | 2 passing cases  | Dirty pinned answer cannot redirect; lost acknowledgement keeps exact value and retry key                                                                                  |

These are intermediate-head observations, not final PR clearance. The synthetic adapter never authenticates a provider or performs inference. A later adapter-input tightening removed the coordinator's private channel capability from the research adapter argument; final focused qualification must include that change.

The first publication test exposed a real permission regression: a guarded marker delete needs column read permission in addition to insert/delete. The coordinator added `SELECT(id)` only for the API role, after which the affected tests passed. Missing or duplicate publication/apply operations roll back the capture change and leave no event.

DBOS 5.4.0 startup starved with a two-connection system pool while registering its queue. The fixture uses the already-qualified three-connection system pool plus one client connection under a four-connection scheduler-role limit. Its lower-case log level follows the installed SDK's accepted vocabulary. No shared service limit or private SDK table was changed.

The final profile also binds immutable trusted-instruction bytes/hash and `restricted-no-tools/1`. Question/proposal reads verify the entire payload against the accepted producer envelope, carrying forward T04's sealed-display review fix. The PostgreSQL/HTTP and process cases were rerun successfully after those profile and display changes.

### Current integration work

The coordinator is wiring generated clients, server registration, primary stage routing and global activity. Processing reads report `unconfigured` or `fixture_only` explicitly; a missing persistent channel secret does not fabricate a connected runner. Media lock ordering is capture batch/sorted subjects, media revision, sorted blob digests, processing lane/job/attempt/question, then stream heads. Only merged public media descriptors and retention handles may cross that boundary.

The first reserved PostgreSQL window is released. Owned fixture databases, roles and children were cleaned; retained development services/previews were preserved. Further heavy qualification requires a new coordinator allocation.

## Preserved checkpoint

The coordinator requested this checkpoint to release reviewer capacity while retaining T06 ownership. It is not a ready PR and has no independent review clearance. Preserve this worktree and all shared unstaged changes.

### Files and shared state

The checkpoint contains owned processing contracts/modules/components/tests, migration 0006, this handover and the delegated capture repository extraction. The coordinator's contract-index registration, publication grants and readability-guideline changes remain separate shared integration work; they are intentionally not swept into the owner checkpoint.

Type checks below were run against the complete working tree, including the coordinator's unstaged contract registration and capture grants. The isolated owner commit alone is not presented as a standalone releasable build.

### Checks observed

- Server typecheck passed after the current strict schemas, retained producer seals and adapter-input separation.
- Frontend typecheck and lint passed; the two question tests passed again after semantic form submission and pinned-input handling.
- Four offline model/contract/sealed-question tests passed.
- Three focused PostgreSQL/HTTP and two actual DBOS child-process cases passed together after instruction-profile and complete producer-seal changes. Removing the channel capability from the injected adapter input happened afterward and still requires the focused process rerun.
- Eleven existing capture/T04 PostgreSQL cases and three existing T04 process cases passed after capture seam extraction.
- The owned Markdown checks and `git diff --check` passed.

The normal aggregate suite, final generation drift/build/format/hooks, actual desktop/narrow browser checks and independent review are pending. No skipped check is claimed as passing. No actual provider, personal sign-in, inventory transport or protected real-server request was exercised.

### Remaining implementation

1. The coordinator completes contract generation/client methods, main registration with a persistent explicit channel secret, Batch/primary-stage routing and global activity.
2. Incorporate actual merged trunk changes for the owning media descriptor/retention interface, the approved React Hook Form dependency and the typed command-payload conflict error. Do not import sibling worktree code or create a stacked PR.
3. Consume a media reservation whose batch/revision/digest locks are acquired before processing lane/job/question locks; later command pinning must not acquire earlier locks. Preserve a single media authority.
4. Adapt the owned QuestionAnswer component to React Hook Form under the prospective plan above, retaining TypeBox/AJV validation, exact string scalars, pinned authority and synchronous dirty reporting.
5. Replace the temporary generic foundation `payload_conflict` message classification with the merged `CommandPayloadConflict` type. Existing `ProcessingError` handling is already typed.
6. Request a new serialized PostgreSQL/process window and a preview namespace. Re-run relevant adverse cases at the integrated head, then inspect desktop/narrow questions/conflicts with browser recordings off.
7. Complete architecture/operator records, normal/relevant checks and a ready nonstacked PR to `interactive-app`; the coordinator supplies fresh independent review and the approved merge protocol.

### Services and credentials

The first heavy-test window is released. All T06 test children, random fixture databases and roles were cleaned. The shared PostgreSQL service and retained previews were left running and unchanged. T06 has no allocated browser preview and started no duplicate service.

Only synthetic fixture credentials and the existing owned PostgreSQL helper state were used, without printing credentials. Tests did not discover or read the original repository environment. The original InvenTree server remains strictly read-only.
