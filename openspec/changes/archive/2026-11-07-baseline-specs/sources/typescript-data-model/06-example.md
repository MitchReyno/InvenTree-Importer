# 6. Worked example, TypeScript values and acceptance

[Model index](README.md) · Fictional records illustrating the proposed schema, not new inference or an executed test.

## Two packets, one shared Part, two approval rounds

| Step | Persisted records / expected meaning |
| --- | --- |
| Capture | Batch `b1`, source `s1`, lot `a` contribution `packet-a`, lot `b` contribution `packet-b`, shared Part subject `p1`. Front/back photos and a receipt have separate evidence/version/blob rows; a note-only start would also be valid |
| Observe | Receipt says two packets; label says approximately 20 in opened packet B. Assertions retain page/region provenance and the difference between label quantity and physical count |
| Ask | Selected research attempt `j1-a1`, input `i1`, publishes question `q1` for B's quantity, then finishes. Job is waiting_for_user; the provider lane is available to other jobs |
| Answer | Owner supplies counted quantity `20`. One transaction inserts answer, human selection revision, immutable input `i2`, attempt `j1-a2`, command/outbox/event. Input `i1` is unchanged; late `j1-a1` proposal is stale |
| Select | A quantity `10`, B quantity `20`; both link to `p1`. Location A inherits Drawer 4; B explicitly overrides to Drawer 8. Changing default to Drawer 5 invalidates A only for that dependency |
| Review | Current reviews bind exact lot/Part facts, chosen images, inventory choices and warning dispositions. A Part image change would invalidate both; B count change would not invalidate A |
| Prepare A | Plan `pa` selects only A. Contains one Part resolution/create, A stock/barcode and packet A attachment. B stock/media does not enter dependency closure. Plan artifact pins exact selected bytes |
| Approve A | Round 1 approval, canonical run `ra`, initial operation rows, source guard reservation and apply outbox commit together. Repeat HTTP submission or workflow delivery adopts the same immutable authority |
| Apply A | Confirmed Part output `Part/93` and stock `StockItem/421` are checkpointed. Attachment fails with independent proof that no send occurred; retain failure separately from stock success |
| Restart | Original `ra`/requests/effects remain. Rebuild Results without sending stock again. Selected attachment repair reacquires the original run, uses original bytes/destination, and records verification receipt |
| Prepare B | Round 2 plan binds original contribution `packet-b`, fresh target identity checks and known `Part/93` attribution from A. It plans a separate stock B quantity 20 and packet B attachment |
| Final | One Part, two original stock contributions 10/20, two packet attachments, distinct barcodes, both approval rounds and every request/recovery attempt retained. No inferred receipt upload if it was not selected |

```diagram
source s1
  ├─ packet-a ─► plan pa ─► approval 1 / run ra ─► StockItem/421 (10)
  │                    └─ Part/93 ────────────────────┐
  └─ packet-b ─► plan pb ─► approval 2 / run rb ──────┼─► stock B (20)
                                                     │
                              shared identity, separate physical contributions
```

The adversarial branch changes the result: if A's stock POST response is lost without trustworthy attribution, the request is unknown and the source guard remains blocked. Even if a later query returns a matching-looking stock row—or nothing—neither generic retry nor round B is authorized. Preserve that branch rather than manufacturing the happy-path final counts.

## Representative TypeScript boundary types

These are small public/domain value contracts, **not ORM rows**. UUID/digest/decimal/date formats and extra-field rejection require runtime schemas; the aliases alone provide no validation. Domain integers and decimal quantities cross JSON as strings; image crop pixel coordinates are bounded safe integers. Runtime schemas enforce subject/field-specific unit/sign/precision restrictions and prohibit `invalid` candidates from becoming executable values.

```typescript
type UUID = string;
type Digest = string;
type Revision = string;
type DecimalText = string;

type FactValue =
  | { state: "value"; kind: "text"; text: string }
  | { state: "value"; kind: "boolean"; value: boolean }
  | { state: "value"; kind: "quantity"; amount: DecimalText;
      unit: string; basis: "counted" | "labelled" | "estimated" }
  | { state: "value"; kind: "money"; amount: DecimalText; currency: string }
  | { state: "value"; kind: "date"; date: string }
  | { state: "value"; kind: "inventory_reference";
      observationId: UUID }
  | { state: "unknown"; reason: string }
  | { state: "cleared"; reason: string }
  | { state: "invalid"; rawText: string; code: string };

type FieldSelection =
  | { mode: "unset" }
  | { mode: "inherit" }
  | { mode: "human"; value: FactValue; reason?: string }
  | { mode: "accepted_candidate"; candidateId: UUID };

type SourceLocator =
  | { kind: "whole" }
  | { kind: "image_region"; page?: number;
      frame: "orientation_normalized";
      x: number; y: number; width: number; height: number }
  | { kind: "document_page"; page: number }
  | { kind: "text_range"; start: number; end: number;
      unit: "unicode_code_points" };

type Dependency =
  | { kind: "selection"; selectionRevisionId: UUID }
  | { kind: "default"; defaultRevisionId: UUID }
  | { kind: "evidence"; evidenceVersionId: UUID; digest?: Digest }
  | { kind: "mutable_relation"; relation: "link" | "group" |
      "inventory_choice" | "media_selection"; id: UUID; revision: Revision }
  | { kind: "answer"; answerId: UUID }
  | { kind: "configuration"; configurationId: UUID; digest: Digest };

type Outcome = {
  runId: UUID;
  operationKey: string;
  state: "pending" | "running" | "succeeded" | "failed" |
    "blocked" | "review_required" | "cancelled";
  effectCertainty: "none" | "confirmed" | "unknown" | "mixed";
  supportedActions: Array<{
    kind: "resume_pending" | "verify_known_output" |
      "verify_attachment" | "repair_supported_effect";
    expectedRunRevision: Revision;
  }>;
};
```

