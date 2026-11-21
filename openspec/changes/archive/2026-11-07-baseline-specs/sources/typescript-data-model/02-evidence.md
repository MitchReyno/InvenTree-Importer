# 2. Evidence, facts and media

[Model index](README.md) · All version/candidate rows below are immutable unless explicitly marked current state.

## Evidence catalogue

| Table | Columns beyond shared conventions | Keys, constraints and semantics |
| --- | --- | --- |
| `blob` | `digest UNIQUE`, `byte_size bigint`, `storage_key text UNIQUE`, `detected_type text`, `created_at`, `verified_at` | Row means verified durable bytes exist; content-addressed private storage. No arbitrary absolute paths, public URLs or credential-bearing metadata. Later integrity failure blocks consumption without rewriting historical digest |
| `upload` | `batch_id`, `created_by`, `state text`, `declared_size?`, `received_size`, `staging_key`, `failure_code?`, `expires_at` | Mutable transfer bookkeeping: receiving/failed/published/expired; published includes `blob_id`. One failure does not discard other evidence. Not a retained-evidence receipt |
| `evidence` | `batch_id`, `kind text`, `current_version_id?`, `revision`, `removed_at?` | Stable logical source; kind photo/document/note/order_reference/web_source. Current pointer and all version changes are same-batch checked |
| `evidence_version` | `batch_id`, `evidence_id`, `version bigint`, `blob_id?`, `manual_content jsonb?`, `original_filename?`, `source_url?`, `captured_at?`, `metadata jsonb`, `created_by?`, `producer_attempt_id?` | `UNIQUE(evidence_id,version)`, `(batch_id,evidence_id,id)`. Exactly one payload: immutable blob or schema-validated manual content. Exactly one producer: human or job attempt. Native files retain original bytes; a note correction creates another version |
| `source_capture` | `batch_id`, `evidence_version_id UNIQUE`, `requested_url`, `final_url`, `retrieved_at`, `response_metadata jsonb`, `original_blob_id`, `safe_excerpt_blob_id?`, `capture_tool_version`, `status text` | Retained web receipt bound to evidence version; distinguish successful/partial/failed capture. URL never substitutes for retained bytes. Safe excerpt is a derivative, not original content |
| `evidence_group` | `batch_id`, `label text`, `instructions text`, `revision`, `retired_at?` | Organizational hint only; changes invalidate jobs that actually depended on it |
| `evidence_group_member` | `batch_id`, `group_id`, `evidence_id`, `position integer` | PK `(group_id,evidence_id)`, same-batch FKs; ordering is presentation, not lot/source identity |
| `evidence_link` | `batch_id`, `subject_id`, `evidence_version_id`, `relation text`, `locator jsonb`, `revision`, `removed_at?` | Exact version/subject with page/region/text locator; no inference that one photo equals one lot. Locator schema validates page number and source-frame bounds; full-source locator is explicit |

Add a no-photo batch by creating note evidence and its first version, not an empty fake file. Order references, dates and handwritten claims remain user-provided evidence until verified. URL captures use a broker with SSRF/redirect/size limits; do not persist authorization headers, browser cookies or unsafe executable source HTML in public DTOs.

```diagram
local file → upload → durable verified blob → evidence version → evidence
                                                   │              current pointer
                          page/region link ─────────┘
                                  │
                               lot / Part

original web bytes → source_capture → safe excerpt / retained citation
```

File publication and PostgreSQL are not one transaction: write/verify/fsync bytes, atomically publish where supported, then commit blob/version/current pointer and an event. A crash can leave an orphan, never a truthful retained receipt without durable bytes. Cleanup takes the same digest-level publication/GC lock, checks live references in a transaction and deletes only aged positively unreferenced blobs. A pending publisher cannot race GC into creating a dangling ready row. No manual refcount is authoritative; references are traversed through typed FKs and manifests.

## Observations, interpretations and selected values

