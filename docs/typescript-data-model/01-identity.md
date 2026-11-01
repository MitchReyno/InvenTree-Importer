# 1. Identity and inventory context

[Model index](README.md)

## Conventions across the schema

Unless stated otherwise, `id` is an application-generated UUID primary key; timestamps are PostgreSQL `timestamptz` in UTC. Mutable rows have `revision bigint NOT NULL CHECK (revision > 0)`, `created_at`, `updated_at`; immutable rows have `created_at` and an attributed producer/actor. IDs and revisions are JSON strings in TypeScript/browser contracts: neither PostgreSQL `bigint` nor cursor values pass through JavaScript `number`. UUID ordering does not establish event/commit order.

Catalogue shorthand: `?` means nullable; every other listed column is required unless its conditional rule says otherwise. Unannotated `*_id`/actor/producer columns are UUID foreign keys, `*_at` is `timestamptz`, `*_digest` is the digest type, `*_key`/schema/build/version labels are bounded text, and documents/specs/payloads explicitly labelled JSONB are schema-validated JSONB. Numeric sequence/version counters are annotated bigint/integer; runtime/schema version strings are not numeric counters. Join tables with a declared composite PK do not also require the default UUID ID. Mutable summaries beside immutable payloads are writable only through their owning transition commands.

`digest` is exactly 32 bytes (`bytea`, length check); DTOs use 64 lowercase hexadecimal characters. Blob sizes/counters are nonnegative `bigint`. Exact quantities/money use decimal text at JSON boundaries and bounded PostgreSQL `numeric` for arithmetic. For the initial stock slice use at most 13 integer and 6 fractional digits, with validation **before** insertion into `numeric(19,6)` so PostgreSQL cannot silently round an invalid input. Currency is an explicitly validated ISO code; units are versioned supported codes. Calendar purchase dates use `date`, never a midnight timestamp. Every field has its own allowed sign/range/unit policy; zero quantity is not silently accepted as stock to create.

Text columns have application byte/length limits and SQL checks for critical keys. JSONB is a bounded, schema-versioned value, not arbitrary runtime metadata. Parsing rejects duplicate JSON keys, non-finite numbers, extra fields and invalid decimal lexemes before normalization; types alone are not validation. Immutable exact artifacts use retained bytes and a digest, not JSONB reserialization. No source-authored UUID, path or filename grants authority.

All batch-owned parents expose `UNIQUE(batch_id, id)`. Children carry `batch_id` and use **composite foreign keys** to each batch-owned parent, preventing cross-batch links even when UUIDs are globally unique. Target/continuity and run/plan relationships receive equivalent composite keys. FKs default to `RESTRICT`; archiving is not cascading deletion. Version rows are immutable by restricted database grants and explicit repository methods; a `CHECK` cannot enforce immutability against an update. Migration/admin access is outside that boundary.

## Owner, connection and configuration tables

| Table | Columns beyond conventions | Relationships, constraints and purpose |
| --- | --- | --- |
| `operator` | `auth_issuer text`, `auth_subject text`, `display_name text`, `disabled_at timestamptz?` | `UNIQUE(auth_issuer,auth_subject)`; stable verified InvenTree identity, not a username/email supplied by the browser. Retain attribution if disabled. One active owner initially, enforced by setup policy/partial unique singleton marker, not a multi-tenant design |
| `target` | `name text`, `normalized_base_url text`, `credential_ref text`, `current_context_id uuid?`, `revision` | One configured active target initially. Secret reference is server-private and points to deployment-managed encrypted secret material; never provider credentials or a browser field |
| `target_context` | `target_id`, `generation bigint`, `endpoint_snapshot text`, `continuity_evidence jsonb`, `capability_snapshot jsonb`, `context_digest`, `reviewed_by operator`, `reviewed_at`, `state text` | Immutable target binding; `UNIQUE(target_id,generation)` and `(target_id,id)`. States `qualified`, `blocked`; transitions use a new context or explicit qualification record, not rewriting prior approved bytes. Endpoint/PK equality is not identity proof |
| `configuration_revision` | `version bigint UNIQUE`, `mapping_document jsonb`, `policy_document jsonb`, `document_blob_id`, `digest`, `created_by` | Immutable category/parameter/unit/review mappings; exact document bytes retained. No secrets. Updates create new revisions, identify impacted drafts and invalidate affected preparation |
| `deployment_epoch` | `installation_id uuid`, `epoch bigint`, `state text`, `activated_by?`, `activated_at?`, `reason text` | Operational record, states `blocked`, `active`, `retired`; not sufficient alone to enable writes after restore. An external non-restored activation gate must agree |

