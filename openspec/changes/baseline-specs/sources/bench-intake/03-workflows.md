# 3. Workflows and execution

[Design index](README.md) · Proposed TypeScript application and PostgreSQL execution flows; new runtime, HTTP/auth and fault behavior remain to prove.

## Capture and processing graph

```diagram
ready evidence ─► Reading ─► Identifying ─► shared Part research ─┐
      │              │            │                             │
      └─ image prep ─┼────────────┼──────────► Images ──────────┼─► Review
                     │            └─ lot facts ─► Inventory ────┘
                     └─ unresolved count ─► Question ─► new input
```

Stage views show the same graph from different perspectives. Reading extracts source observations and page/region references. Identifying proposes lot/Part relationships. Research enriches a shared Part and retains sources. Images produces deterministic candidates. Inventory matching proposes existing record reuse and separately detects possible duplicate stock. Human edits can satisfy a prerequisite without agent research; no provider is required merely to record known data.

Create a logical job for a meaningful unit such as one evidence interpretation or one shared Part investigation. Do not spawn a fresh model session for every URL or field. Deterministic media/read-only inventory work uses ordinary bounded jobs; only tasks needing inference consume the provider lane. Start with one active research job per account and one apply lane; parallel safe media/reads are bounded independently. Report counts of ready/running/waiting/completed work, not a fabricated percentage over a graph still being discovered.

## Job and question lifecycle

```diagram
queued → running ──► succeeded
            │       failed / interrupted / cancelled
            ├─────► waiting_for_login / waiting_for_capacity
            └─────► waiting_for_user (command ends; slot released)
                              │
                     authorized current answer
                              ▼
                     new input + new attempt → queued
```

`waiting_for_user` is a product state; the workflow command that published it has finished. Do not park a workflow in a serial lane waiting for a person. Keep the durable question, original attempt context and a bounded continuation context. The answer transaction verifies actor, scope, question revision/currentness and typed value; commits the answer, updated selections/input manifest, next command and outbox together. Repeated identical answer submissions adopt their stored result; changed payload with the same key conflicts.

```diagram
Browser          API/Postgres              TS worker/runner
   │ answer q7,r2     │                          │
   ├─────────────────►│ lock question + scope    │
   │                  │ check actor/revisions   │
   │                  │ answer + input2 + outbox│
   │                  ├─ commit ────────────────►│ attempt2
   │◄─ saved / cursor─┤                          │
   │                  │◄─ old attempt1 result ──┤
   │                  │ retain stale; no replace│
```

Native permission requests are not application questions. A provider runtime restart invalidates in-memory permission handles. The UI cannot replay an old “allow” response into a new request. If safe native continuation is not demonstrated, stop that attempt and create a bounded new one with application-approved context; do not claim native resumption parity.

## Durable dispatch and duplicate handling

1. Commit the domain action, immutable command and outbox row in one PostgreSQL transaction.
2. A dispatcher claims bounded outbox rows and enqueues using a stable workflow ID and explicit application version.
3. Before acknowledging an existing ID, compare stored workflow function/queue/version and complete immutable arguments to the authorized command. A digest is useful, but compare the actual bound content where available.
4. Persist explicit ACK or conflict disposition. A conflicting row does not starve unrelated eligible rows.
5. At execution and before accepting emissions, check the actual worker/runtime version, authorized command, current attempt and payload binding again.

SQL dispatch claim expiry permits redelivery of the same immutable command, not a second accepted job attempt or new execution. The selected durable runtime owns scheduling, not approval or physical-write ownership. DBOS TypeScript must independently demonstrate full payload/version checks and restart behavior from the Python spike; do not assume SDK parity. If its public interfaces cannot support this boundary, revise the runtime choice before production rather than querying undocumented internal tables or weakening duplicate checks.

## Preparation, review and approval