| Table | Columns beyond shared conventions | Keys, constraints and semantics |
| --- | --- | --- |
| `fact_candidate` | `batch_id`, `subject_id`, `field_key text`, `value_schema text`, `value jsonb`, `kind text`, `input_snapshot_id?`, `producer_attempt_id?`, `created_by?`, `supersedes_id?`, `explanation text` | Immutable observation/interpretation/human assertion. Typed value distinguishes unknown/invalid/cleared/value. Human versus attempt producer is exclusive. Supersession preserves old candidate; require same subject/field and no cycle |
| `candidate_source` | `batch_id`, `candidate_id`, `evidence_version_id`, `locator jsonb`, `support text` | Many sources per candidate, many candidates per source; composite PK includes a stable locator digest. `support` supports/conflicts/context; no silent consensus based on source count |
| `field_selection` | `batch_id`, `subject_id`, `field_key text`, `current_revision_id`, `revision` | Current head; `UNIQUE(subject_id,field_key)`. FK to the exact same selection's revision; no direct value column to diverge from history |
| `field_selection_revision` | `batch_id`, `selection_id`, `version bigint`, `mode text`, `candidate_id?`, `human_value jsonb?`, `created_by`, `reason text?` | `UNIQUE(selection_id,version)`. Modes unset/inherit/human/accepted_candidate; candidate and human payloads exclusive and required only for their modes. Candidate must have same subject/field via composite FK/command validation |
| `batch_default_revision` | `batch_id`, `field_key text`, `version bigint`, `value jsonb`, `created_by`, `reason?` | `UNIQUE(batch_id,field_key,version)`. Immutable default history; supported fields only |
| `batch_default` | `batch_id`, `field_key`, `current_revision_id`, `revision` | PK `(batch_id,field_key)`; FK to exact batch/field revision. Changes affect inheriting selections only |

The field registry is **versioned code/configuration**, not a user-editable universal EAV platform. It defines allowed subject kinds, types, units, requiredness, clear/unknown rules, inheritance and approval impact. Examples: `part.resistance`, `part.manufacturer`, `lot.quantity`, `lot.location`, `lot.purchase_date`. Cross-field validation belongs to the domain command. `JSONB` alone cannot validate a resistance unit or distinguish an estimated quantity from a counted one.

Selected human values include a provenance note or generated immutable manual evidence where the field requires justification. The UI may explicitly select the human count rather than the observed packet label; both remain inspectable. Accepted candidates bind a particular immutable candidate, not “latest automatic value”. `inherit` resolves the current default at read time; preparation freezes the actual default revision/value. Unset, explicitly cleared and explicitly unknown differ. Clearing an override back to inheritance is a separate command.

```diagram
observed label: approx. 20 ──► candidate c1 ─┐
human count: 17 ─────────────► candidate c2 ─┼─► selection revision: accept c2
provider estimate: 18 ───────► candidate c3 ─┘                │
                                                      frozen plan: 17
```

Reruns add candidates and may supersede automatic recommendations, never silently replace human selections. Removing/rejecting source evidence first invalidates affected selected candidates/reviews; approved snapshots and source bytes remain pinned. A source rejection is an attributed issue resolution on that evidence relationship, not physical deletion of its past influence.

## Media catalogue

| Table | Columns beyond shared conventions | Keys, constraints and semantics |
| --- | --- | --- |
| `media_recipe` | `batch_id`, `evidence_version_id`, `recipe_version bigint`, `normalized_width integer`, `normalized_height integer`, `orientation_transform jsonb`, `crop jsonb`, `quarter_turns smallint`, `encoding jsonb`, `tool_version text`, `created_by?`, `producer_attempt_id?`, `recipe_digest` | Immutable sibling/versioned recipe. Source must be blob-backed image/PDF page, with explicit page when needed. Positive dimensions; crop integer bounds inside orientation-normalized source, turns 0–3; server schema validates transforms |
| `media_derivative` | `batch_id`, `recipe_id`, `blob_id`, `pixel_width`, `pixel_height`, `producer_attempt_id`, `content_kind text` | Immutable successful output; exact output bytes/dimensions. Kind documentary/enhanced/generated. Only documentary crop/rotation is in initial supported attachment scope |
| `media_selection` | `batch_id`, `subject_id`, `slot text`, `derivative_id?`, `mode text`, `revision`, `selected_by` | `UNIQUE(subject_id,slot)` for current chosen destination: Part image or named lot attachment. Mode selected/declined/unset; derivative required only for selected. Preparation freezes choice; historical plan contains its full selection, so no approved pointer depends on later edits |

Store raw original/EXIF privately. Normalize orientation before applying source-pixel crop, then explicit quarter-turn rotation and recorded encoder settings. Preview and server must share this coordinate contract; future library versions need not reproduce byte-identical output, so retain selected output bytes. A request for another version creates a new recipe. Media destined for a shared Part affects every dependent lot review; a lot attachment affects only that lot.

```diagram
original blob → exact evidence version → recipe → derivative blob
                                                      │
                                  media_selection ────┘
                                        │
                          shared Part OR specific lot destination
                                        │
                              frozen plan_artifact reference
```

No automatic primary-image replacement is authorized simply by selecting a derivative. Preparation must expose whether the supported action creates/attaches/adds a missing image; unsupported replacement is a blocking issue. Approved artifact destinations never change during selected repair. Archived/current media pointers are not the source of recovery authority.