Authentication protocol/session tables belong to the selected maintained library and are deliberately not reinvented here. Use InvenTree as the login authority through a supported, qualified integration, then issue revocable Bench Intake sessions with secure cookies, explicit expiry and no public registration. Validate issuer/client/redirect and protocol replay protections; bind the verified stable subject to the configured target, never by matching display name/email. InvenTree's documented OAuth2/OIDC identity-provider route is experimental/opt-in: installed-version support, identity claims, delegated API access and revocation behavior remain qualification gates, not implemented guarantees. Do not share Django session tables, accept user passwords or read InvenTree's database for authentication. Provider login tokens remain exclusively in the supported native runtime's credential store. Target secret rotation creates a new reference/version and records the operational change; it does not prove target continuity or silently rebind an old approval.

## Mandatory access qualification

On every initial application load, before returning any workspace data or enabling actions, the backend must verify the authenticated user's effective authority for **all operations supported by this Bench Intake release**, including reads, creates and selected media transfers. Maintain a versioned server-owned requirements manifest derived from the supported feature/endpoint set and the installed InvenTree API contract. Check both the user's actual permissions and the delegated token/client scopes; successful login, an owner allowlist or a broad token scope alone is insufficient. Do not require unrelated administrator/delete rights. No partially privileged workspace or service-account bypass is supported. Inventory requests must remain constrained by the acting user's authority; background work retains that actor binding rather than substituting a more privileged account.

If authenticated but underprivileged, return a blocking `access_denied` bootstrap result and show “Your InvenTree account does not have the permissions required to use Bench Intake,” listing safely identified missing capabilities and asking the user to contact their InvenTree administrator. Include retry and sign-out/account-switch actions, not a working capture/review interface. Missing/expired login requires sign-in; unreachable InvenTree, unsupported permission introspection or an incomplete check produces `access_unverified` with a retryable explanation, never a false claim that permission is missing. All unverified states fail closed. The pre-access response exposes no batch data, credentials or sensitive target details.

Initial qualification is a convenience gate, not enduring authorization. Recheck current effective authority before approval, background dispatch/resumption and each privileged inventory request; enforce owner/object/session authorization on every application endpoint and stream. Permission loss stops new dispatch/sends, preserves approvals/journal/source guards and settles already in-flight effects without pretending to roll them back. A later successful check does not itself authorize replay or recovery. Any diagnostic qualification record must bind actor, target/context, requirements version, observed permissions/scopes and check time; it is audit evidence, never an authorization grant. Determine exact permissions and reliable introspection against the deployed version without test mutations; if it cannot prove the required authority, block deployment/access rather than guess from a role name.

Changing target/context/configuration must not reinterpret previous outcomes. A draft may be explicitly rebound before preparation, clearing incompatible inventory choices and reviews. An approved run always retains its original target/context/configuration. A restored/replaced target is blocked until qualified; a new context cannot be used to evade an unresolved old source claim. Record the real continuity assessment, not a hash of `/server/info` promoted to a guaranteed instance ID.

## Batch and source identity

