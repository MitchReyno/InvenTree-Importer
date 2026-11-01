# T06 — durable processing and application questions

Current checkpoint: V2 retained-media integration is implemented. Focused qualification passes 7 PG/public-HTTP cases and 3 actual deterministic worker cases, with zero skips. Final normal host-loopback checks, browser qualification and independent review remain outstanding. No ready PR or actual provider capability is claimed.

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

## Resumed integration plan

The same T06 owner resumed after the coordinator checkpointed shared registration and merged the actual query/form changes. The normal trunk merge now includes the reviewed readability rules from PR #49. Capture's lock/apply/publish extraction is preserved; its incoming conflict contained formatting of the superseded inline edit body. Root/frontend guideline conflicts adopt the actual merged rules.

React Hook Form 7.91.0 arrived through the independently merged capture/new-batch PR #48 rather than waiting for T05. Adapt the owned QuestionAnswer now: native registered fields, library-owned field/error/submission state, unchanged TypeBox validation and exact scalar strings, a mount-pinned question/context, synchronous dirty reporting from the input event, and stable retry payload/key. Polling must never reset the form. Retain TypeBox/AJV; no resolver package or dependency change is needed.

Replace the Processing route's temporary payload-conflict message comparison with the merged `CommandPayloadConflict` type. Apply the maintained readability fixer and Prettier to owned source. Then request the serialized PostgreSQL window for the three focused HTTP/PG and two child-process cases, including the adapter-input capability separation.

The independent server-state owner retains App, Batch, legacy ManualWorkspace and global activity ownership. ProcessingWorkspace's query-cache adaptation waits for that actual merge and will use its public server scope and query keys. The OpenAPI client and media interfaces likewise wait for actual trunk merges. No unpublished sibling code or new preview is consumed during this step.

### Form/error/readability checkpoint

The React Hook Form conversion passed all five focused question tests and application typechecks. Added observations cover synchronous dirty notification, TypeBox rejection without a send, a replaced question prop retaining its original mounted context, exact large decimal strings and frozen fields during a pending submission. The existing lost-acknowledgement test still adopts the same payload/key. The form uses library field/error/submission state; no polling reset or numeric coercion was added.

Processing routes now classify the actual merged `CommandPayloadConflict` type. Maintained readability rules were applied to owned runtime files and the extracted capture seam; the initial check also caught two missing function-declaration spacings in the new tests, which were fixed with the same maintained rule. API client integration will follow a normal merge of the actual PR #50 trunk before the coordinator changes its shared registrations.

### Ordinary Processing reads

Before the next owned read-model edits, apply the approved Drizzle direction to ordinary Processing queries on the existing checked-out PostgreSQL connection. New owning schema/read modules describe selected columns only; reviewed SQL migration 0006 still owns constraints, deferred checks and immutability. Keep explicit locking and atomic transition SQL where its ordering is clearer.

Build named question/proposal projections with complete producer-seal verification rather than nested projections over untyped rows. The initial activity-freshness interpretation was refined by coordinator review below: current-input freshness and occupied runner lanes must remain separate facts. Add a public activity regression and re-run the focused PostgreSQL/process cases under a new allocation. No shared schema, package, generator or unpublished media/TanStack interface is changed by this work.

### Activity freshness and occupied lanes

Coordinator review identified an essential distinction before qualification: a logically stale input does not mean its worker has stopped or its account lane has been released. Activity retains a held attempt's recorded state and includes `attempt_id`, `input_current` and `occupies_lane`; `lane_occupied` remains a safe aggregate even when the held command belongs to another configured target/context. Scoped held entries are prioritized before truncation.

The logical workspace can mark stale input superseded while activity still reports the observed running attempt with `input_current=false` and `occupies_lane=true`. Only terminal settlement or an explicitly reaped/interrupted child releases that occupancy. The process regression edits human quantity while the actual synthetic child is paused and alive, checks its public activity and retained lane, then reaps/interrupts it and verifies the released lane and fresh attempt preserve the human value.

### Resumed qualification results

After the actual PR #49 and #50 merges, all application typechecks and five React Hook Form question tests passed. Maintained readability checks passed after fixing the two test declaration spacings with the owning rule.

The first resumed PostgreSQL window passed the three focused public HTTP/PG and two actual DBOS child-process tests, including the previously unqualified adapter-input channel-capability separation. The next window repeated all five successfully after typed ordinary reads and the clarified activity semantics. Both windows used isolated synthetic namespaces, cleaned their own databases/roles/children and released the shared PostgreSQL allocation.

Activity now retains a held lane first with its exact attempt identity and recorded state. `input_current=false` describes stale dependencies; it does not claim that the worker terminated. `occupies_lane` and `lane_occupied` describe reserved capacity pending settlement, not proof of native provider liveness. The physically paused-child regression confirms the lane remains visible after a human edit and disappears only after the owned child is reaped and explicitly interrupted. The fresh attempt retains human quantity `31`.

The current Activity DTO is frozen for coordinator registration/client generation. Media descriptors/pins, server-state query integration, combined global activity UI and actual browser checks still require their actual merged prerequisites. No ready PR or independent clearance is claimed.

