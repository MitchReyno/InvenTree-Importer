# Processing authority

This module implements durable coordination for the explicit synthetic research fixture. It does not qualify a native provider, personal account entitlement, tool sandbox, OAuth permission gate or actual AI result. The additive T07 restricted profile remains fixture-only; native qualification is still pending. The web process registers routes explicitly and never starts a worker.

## Inputs and attempts

`processing_input` retains canonical input bytes and SHA-256, exact string values, source/subject lineage, selected human values, notes, dependency attempt IDs and answer identity. Legacy `bench-intake-input/1` remains note-only with exact empty-media semantics. New `bench-intake-input/2` binds the exact owning media canonical string and its digest, including version/evidence IDs, recipes and attachment choices. Numeric recipe coordinates remain inside that string; Processing does not recanonicalize them using its number-free JSON format. Trusted instruction bytes and their digest live in the immutable synthetic profile; the manifest binds that digest and the restricted tool-profile version. Runtime decoders verify both retained-byte integrity and strict shape before treating JSON as a domain type.

A logical job is unique by batch, subject and stage. Its selected attempt is an exact-parent foreign key; a new attempt never rewrites the old input or messages. Stage dependencies reference exact attempts in the same batch and advance through the stage order, preventing dependency cycles. Old dependency IDs never redirect to newer attempts automatically. The sealed dependency set must exactly match retained edges; claims, output settlement, answers and read models verify the bounded transitive graph against selected predecessor IDs and consistent attempt/job states. A queued predecessor can remain current without being ready; output and answers require ready predecessors. An accepted human answer creates fresh downstream attempts with an explicit replacement closure in the same transaction.

## Authority and delivery

Browser commands use the existing server-bound development actor/target/context and origin/CSRF checks. Idempotency compares the full normalized payload and retains the original response. The deployment must explicitly configure a persistent private processing-channel secret; no ephemeral fallback is generated. Missing configuration permits retained inspection and cancellation while blocking new starts/answers.

DBOS delivers immutable commands through the existing complete workflow-name/class/config/queue/version/argument comparison. Worker claims recheck the actual build, command bytes, input bytes, profile, retained media binding and current attempt. The V2 worker never executes a retained V1 command as its own build; a queued legacy attempt exposes a version blocker and needs an explicit fresh attempt. Legacy accepted messages and compatible human-answer continuations retain their original authority. A durable lane serializes research for the server actor in the synthetic single-owner profile. That is not proof of a real personal provider account binding; The native account route remains unqualified and cannot be started by this module.

The coordinator authenticates each versioned envelope with a private capability scoped to its attempt. The injected research adapter receives staged input and trusted instructions with a bound result callback; it receives no channel capability, database connection, inventory credential or apply interface. Unknown envelope kinds, wrong parent/context, sequence gaps and conflicting duplicate payloads fail. Authenticated stale messages remain retained but cannot publish a current proposal or question.

## Questions and human edits

A question ends its attempt command and releases the lane. A human answer pins the exact question revision, attempt, input digest and capture revision. Counted/estimated quantity and clarification values remain typed; only the human answer path can update capture selections or append a human note. A proposal cannot choose human values or approve effects.

Answer handling takes capture locks before the lane/job/attempt/question locks, reuses the owning capture edit validation and publishes events last. Answer, human edit, new immutable input, continuation attempt, command, outbox and events commit together. A deferred publication check rolls back an applied capture edit if its final event is omitted. Public capture responses read the cursor after publication. Exact answer redelivery adopts the original continuation, including after a lost commit acknowledgement or a fresh delivery key; changed payload conflicts.

Application questions cannot represent native permission handles. A cancelled/interrupted/superseded attempt never becomes current by replaying an old message. The process fixture reaps its old child before marking its ephemeral callback interrupted and requests a fresh attempt explicitly. No automatic native session resumption is implemented.

## UI and retained display

Processing has Overview, Reading, Identifying, Research, Images and Inventory views under the existing five primary stages. Question forms pin their first exact question/context; polling updates validity without replacing the editing target or resetting dirty input. Global navigation uses the inherited dirty guard. Complete question/proposal payloads are compared with their accepted sealed producer message before display or answering.

Manual notes support standalone T06; meaningful retained notes or ready relevant media admit a V2 input. Media-only inputs never receive invented notes. Processing consumes merged T05 owning interfaces and contains no media SQL, decoder or duplicate blob authority. A lot consumes its own media plus its linked Part; unrelated subjects do not change the scoped input. Input versions `/1`–`/3` embed only Part and location observations and omit mapping fields. A create choice on that subject or its linked Part, and a `media-inputs/2` descriptor, fail with `unsupported_processing_input` and are stale on a currentness check. Only a selected Part attachment produces `media-inputs/2`; a declined or cleared one is left out of the scope. An unrelated Part's create choice does not change this subject's sealed input. The no-tools fixture uses descriptors only and cannot claim media-byte inspection. Actual provider sign-in, capacity and interruption are typed outcomes, but fixture outcomes do not establish real provider support.

## Verification and limits

The T06 handover records current PostgreSQL, HTTP, DBOS process, browser and normal-suite evidence separately. The original repository environment's InvenTree server remains strictly read-only. Tests use random owned databases, synthetic identities and explicit fixture workers without loading that environment or constructing a target/provider transport.

## Read models and occupied capacity

Ordinary reads, inserts and plain keyed updates use Drizzle on the existing checked-out client. Row locks, compare-and-set, revision increments, the lane upsert, the dependency closure, `public.`-qualified pool reads and transaction isolation stay explicit SQL. Reviewed migration SQL remains the schema authority. Snapshot authorization, input freshness and cursor share one repeatable-read transaction. Question/proposal projections validate the complete accepted producer envelope before returning displayed payloads.