| Table | Columns beyond conventions | Relationships and constraints |
| --- | --- | --- |
| `source_namespace` | `namespace_key text UNIQUE`, `origin_kind text`, `external_reference text?`, `created_by` | Immutable original import source; `origin_kind` is `native_batch` or `explicit_legacy_mapping`. A note/order URL is evidence, not automatically a canonical source identity |
| `batch` | `title text`, `owner_id`, `source_id UNIQUE`, `target_id`, `target_context_id`, `configuration_id`, `revision`, `instructions text`, `archived_at?` | One native source per batch. Composite target/context FK; title/instructions are editable under revision checks. Ready/blocked/completed counts are derived, not authoritative `batch.status` |
| `subject` | `batch_id`, `kind text`, `revision`, `retired_at?` | Stable common parent for fact/review/job scope; kind is `lot` or `part`. `UNIQUE(batch_id,id,kind)` enables typed child references |
| `part_proposal` | `batch_id`, `subject_id PK`, `subject_kind` fixed `part`, `label text` | Typed extension of subject; composite FK to subject including kind. Describes the proposed component, not a remote Part row |
| `lot` | `batch_id`, `subject_id PK`, `subject_kind` fixed `lot`, `source_id`, `contribution_key text`, `part_subject_id?`, `disposition text`, `label text` | Typed subject FK; Part FK `(batch_id,part_subject_id)` to `part_proposal`; source must equal batch's source via composite FK. `UNIQUE(source_id,contribution_key)`. Disposition `included`, `deferred`, `excluded`, `retired`; not an execution outcome |
| `lot_lineage` | `batch_id`, `predecessor_lot_id`, `successor_lot_id`, `action text`, `created_by` | Composite PK `(predecessor_lot_id,successor_lot_id)`; same-batch typed lot FKs; no self-edge; `action` split/merge. Commands enforce acyclic lineage and unapproved predecessors |

Create a subject and its typed extension in one transaction; prohibit directly creating a naked subject through the application role. A deferred constraint trigger or the owning command must reject a committed parent without exactly one matching extension; choose/test this explicitly during DDL implementation. The subject parent avoids unconstrained `(entity_type, entity_id)` references; it is not a general entity framework. Batch-level records simply reference `batch_id`.

```diagram
source_namespace ──1:1── batch ──1:N── subject
       │                              ├─ kind=part ─► part_proposal
       └─ contribution key ───────────└─ kind=lot ──► lot
                                                        │
                                              many lots : one Part
```

The first lot's key is assigned once, not regenerated after correcting a count, reordering the table or approving a later round. A stock import barcode is a versioned deterministic encoding of the original source/contribution, distinct from supplier barcodes. Retain its frozen value in the executable operation; do not let a new executor build change historical encoding. Cross-language compatibility requires explicit vectors and an engine-exclusion gate before touching an already-used source.

Before approval, changing evidence grouping never changes lot identity. An explicit unapproved split retires the old physical lot and assigns new keys with lineage; merging requires confirmation that the rows describe one physical contribution. Once selected into an approval, lot/source/contribution are immutable, including during partial recovery. Imported stock split/merge or quantity adjustment is a separately designed feature, not a lineage edit.

## Inventory observations, not a second inventory database

| Table | Columns beyond conventions | Meaning |
| --- | --- | --- |
| `inventory_observation` | `batch_id`, `target_id`, `target_context_id`, `model text`, `remote_pk text?`, `identity_fields jsonb`, `observed_at`, `read_outcome text`, `input_digest`, `expires_at?` | Immutable bounded read evidence. Model is an allowlisted InvenTree type; PK is a validated positive integer string. Scope to target/context. `read_outcome` distinguishes found/absent/incomplete; only found permits and requires a PK; absence needs a complete successful query |
| `inventory_choice` | `batch_id`, `subject_id`, `purpose text`, `observation_id?`, `mode text`, `revision`, `chosen_by` | Current human selection `reuse`, `create`, `unresolved`; reuse requires matching found observation and correct model/context. Purpose distinguishes Part reuse, manufacturer/supplier relationship, location and possible duplicate stock disposition |

Use a subject/purpose unique key for current choices; immutable preparation captures chosen observations and reasoning. Revalidate remote identity/preconditions at execution. An old found row is not a forever-valid target reference. A same-looking record after an unknown POST is **not** ownership evidence. Remote receipt/Company/parameter models need not all become local first-class tables; typed observations plus approved operations carry the supported slice.

Batch/source retirement and target archival preserve all references. No automatic import or conversion of Python canonical state is included. A new TypeScript database does not mean previously uncertain remote effects have vanished.