```diagram
mutable draft → selected dependency closure → read-only preparation
                                                  │
                                    unresolved choice / changed effects
                                                  ├──► question / review
                                                  │
                                           frozen prepared plan
                                                  │
                            current review + actor + exact digest
                                                  ▼
                         approval + run + journal + command + outbox + event
                                     one PostgreSQL commit
                                                  │
                                         dispatch same command
```

Preparation queries target capabilities and identities without mutating inventory. It materializes defaults/overrides and exact selected media, resolves recorded choices and builds named operations with preconditions and dependencies. Shared Part prerequisites appear once, with affected lots shown; including a shared Part never pulls in another lot's stock, purchase-order contribution or attachments. Stale/incomplete reads are not evidence of absence. Unavailable choices create typed questions rather than UI prompts inside a worker.

Freeze the entire executable specification: selected lot keys, typed values and units, exact media bytes, reviewed warnings, source/evidence hashes, target/continuity/config/capability bindings, executor build and plan schema. The server owns canonical byte encoding and digest. The browser displays the server's effects projection and submits the expected digest; it does not reserialize or construct an executable plan.

At preparation publication and approval, inspect cumulative contribution history under the original target/source guard, not only the active run. Previously confirmed stock cannot be created again even if consumed/deleted; approved pending/no-effect work uses original-run recovery. Approval rechecks exact selected lot and shared Part reviews, issues, revisions, target/configuration and current user permissions/scopes, then commits approval, original run reservation, initial journal rows, command/outbox and event together. Read-only preparation may become stale because another client changes inventory. Execution rechecks authority/preconditions; new effects or choices return to review, never silently expand approval. Approval does not promise the target remains unchanged until execution.

## New execution core: operation model

The new executor validates retained typed operations for the supported selected slice, with the [logical journal model](../typescript-data-model/04-execution.md) as authority. Each operation names required usable outputs and, where needed, a settlement barrier; consumers do not depend on an entire lot succeeding. A known shared Part can support lot B even if lot A's optional attachment failed, subject to same-source settlement. Identity prerequisites must still be satisfied. Plan bytes are executable authority; relational operation rows are their checked index, never independently editable specifications. Preserve safety semantics from the Python engine, not its internal schema/state labels by assumption.

```diagram
resolve/create Part ──► identity parameters ──► stock A ──► barcode A
       │                                             └──► attachment A
       └───────────────────────────────────► stock B ──► barcode B

selected original/derivative bytes → approved destination → evidence transfer
```

An operation's result state and effect certainty are separate; use the checked vocabulary in the companion model. “Failed” is not a retry permission. Persist all trustworthy output identities immediately, including a Part created before its parameter failed. Do not hide confirmed stock because a later attachment failed. Effect-derived provenance archives are deferred from the smallest slice; adding them needs an explicit immutable artifact policy and transfer history, not attaching new bytes under an old approval.

## Single apply ownership

Use one serial supervised TypeScript apply process with stable host OS exclusion and a dedicated PostgreSQL advisory-lock connection outside pooled transactions. A queue limit or database lock alone cannot prove a disconnected/timed-out process stopped writing. No lease expiry permits replacement while the original process/request may survive. Non-expiring source guards and cumulative retained history survive process-lock release. A new database, target alias or source namespace cannot bypass an old uncertain effect.

If PostgreSQL or its ownership connection becomes unavailable, stop new authorization/sends; an already authorized/in-flight request may still finish. Never silently reconnect the old writer into resumed ownership or start a replacement until its exit/reaping and uncertain request are accounted for. Accepted effects remain confirmed or unknown; application EOF does not classify them. No automatic cross-host failover is supported. A host move requires quiescing/reaping the old writer and coherently transferring validated database/blob/configuration state with an external apply-disabled gate, not simply connecting a new worker to PostgreSQL.

## One actual remote request

```diagram
Apply process         PostgreSQL journal                 InvenTree
    │ validate approval/target/preconditions                  │
    ├─ commit request intent ──►│                             │
    │◄─ durable commit ─────────┤                             │
    ├──────────────────── actual send ───────────────────────►│
    │◄──────────────── trustworthy output / transport loss ───┤
    ├─ result/effects + projection/event COMMIT ─►│            │
    │ next operation only after durable outcome               │
```