Logical freshness and occupied capacity are separate. The workspace may label changed input superseded while global activity retains a running attempt's recorded state with `input_current=false` and `occupies_lane=true`. A held lane is included before truncation; a held command outside the configured target/context contributes only the aggregate `lane_occupied` flag. Occupancy requires terminal settlement or explicit interruption after reaping, and does not itself prove native process liveness.

## Media locking and retained provenance

Command creation takes authorized capture batch/all sorted subject locks, media revision exclusion and the complete sorted digest union before any actor lane, job, attempt or question lock. The owning bulk seam returns genuine per-subject handles in request order. Each stage/continuation pins its exact handle immediately after inserting the immutable foundation command, including empty scopes. Answer closure discovery happens under the capture lock before media reservation; publication remains last.

Read snapshots and activity use one authorized media snapshot with separate typed results per subject closure. Pending media and input capacity make the old input noncurrent and expose a safe blocker without hiding its history or held lane. Authorization, corrupt/missing retained command bindings and infrastructure failures propagate. Read paths neither acquire domain locks nor manufacture recovery pins.

V2 proposal provenance binds note ID and exact text digest, or evidence ID, version ID and content digest. Retained display verifies the complete accepted producer payload and those sources against the exact input. Worker authority additionally verifies the owning immutable command binding and complete pin set. A digest from another version or batch is insufficient.

Logical cancellation/supersession of a held attempt retains physical lane ownership. Authenticated stale proposal bytes remain inspectable without publishing current proposals or releasing that lane. Only its exact command-ending terminal/question or explicit interruption after reaping settles the claim; old settlement cannot release a newer attempt or regress its selected job.

All actual agent/model/provider usage is prohibited until explicit later user authorization. Deterministic fixtures exercise coordination and descriptor provenance only. Corrected qualification passed 64 PostgreSQL and 25 process cases without skips; independent domain review reran the original predecessor-replacement reproduction and all eight new scenarios. Independent desktop/phone checks observed multi-stage progression and exact human-answer continuation. The [T06 handover](../../../../docs/handovers/bench-intake-T06.md) and [dependency correction](../../../../docs/handovers/bench-intake-T06-dependency-currency.md) record evidence and limits. These fixture results do not establish actual provider support.

## Exact predecessor lineage and fresh consumer input

Dependency authority has two parts: the immutable exact predecessor graph and the current consumer input. Every graph node verifies its retained command, input, profile and media pins; every edge must match the sealed manifest, remain in the same batch and advance through stage order. Replaced, cancelled, interrupted or inconsistently projected predecessors invalidate consumers transitively. No read or settlement redirects an old predecessor ID to its replacement.

Historical predecessor inputs are not recomputed against the newest capture/media snapshot. An explicit accepted research answer deliberately creates a fresh research/downstream input while retaining its selected ready reading predecessor. The consumer itself still compares its complete own capture/media closure against current authority, so an unaccepted edit cannot become current by preserving an old dependency ID. Current-but-unfinished predecessors keep queued work visible without permitting a claim; stale nonterminal output retains bytes and physical lane occupancy until exact terminal settlement or confirmed reap.

## Retired subjects

A lot split or merged before approval is marked `retired: true` in the capture snapshot. `startProcessing` refuses it with `subject_retired` (409) inside the idempotency closure, so an earlier committed start still adopts its receipt. `processingInputIsCurrent` treats a retired subject as stale, which the existing stale policy then applies everywhere: a queued claim becomes `superseded` without new work, an answer fails with `stale_question`, and reads project the job and open questions as `superseded` while retained proposals stay listed. Retirement never releases a held lane; only its exact terminal settlement or reap does. The [T08 handover](../../../docs/handovers/bench-intake-T08.md) records the PG evidence.

## Restricted fixture profile

The additive `bench-intake-input/3` / `processing/3` authority selects `restricted-research-stub/1` with immutable `restricted-research-tools/1` policy. Its manifest seals exact server-admitted source URLs; removal makes a running input noncurrent while preserving its physical lane until command-ending settlement or confirmed reap. Defaults and byte authority for earlier profiles remain unchanged.

The owning research access seam validates current command/input/dependencies/media and held lane in a read-only transaction. Proposal receipt sources are verified against complete retained attempt/command/input scope before publication and retained display. Public projections expose opaque receipt IDs/digests only. See [restricted research](../research/ARCHITECTURE.md) for source isolation, budgets and explicit native qualification limits.

A restricted adapter must reap its controlled child before emitting an application question or terminal. A distinguished unconfirmed-reap error prevents delivery from interrupting/releasing the lane. No native provider process is constructed automatically; all live model usage remains prohibited.

## Locking-query mapping

Lane, job, attempt and question row locks use Drizzle on the original checked-out transaction client, preserving capture→media→lane→job→attempt→question ordering and exact scope predicates. Explicit PostgreSQL text casts retain revision, attempt number and message sequence strings at the existing domain boundary. Shared job-column selection is a query projection, not state or revision authority. Insert-before-lock lane establishment, compare-and-set updates and publication order remain unchanged.

State transitions and supersession now express revision increments as PostgreSQL arithmetic through Drizzle. Actor-lane release remains one conditional UPDATE on the exact attempt ID; conflict insertion cannot clear a retained lane. Answer/continuation order, final publication and physical-child ownership rules are unchanged. Public-qualified post-child checks and recursive dependency closure remain explicit SQL.
