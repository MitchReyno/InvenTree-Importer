# T06 retained-media integration plan

## Status and authorization

Prospective plan only, prepared at T06 checkpoint `6f4eb77` before T05 PR #53 merges. The proposed public seam was read from the T05 handover; no unpublished runtime code was imported, copied or cherry-picked. Runtime implementation waits for the coordinator's actual-trunk merge and go-ahead.

All agent/provider tests must use deterministic stubs. Actual model calls or provider usage require explicit later user authorization, overriding earlier local-sign-in permission. Do not access personal credential stores. The original repository environment's real InvenTree remains strictly read-only, including mutation/denial probes. No PG, Docker or browser allocation is requested by this planning step.

## Media authority and scope

Use the owning `lockMediaInputs` handle for commands. It captures authorized scope, shared media exclusion, all sorted digest locks and its transaction-lifetime sentinel; `pinCommand` later inserts the exact captured binding without acquiring earlier locks. Never serialize the handle itself, clone it into another capability or reconstruct its captured manifest.

The coordinator supplies the narrow read-only media descriptor seam after actual merge. Compose owning `mediaSnapshot` and pure `scopeMediaInputs` on the caller's repeatable-read client, with the same subject validation as the locked resolver. Do not call locking `resolveMediaInputs` from read-only snapshots, open a nested transaction or query media SQL from Processing.

For a lot, relevant subject closure is the lot plus its currently linked Part. A Part job uses that Part. Both include batch evidence according to the owning scoper's explicit policy. Retain exact subject IDs, version/evidence IDs, recipe provenance and content digests. Shared-Part media affects dependent lots; unrelated-lot media must not invalidate a different closure. Use the owning canonical scoped manifest/digest, never a global revision alone or a hand-trimmed substitute.

The published media input limits remain authoritative: at most 64 versions and 100 subject IDs. Detect unsupported closure capacity and refuse the whole request without committed inputs, commands, pins or events. Do not expand caps or silently retain only the first versions.

## Formats and compatibility

Keep sealed `bench-intake-input/1` bytes and its `media: []` semantics unchanged. Add a discriminated `bench-intake-input/2` using the exact owning media manifest representation and digest. Reuse the owning public descriptor/schema types after merge rather than defining parallel media metadata. Legacy input remains current only when its relevant current media closure is genuinely empty and its other dependencies still match.

V2 supports media-only evidence: notes may be empty, but meaningful retained notes or a ready relevant media version must exist. Never synthesize a blank note to satisfy the old standalone restriction. Preserve original note text and human selections without normalization.

Add typed `bench-intake-proposal/2` provenance. Proposed sources are either `{ kind: 'note', note_id, text_sha256 }` or `{ kind: 'media_version', evidence_id, version_id, sha256 }`. Require at least one source; every source must match the attempt's exact retained input and immutable command-media binding. A matching digest from another batch/version is insufficient. Decode old note-only proposals unchanged, and compare the complete new payload with its accepted producer message before display.

Propose `bench-intake-runner/2`, `synthetic-research/2` and `processing/2` for new media-aware commands, with an additive `0007_processing_media.sql` profile/compatibility migration if that ID is available. Do not edit applied migration 0006 or old profile/instruction bytes. Retain legacy read/display; never execute old commands under a falsely matching new build. A fresh explicit attempt or a tested compatible human-answer continuation creates V2 authority. Final names/seed constraints and legacy worker quarantine are coordinator review decisions before runtime edits.

Public start/answer request authority remains server-bound; no browser provider, path, URL or credential fields are added. The coordinator owns shared registration, OpenAPI generation/client changes and main/shell integration.

## Ordered command integration

1. Apply the owning transaction search-path fence before authorization/idempotency reads; reuse its public helper if available. Acquire the authorized capture batch and all relevant capture subject locks in stable order. The current start path needs the public sorted-subject locking seam; answers already use the capture edit lock.
2. Before any lane/job/attempt/question lock, determine every affected subject closure, including downstream continuation subjects. Resolve media revision and acquire the entire sorted digest union. To reuse the existing single-scope API, first reserve a validated union handle, then obtain genuine per-closure handles while still before Processing locks; these calls must request no new digest outside that initial union. Confirm this monotonic property after merge. Otherwise request a media-owned bulk reservation seam rather than manually locking media internals.
3. Keep each genuine handle on the same checked-out client/backend/transaction. Do not slice a union handle into fake smaller capabilities. A conservative union beyond the published cap is a typed whole-request refusal; no speculative cap increase.
4. Acquire the actor lane, sorted jobs/attempts and question. Revalidate pinned question/attempt/input and affected closure. Apply an authorized human answer through capture's existing edit seam; media must remain the already-reserved closure. Confirm that owning scoped bytes exclude unrelated capture revisions; do not silently rewrite a sealed media format if an additive owning version is needed.
5. Construct and validate each V2 immutable input. Insert its foundation command, then call that exact closure handle's `pinCommand(commandId)`. Pinning acquires no earlier capture/media/digest lock. Insert attempt/dependencies/outbox and other domain rows. Any refusal rolls back the human edit and all new authority.
6. Publish capture/Processing events last, then commit. Never hold database locks while decoding, staging external tools or waiting on a provider. Discard handle objects at transaction end; retain the owning immutable command binding for later verification.