All actual sends—including pagination, verification and transfer requests—receive correlation, retained pre-send intents and bounded timeouts. Read retries have one bounded budget owned by the target adapter. Mutations disable implicit HTTP retries and redirect-following behavior that could resend or change the target. Check current acting-user authority, writer connection, original approval, source guard, target continuity, preconditions, epoch/external gate and cancellation before authorizing a request. Require a known committed intent before send; do not hold a retried SQL transaction around the network call. If the intent commit ACK is lost, inspect its stable key read-only after reconnect and retain possible-send uncertainty; do not blindly send or invent another identity.

After a crash, a request with no durable result may have been sent, even if the process died between committing intent and the actual send. Unless there is independent proof of no effect, treat an uncorrelated create conservatively as unknown. A valid returned PK can be checked against its intended identity; a matching-looking record found by payload search cannot establish that it is the original create. Persist all trustworthy returned identity evidence even if the response shape is malformed or subsequent read-back fails.

## Crash/recovery cases

| Boundary | Recovery action | Forbidden shortcut |
| --- | --- | --- |
| Approval commit before enqueue | Dispatch retained outbox/command | Reapprove or allocate another command |
| Enqueue before outbox ACK | Verify and adopt same workflow/payload/version | Treat workflow ID equality as full proof |
| Approval reservation transaction fails | No partial approval/run/journal commits; inspect stable keys if commit ACK is lost | Allocate replacement authority because response was lost |
| Intent committed before response checkpoint | Reconcile known evidence or report unknown | Generic mutation retry |
| Result/effect/event commits but delivery is lost | Read durable projection/cursor; recompute caches if needed | Recreate object because UI saw no result |
| Progress lost/browser closes | Fetch durable snapshot and cursor | Cancel/reexecute based on SSE EOF |
| Authority or media missing/corrupt | Recovery-required; prevent new dependent writes | Reconstruct authority from UI JSON or absence |
| Old process remains alive | Observe it; request cancellation; wait/reap explicitly | Expired lease authorizes another writer |

## Cancellation and selected recovery

Cancellation is a durable request, idempotent per run and serialized against request authorization on the run row. The supervisor can signal the apply process through a bounded independent control channel, but the worker also checks durable cancel state before every new request. A previously authorized request may still be in flight; a nonresponsive process is shown as stopping/unresponsive. Process termination leaves that request unresolved unless settlement was persisted. Permission loss similarly blocks new privileged work, not rollback or erasure of history. Neither cancellation nor reauthentication authorizes replay.

Offer supported actions per operation: resume untouched pending work, re-read a known record, verify retained attachment bytes, repair a specific missing-field/attachment effect when safe, or retain a needs-review/unknown outcome. Repair binds the original approval/run/operation and revalidates its immutable scope. If it would add/change effects, return to preparation and separate approval. No “retry entire item”, force-success, automatic DELETE compensation or “I checked, create again” button.

Attachment acknowledgement loss needs content/domain verification, not a filename match. A previously confirmed file later removed is not automatically permission to upload again. Missing stock after consumption/deletion is not permission to restore historical quantity. Unknown prior same-source stock blocks a later lot round; a new source ID, engine family, target alias or state root cannot bypass it.

## Later approval rounds

After round A safely settles, round B uses its original lot/contribution identity and explicitly reuses the validated known Part output. Fresh preparation considers current target state and **all** retained contribution history, even when the source guard no longer points at A. Selecting A again never creates replacement stock; original approved pending/no-effect operations remain recoverable only under A. The old approval and results remain immutable. If A has unresolved effects, B is blocked according to the shared source/target guard until supported reconciliation establishes safe continuation. Repairing A later reacquires that same guard under A's original run; it cannot overlap B. The browser explains the blocking earlier run and links to it.