Runtime instructions/profile identity and exact artifact bytes are required top-level input-manifest fields in addition to dependency entries. Text-range offsets refer to the exact retained text-version's Unicode code points, not UTF-16 offsets or HTML positions; the UI maps them explicitly. A browser can display an invalid observed value while the application rejects its use as a selected executable count. Estimated quantities need explicit review policy; do not silently convert their basis to counted.

## Invariant and acceptance matrix

These are **required future tests**, not checks passed by this documentation task. DDL/ORM integration tests should exercise real PostgreSQL constraints and transactions; execution tests need the real HTTP adapter, persistent fake, fresh processes and owned state. Existing Python/shared cases provide scenarios, not automatic TypeScript coverage.

| Competing wrong implementation | Input where it differs | Required assertion |
| --- | --- | --- |
| Login means sufficient access | Valid InvenTree identity missing one required permission, or valid roles but insufficient delegated scope | Bootstrap blocks before workspace data/actions; safe missing-capability explanation, retry and sign-out |
| Failed introspection means missing permission | InvenTree unavailable or permission response incomplete | Distinct retryable access-unverified state; no workspace or privilege bypass |
| Initial permission check lasts forever | Revoke permission after load/approval, before queued apply or next mutation | No new privileged send; retained approval/guard/journal and any in-flight uncertainty survive; restoration does not trigger replay |
| One image means one lot | One image with three components plus front/back of one packet | Explicit many-to-many evidence assignments; stable separate physical lots |
| Cross-batch UUID link accepted | B1 selection referencing B2 candidate/source/plan | Composite FK or command rejects, no partial update |
| Same-batch means correct parent | Two jobs in B1; select the other's attempt or attach its message to a proposal/question | Exact job/attempt/message composite FKs reject the wrong binding |
| Numeric coercion rounds source | More than six fractional digits; huge integer/revision; non-finite/duplicate-key JSON | Reject invalid input before DB coercion; exact strings survive |
| Null means inherit | Explicit clear versus inherit versus unknown | Different value/provenance/invalidation; only inherit follows default |
| Any default edit invalidates everything | A inherits, B overrides | A changes/stales, B unchanged |
| Last result wins | Old attempt arrives after human correction/new attempt | Old result retained stale, human/current values preserved |
| Waiting occupies worker | First lot asks, second independent job queued | Question durable; first command ends; second executes |
| Stale answer accepted | Superseded question revision or wrong actor | No answer/current mutation/continuation committed |
| Same workflow ID sufficient | Same ID with changed args/version/queue | Durable conflict, no ACK; other outbox work progresses |
| Shared media does not affect review | Change only shared Part image | Both dependent lot reviews stale, unrelated lot valid |
| Dependency closure imports unselected stock | A/B share Part; approve A only | One shared prerequisite, no B stock/media requests |
| Duplicate approval creates two runs | Concurrent different keys, same preparation | One approval/run, payload-matched adoption or explicit conflict |
| New preparation permits replenishing old contribution | A settled, original stock consumed/deleted; select A in another preparation | Retain original attribution or review-required; no second stock POST |
| Safe no-effect operation is recreated in new round | Original approved A create never sent, then a different preparation selects A | Original-run supported recovery only, no replacement stock operation |
| SQL transaction retries a remote POST | Simulated commit/connection failure around actual send | One stable intent; no implicit resend; uncertainty retained where needed |
| Lost output means rerun | Kill after remote effect/journal checkpoint before browser event | Recover original effect, no duplicate create |
| Lost response can be matched by payload | Target accepts stock then drops reply; later row deleted | Unknown retained; no second stock POST or next round |
| Lock expiry means old process stopped | Writer loses DB connection while child/HTTP survives | No new writer until proven reaped; in-flight effect settled/unknown |
| Failed attachment means failed stock | Stock confirmed then safe pre-send upload failure | Stock retained, selected repair only transfers original attachment |
| Missing confirmed attachment permits reupload | Delete remote after confirmed transfer | No automatic replacement; retain known effect and review |
| Cursor allocation order equals commit order | Delay first writer after allocation | Later visible cursor cannot skip unseen committed event; stream lock test |
| Blob GC races publication | Publisher/collector interleaving same digest | No ready reference to removed bytes, only positively orphaned data collected |
| Restore absence proves no write | Backup then remote create then restore | External apply gate blocks replay despite empty restored run history |
| New engine namespace clears uncertainty | Legacy uncertain source, new TS database/context | Transition blocked pending explicit assessment; no live coexistence claim |

## Design choices still to qualify

The data model recommends PostgreSQL and a new TypeScript journal. Before implementation, choose compatible server/schema/ORM/auth/job libraries and validate their actual unknown-field, numeric, transaction, lock and version behaviors. Decide first supported host/provider route, review policies for estimates/unknown manufacturer/missing sources, exact target effect scope and retention obligations. These choices do not require duplicating all legacy importer features. No live-write pilot follows automatically from this document.