Exact-empty scopes still require a genuine handle and an immutable command binding. They are not a fast path around sentinels, pinning or currency checks.

## Currency, unavailable media and physical occupancy

Use the same owning scoped comparison for read snapshots/activity, dispatch, accepted messages and answers. Later worker verification must load the retained command-media binding through an owning public read/verification API; do not insert missing pins during recovery. The coordinator owns any necessary additive media seam/grants.

Expected pending/unreadable media (`media_not_ready`) and supported input-capacity refusal make an old input noncurrent without hiding its retained history or ending a running attempt. Normalize only the actual specific typed owning conditions after merge inspection: the current resolver may throw CaptureError rather than MediaError. Authorization, malformed authority, SQL/connection and other infrastructure faults must propagate; never convert them to empty/current scope.

Queue/continuation refuses known unavailable media atomically. Read models preserve old questions/proposals and expose a safe typed blocker, while activity retains exact attempt identity, recorded state and occupied-lane flags. A logically superseded projection is not evidence that its worker stopped.

Correct the existing stale nonterminal-message path: retain rejected/stale proposal bytes without publishing a current proposal or releasing the lane. Settle/release only on a truthful command-ending terminal/question outcome or explicit interruption after reaping. Preserve accepted history and current human values. This is a correctness fix, not a formatter change.

Web BlobStore availability is distinct from DB descriptor authority. Resolve/pin real DB scope even when uploads/content routes are disabled; never substitute empty media. The T06 no-tools fixture may coordinate descriptor-bound synthetic receipts without claiming byte access or image/PDF inspection. Actual content-dependent stages/profiles remain unsupported and must return a typed refusal; no real model or fallback is invoked. Missing/unready descriptors cannot be treated as successful metadata.

## Owned changes after go

| Owner | Files / change |
| --- | --- |
| T06 contracts | `contracts/src/processing.ts`: additive V2 input/envelope/proposal unions, typed provenance and safe unavailable-input projection |
| T06 media consumer | New `processing/media.ts`: owning API adapter, subject closure, exact retained binding verification and shared typed currency result |
| T06 command paths | `commands.ts`, `answers.ts`, `continuations.ts`, `jobs.ts`, `attempts.ts`: pre-reserve all handles, pass exact closure, pin immediately after command insertion |
| T06 authority/read paths | `model.ts`, `authority.ts`, `runner.ts`, `messages.ts`, `read.ts`, `retained.ts`: version compatibility, media currency, complete provenance seals and truthful stale lane settlement |
| T06 grants/tests | Processing provisioning consumes owning narrow media read/command-pin helpers; runner gets read/verify only, with no pin manufacturing, decoder, upload, approval or apply capability |
| Coordinator | Owning read/retained-command media wrappers and grants, shared capture seam where needed, main/App/Batch, shared exports/generation/manifests and actual merge resolution |
| T06 UI/docs | Relevant provenance/blocker presentation, fixture-only labels, architecture and comprehensive final handover |

## Independent adverse proof

Under a later allocated isolated PG/process window, cover manual-only exact-empty bindings and media-only input; configured/unconfigured web BlobStore with real DB descriptors; relevant pending/unreadable media; over-capacity closure and complete rollback. Reuse deterministic owned artifacts and decoder receipts only when needed.

Verify lot plus linked-Part/batch evidence inclusion, unrelated-lot exclusion, relinking, new versions and attachment-choice changes. Each relevant change invalidates old output/question currency without replacing human quantity; every accepted source must bind the exact staged note/version/digest. Test wrong batch/version/evidence/hash, changed sealed provenance, missing/corrupt command bindings, duplicate exact result adoption and changed-payload conflict.

Exercise union/per-closure digest order, zero-version sentinel lifetime, savepoint rollback, wrong backend/transaction/command actor/context and no late lock acquisition. Include a negative control that omits pinning or expands scope and fails through the owning authority seam, rather than checking helper call order.

An actual deterministic child must emit a stale nonterminal proposal after relevant media becomes pending or changes, then remain alive and keep its lane. Read models must retain history and report noncurrent input plus occupancy until a terminal or reaped interruption. A later fresh attempt must retain the human quantity. Re-run answer COMMIT-ACK adoption, continuation atomicity, restart, cancellation and existing exact-byte legacy cases. Browser checks and whole-feature review remain gated on the integrated head; no live-model test is part of this plan.