The complete current frontend suite passed 18 tests after the form adaptation and error-description wiring. The owning read-model checkpoint also passes server typecheck, four offline model/seal cases, maintained readability and Markdown checks. These checks do not replace pending generated-client, media/query-cache integration, browser evidence or fresh independent review at the eventual ready PR head.

## Processing query-cache adaptation

After the coordinator merged actual PR #51 into this worktree, T06 owns only ProcessingWorkspace and its focused tests for this step. Use the merged ServerScope, serverQueryKey and retained poll interval. The coordinator retains App, Batch, header and combined activity integration; media remains gated on its actual merge.

Replace the local timer and copied server snapshot with useQuery data. A mounted editor requires its own successful read before any start, cancellation or answer command; a warm cache, failed read or paused read cannot supply command authority. Preserve the first exact question/context, RHF drafts and stable uncertain-command payload/key. Refetch after commands without classifying a confirmed save as an unknown outcome merely because the follow-up read fails. Test warm cache, read failure/pause/recovery, pinned drafts and uncertain retry identity without PostgreSQL or a new preview.

### Scoped Processing read results

ProcessingWorkspace now consumes useQuery data under the server-scoped `processing`/batch key and the shared retained poll interval. It has no local poll timer or copied server snapshot. A successful read by the mounted workspace is required in addition to the query's mounted-fetch status; manual warm-cache writes cannot authorize commands. Current query errors/paused reads block start, cancellation and answers. Refetching never substitutes another question or clears a dirty RHF form.

Eight focused component cases passed: three workspace query/cache tests and the five existing question-form tests. They cover warm-cache writes, failure/recovery, paused/resumed reads, exact pinned draft preservation, stale-question replacement refusal and an uncertain start reusing its original payload/key. One initial assertion was corrected to wait for the query observer's visible stale-state update; the resulting observable refusal passes. Frontend typecheck passed.

The coordinator can render the unchanged ProcessingWorkspace props within the existing scoped ServerStateProvider. No App, Batch, header, global activity, package, provider, service or media implementation was changed during this step. PostgreSQL was not used; its current allocation remains with the media owner. Whole-feature browser and media integration qualification remain pending.

### Initial question pinning correction

Coordinator inspection identified that the first pinning effect could consume warm query data before the mounted read was verified. Gate initial pinning on the successful mounted read as well as available query status. Keep the already-pinned identity check ahead of that gate so later failed/paused reads or refreshes preserve the exact question and RHF draft. Add a cold-mount regression with cached revision 8/open question revision 1 and a fresh revision 9 response where that question is answered at revision 2; a new current question must never substitute for the explicitly requested old one.

The cold-mount regression first failed against the previous effect by finding the cached revision-1 form before the read resolved. After the gate correction, initial cached data cannot mount the answer form; the fresh response pins requested question revision 2/capture revision 9 and refuses to substitute its newer current question. The existing refresh/error cases still preserve an already-pinned dirty value. All nine focused tests passed (four workspace cases and five question/RHF cases), with no skips. Changed-file ESLint, Prettier, Markdown and diff checks passed. The coordinator's concurrent shell integration edits were preserved and are outside this checkpoint.

### Archived Processing alignment

Before the final owned UI adjustment, align Processing controls with the existing backend archive refusal. An archived batch remains inspectable but cannot start, cancel or answer; subject selection and answer fields become disabled without discarding an existing draft. Direct users to resume the batch using the existing header. Do not change backend archive policy or shared header wiring. A focused case will begin with a verified live selection/draft, then archive the displayed batch and prove every mutation remains unsent, including a forced form submission.

The coordinator approved a narrow QuestionAnswer ownership extension after inspection found that an outer disabled fieldset would also block local discard while the dirty guard disables header Resume. Add an optional readOnly prop for the field group/save only, leaving explicit local discard available. Preserve the pinned context and uncertain delivery identity until confirmed save or explicit discard. The archived-dirty regression must show retained value `51`, zero mutations and an enabled discard that clears the dirty guard.

The archive regression first reproduced the enabled Queue action after a verified live draft transitioned to archived. The corrected component disables start/cancel/answer, subject selection and answer fields, preserves the local value and rejects a forced form submission without invoking any mutation client. Explicit discard remains enabled, clears the draft and reports a clean dirty guard so existing header Resume can be used. All ten focused cases passed (five workspace and five question/RHF), with no skips; frontend typecheck and changed-file style/Markdown checks passed. No backend archive policy, header, service, PostgreSQL or provider behavior was changed.

## Retained-media preparation

The [prospective media integration plan](bench-intake-T06-media-plan.md) records the exact owning seam, closure/lock/pin order, additive format compatibility, unavailable-media currency and adverse tests before runtime integration. This is documentation-only preparation; actual T05 merge and coordinator go-ahead still gate code changes.

The latest user instruction prohibits actual agent/LLM/provider test usage until explicit later authorization. Deterministic stubs only; prior permission to reuse local sign-in does not authorize live-model tests. The original InvenTree server remains strictly read-only. No services, runtime code or unpublished sibling implementation were changed during this preparation.

## Post-T05 V2 implementation checkpoint

The coordinator integrated actual T05 at `d647938` and approved the committed media integration plan. New migration 0007 adds profile2 without rewriting migration 0006, profile1 instructions or old sealed bytes. Shared code generation is coordinator-owned and has been refreshed from the frozen V1/V2 Processing unions.

Owned consumers now reserve bulk exact media handles before Processing locks, pin each foundation command, verify historical command media authority, retain typed note/media provenance and use per-closure media currency. Legacy queued commands are quarantined by actual handler version while retained evidence remains readable. V2 admits ready media-only input without inventing a manual note; the synthetic runner has no content/model capability.

The stale-message fix also covers logical cancellation/reprocess: held capacity survives until its exact terminal or reaped interruption. A controlled deterministic child fixture is prepared to prove pending-media stale proposal, cancellation and fresh reprocess behavior while the old child is physically alive. This case has not yet run at this checkpoint.

Observed offline evidence at this working checkpoint: server and frontend types passed; full frontend suite passed 79 cases; focused model/provenance suite passed 8 cases. Owned runtime readability passes. The normal server-fast run was attempted in the filesystem sandbox: 18 passed and 9 loopback-listener cases failed `EPERM`, so that full tier is not green. Rerun it with the approved loopback execution capability during qualification.

Prepared qualification adds media-only linked-Part input with disabled web media, unrelated pending scope exclusion, relevant pending history/occupancy, exact version provenance and atomic queue refusal. Separate cases cover legacy read/quarantine/new explicit empty pin binding and missing V2 binding refusal. The existing answer COMMIT-ACK and restart cases remain selected. PG/process and small actual decoder checks await the coordinator's exclusive allocation; no service or provider action was started by this implementation checkpoint.

No actual agent/LLM/provider test usage is allowed until explicit later user authorization. All research workers here are deterministic fixtures. Real InvenTree remains strictly read-only, and no real credentials or original environment are loaded. No new PR, independent clearance or merge is claimed. Preserve all coordinator/other-owner work and coordinate the shared index before staging or committing.

### Allocated V2 qualification results

The coordinator allocated the sole PG/Docker window after the owning media scope suite released it. Processing used the existing PG service and immutable decoder image `sha256:99b15169e7d8c286bbe7f2f7a5241be9feb9d714a53200d496bf639b4c58f888`, without creating persistent services. The window is released and all selected fixture disposal paths completed.

| Selected boundary                  | Observed result      | Discriminating evidence                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Processing PG/public HTTP          | 6 passed, zero skips | Existing answer COMMIT-ACK/continuation/publication cases; legacy worker quarantine with byte preservation and explicit new empty binding; absent V2 binding refusal; media-only linked-Part scope with disabled web media, unrelated pending exclusion, relevant pending history/occupancy, atomic queue refusal, relinked closure and attachment-staled exact question |
| Actual deterministic DBOS children | 3 passed, zero skips | Existing restart/question/second-lot and reaped-session cases; live controlled child emits stale proposal after relevant media becomes pending, keeps its lane across logical cancel/reprocess, then its exact terminal releases old capacity and fresh work preserves the human quantity                                                                                |
| Focused Processing UI              | 14 passed            | Warm-cache and pinned RHF cases, archive/discard, typed media blocker/source IDs, stale-running exact Cancel and explicit server false suppressing legacy fallback                                                                                                                                                                                                       |
| Model/provenance offline           | 8 passed             | Exact numeric media canonical bytes inside the V2 string, media-only admission, no blank-note fabrication, note hashes, wrong evidence/version/hash and preserved V1 input shape                                                                                                                                                                                         |

The final schema includes optional `can_cancel` on jobs; actual responses supply explicit booleans. Snapshot and mutation share the raw selected-attempt cancellation policy, while displayed superseded freshness remains separate. Revision/attempt checks still authorize the command. The coordinator regenerated shared contracts after this final addition.

These results qualify deterministic coordination only. They do not claim actual AI/media inspection, native permission support or provider entitlement. Final host-loopback normal checks, current-image whole-feature checks, actual desktop/narrow browser checks and independent review remain separate gates. No new PR or review clearance is claimed. Shared and owned files remain unstaged pending coordinator index sequencing.

### Fenced lookup requalification

Post-check inspection found inherited pool reads before the transaction search-path fence in worker claim and dispatch. Those reads now run inside short fenced owning transactions; DBOS delivery stays outside. Post-adapter state/lane reads name the public schema explicitly.

A max-one-connection runner fixture installs a hostile temporary `command` table. The negative control returns its forged command ID, while the actual fenced claim returns the exact retained public attempt. After this fix the selected PG tier passed 7/7 and all 3 deterministic child cases passed again, without skips. A final strengthened stale-output test additionally proved that another old terminal cannot clear a newer running lane or regress its current job; its affected PG file passed 3/3.

The exclusive PG/Docker window is released and fixture disposal completed. Root API/test checkpoints are `e7084a4` and `763a463`; the coordinator delegated staging of the two regenerated contract artifacts with the owned Processing checkpoint. No unrelated root paths are included. Final host-loopback normal checks, actual browser checks and independent review still remain.
