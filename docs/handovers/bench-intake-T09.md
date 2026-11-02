# T09 — supported inventory effects and selected recovery

Status: prospective owner plan, written 2026-11-02 before implementation. Base: merged `interactive-app` at `e1a9686c80d8024ce946c893e2948cc9a59c7cc2`. Owner: Codex GPT-6. No Jira ticket is linked. Independent review and hosted CI are future gates.

## Scope and authority

Deliver the approved T09 slice from [the implementation plan](../bench-intake/08-implementation-plan.md): explicit create-or-reuse Part choices; existing mapped category/parameter/company relationships and tags; selected retained media destinations; a tested capability manifest; original-run selected assessment and repair; useful known Part outputs even when dependent work fails. Preserve exact approved bytes, source/contribution identity, physical owner/witness gates and cumulative history.

No category/template/company creation, purchase-order booking, arbitrary overwrites, primary-image replacement, live model calls, real-target mutation, identity redesign, service restart, main merge or deployment. All HTTP mutations use owned loopback fakes. Tests inject settings and never load the original repository environment. Actual InvenTree mutation compatibility remains unqualified.

## Current boundaries and affected paths

The merged executor retains `bench-stock-plan/1` and `bench-media-plan/1`, with separate immutable stock and attachment journals. Stock operations currently require an existing Part PK. Capture's Part choice is an observed existing reference. Manual preparation requires complete existing Part/location reads; cumulative approved contribution history prevents replacement stock even after consumption/deletion. Attachment verification and selected repair already reacquire the original source guard.

Task ownership: `intake-server/src/execution/`, `src/review/`, `src/inventory/`, necessary capture/media public seams, matching tests and owning architectures; frontend capture, approval, results and recovery components/tests. Proposed additive task schema module and migration require coordinator acknowledgment first. Existing shared contracts index, generated registration/clients, root manifests/lock/CI/main wiring remain coordinator-reserved pending bounded handoff. Migrations 0008/0009 are immutable; proposed next allocation is 0010.

Consumers must use public capture/media/executor seams. Do not query sibling media or Processing SQL. Preserve retired-lot currentness and V3 admitted-source currentness together. Carry T08's retired-media error wording/regressions and retired-set memo comment when touching those paths.

## Proposed interfaces and retained authority

Propose an additive `owned-fake-effects/1` capability and `bench-effects-plan/1` executor version. Old plan bytes and decoders retain their exact meaning. A new explicit Part selection carries either an existing observed reference or a create specification with name, existing category, mapped parameters, existing manufacturer/supplier relationships and tags. Distinguish logical Part operation identity from remote PK. Selected lots bind the shared Part output by logical key; later rounds bind a prior attributable Part output plus fresh read, never infer absence from current projections.

Retain generic supported-effect operations, dependencies, exact request intents/results/effects/assessments and selections alongside the existing stock authority. A malformed create response retains every trustworthy PK; explicit known-output verification can establish usable output without erasing the original unknown receipt. An unattributed unknown create remains blocked and cannot be retried through lookup. A dependent failure does not hide confirmed Part outputs. Selected recovery binds original approval/run/operation, current run revision/cancellation version and the same source guard. New bytes or destinations require fresh review/preparation/approval.

The concrete proposal, final schema names, migration allocation and bounded shared-file ownership will be recorded after coordinator acknowledgment. This plan is not permission to edit reserved files.

## Alternatives and packages

Keep the qualified Fastify/TypeBox/AJV, PostgreSQL/pg/Drizzle, canonical bytes, core HTTP and supervised process stack. No new package is proposed. Maintained framework validation already owns schemas; packages cannot establish original-run attribution, source history, exact immutable bytes or permission to repeat an uncertain create.

Rejected: rewriting stock/media plans in place (changes retained authority); replacing existing journals with a generic engine (unnecessary qualified-boundary churn); treating a barcode/name match as ownership (cannot prove an unknown create); retrying failed HTTP statuses (status is not no-effect proof); offering generic overwrite endpoints (outside scope). Add a bounded versioned effects journal rather than widening transport to arbitrary requests.

## Implementation sequence

1. Finish reading owning code/design and live state; record and obtain acknowledgment for exact public schema/file/migration changes.
2. Add versioned pure effects plan validation, capability manifest, explicit capture selections and immutable migration/index authority; test incompatible/unsupported effect rejection.
3. Integrate preparation read intents, exact preview/dependency scope, shared Part reservation and later-round known-output binding.
4. Implement ordered effect handlers under existing physical ownership/witness/request checkpoint protocol. Publish known outputs separately from dependent-operation certainty.
5. Add selected original-run assessment/repair and UI with pinned payload/key/revision semantics. Preserve blocked outcomes honestly.
6. Extend the persistent fake and existing public HTTP/PG/process journeys; native browser verification with an owned fixture under leases.
7. Reconcile architecture/docs with actual observations, run qualified checks, commit/push and open a substantial ready PR to `interactive-app` with no reviewers. Coordinator supplies fresh exact-head independent review and handles merge gates; owner never merges.

## Discriminating verification

Use atomic coordinator leases before PG/Docker/process/native fixtures and browser use. Isolate randomized owned databases/roles; never restart shared PG or touch retained services/data. Rebuild decoder/probe images whenever copied source inputs change.

- Pure and contract checks: exact old/new plan round trips; unknown fields/kinds, duplicate operations, missing/cyclic/output-incompatible dependencies, unsupported destinations and malformed mapped values refuse before reservation/send.
- HTTP/PG: one shared new Part serves two distinct lots; category/parameters/company relationships/tags and selected attachments are exact approved operations; incomplete catalogue reads block publication; foreign observations and cross-run/approval selections refuse.
- Fault/process: confirmed Part plus dependent no-effect failure, restart, selected repair and later round produce one Part and one stock per original contribution. Independently count persisted wire requests and remote rows. Malformed attributed PK is retained and explicit verification controls usability; unattributed unknown create blocks siblings/recovery/later round. No retries after lost acknowledgment.
- Recovery: stale run revision, changed cancellation, wrong approval, old selection, occupied same-source guard and invalidated continuity refuse. Reacquire original source after a later settled round. Consumed/deleted historical stock never authorizes replacement. Verification adds receipts and does not rewrite original effects/plans.
- Browser: explicit create/reuse and mapping selection; exact preview; known Part with dependent failure; restart/selected repair/later-round results; narrow and desktop layouts, keyboard and conflict/uncertain payload retention. Record actual native observations separately from injected fixture tests.
- Negative controls: temporarily remove representative attribution/source/recovery gates, demonstrate targeted regressions fail, restore and rerun. Retain failures/skips in this record.

## Evidence and limitations

No implementation or task test has run yet. The initial live state script failed at the sandboxed uv cache; rerun requested host execution using existing cache. Code intelligence tools are unavailable, so those checks are skipped. Actual provider behavior, InvenTree mutation compatibility and final identity/access remain unqualified.

### Live-state refresh

The authorized host rerun of the pack state script succeeded on 2026-11-02 at 06:43 UTC using existing local caches. It confirmed T07/T08 merged, six passing selected T08 checks and three correct skips, remote T09 and `interactive-app` both at the stated base, and no open T09 PR or held task lease. The only open PR was the retained draft integration to main; no action was taken on it. The existing node_modules symlink appears untracked because the directory-only ignore pattern does not match a symlink; preserve it and never stage it.

### Coordinator decision before shared implementation

Coordinator ACKed the bounded shared contract/index/generator/generated-output changes, migration 0010 and matching owning schema/grants on 2026-11-02. No dependency/lock/CI change is authorized; main wiring remains reserved. The ACK requires typed observed mappings with category compatibility/company roles, discriminated new-Part preview identity, one checked canonical plan/index, every witness family, compatible source/subject/spec-bound known-output reuse and all trustworthy malformed-response PKs. Shared implementation begins only after reading that ACK. First small owned fixes carry the T08 retired-media refusal wording, actual HTTP revision/unlink regression and memo comment; their qualification is still pending.

## In-progress implementation and evidence

This section records development observations, not completed acceptance. The non-tag slice remains incomplete and unreviewed; no PR is open.

The first shared implementation adds typed create choices and observed category/template/category-parameter/company mappings, an additive effects plan/index/journal, original source/Part-subject attribution, checked known-output reuse and selected original-run inspection/repair. Part creation explicitly disables category-parameter copying; independent wire assertions require exactly name/category/copy=false, without initial stock/supplier/duplicate/image/tag side effects. Stock and attachment legacy bytes remain separate versions.

Historical decision, now superseded: Mitch initially answered the coordinator's tag scope question **require an existing-only tag API first**. Existing InvenTree string-tag writes can implicitly create taxonomy. T09 therefore keeps nonempty requested tags typed-blocked while a separate owner supplies the prerequisite; this is not permission to defer tags or declare T09 complete. No unmerged prerequisite source is consumed. **This existing-only decision was subsequently superseded by the native-tag decision below; it is retained only as chronology.**

### Setup and checks observed so far

The supplied root dependency symlink made pnpm 12.16.1 refuse task execution with `ERR_PNPM_UNSAFE_TASK_RUN_STATE_PATH`. With coordinator acknowledgment, only that symlink was removed and `pnpm install --offline --frozen-lockfile` created a worktree-local install: 582 cached packages reused, zero downloads, no lockfile/dependency change. A first unlink helper used `Path.readlink`, unavailable in the installed older Python; it did not unlink anything. The corrected `os.readlink` assertion/unlink succeeded and preserved the target install.

- `pnpm contracts:generate` and full `pnpm typecheck` passed at the intermediate implementation head. Later source changes require rerun.
- Four pure effects tests passed: exact new logical Part plan, impossible null/producer preview rejection, retaining valid PK siblings amid invalid IDs, and mapped context/role refusal.
- Sequential owned PG checks for executor, manual, retired-media and first effects journey passed 24/24, zero skips. Existing suites exercised real supervised children and owned HTTP. No real inventory was contacted.
- The first new effects journey independently observed one Part POST, exact `copy_category_parameters:false` body, dependent template-read failure, retained usable Part output, web/fake restart, selected parameter then stock continuation, and a later second lot using the same attributable Part with exactly two stock creates.
- The initial journey first exposed an empty-media reservation attempting a media decode-table read without media authority; absent media scope now skips that lock. A subsequent test used wrong expected approval/start statuses (201/202); assertions were corrected to the merged API's 200 contract. Both failures preceded the passing journey.
- The first five-case adverse run passed four and failed the multiple-output case because its fake fault had not been added; the missing controlled response was added and the set rerun. Results are pending here until reconciled.
- `pnpm format:readability` and `pnpm format` ran once; later added files still need final formatting/checks. Code intelligence remains unavailable/skipped.

### Primary API source research

The handler policy is grounded in the InvenTree `1.5.0` tagged upstream serializer/URL source and official `1.5.x` documentation, independently of fake mutation qualification. Sources are public upstream reads, never protected-target probes. Exact retrieved source hashes and final route/body evidence will be reconciled before publication.

- [Part serializer](https://github.com/inventree/InvenTree/blob/1.5.0/src/backend/InvenTree/part/serializers.py): explicit category, write-only create options and category-parameter copying. No nested initial-stock/supplier/duplicate/image effects are requested.
- [Common serializer](https://github.com/inventree/InvenTree/blob/1.5.0/src/backend/InvenTree/common/serializers.py) and [common API](https://github.com/inventree/InvenTree/blob/1.5.0/src/backend/InvenTree/common/api.py): generic `/api/parameter/`, `/api/parameter/template/` and `/api/attachment/`; parameter model/type/id/data semantics.
- [Core serializer](https://github.com/inventree/InvenTree/blob/1.5.0/src/backend/InvenTree/InvenTree/serializers.py): `ContentTypeField` serializes `app_label.model`; Part parameter requests/observations use exact `part.part`, not an assumed echoed short alias.
- [Company serializer](https://github.com/inventree/InvenTree/blob/1.5.0/src/backend/InvenTree/company/serializers.py): manufacturer Part and supplier Part relationships, MPN/SKU and manufacturer-part binding.
- [Official tags API documentation](https://docs.inventree.org/en/1.5.x/plugins/tags/): string-list POST/PATCH can create missing tags implicitly. Reading first cannot establish atomic existing-only assignment.

The inspected installed Python client is 0.13.5; its historical Part parameter/attachment paths are not authoritative for InvenTree 1.5.0. New category-parameter observations use the mapping row's category/template identity and a derived safe label, because that serializer has no generic name field.


### Current tag scope supersedes the earlier prerequisite

Mitch clarified: “Ohhh, no we should allow any tags, including tags which don't already exist”. Ordinary tag names and implicit native tag creation are now explicitly within T09. The earlier existing-only API/plugin prerequisite is superseded; no plugin is imported, enabled or deployed. Category/template/company creation stays excluded. The coordinator's corresponding implementation-plan amendment is retained with this task. Native tag request/preservation semantics are being resolved before implementation; current tag blocking in the unfinished code is temporary, not an accepted completed feature or deferred gate.

The owner proposed native tags only as initial fields of explicitly created Parts: `POST /api/part/?tags=true` with exact approved names plus category/name/copy=false. The pinned Part serializer's atomic create can apply initial tags before the new Part becomes visible; no later collection-replacement PATCH is proposed. Existing Part reuse remains read-only. The final supported capability and any remaining existing-Part append/concurrency limitation must be explicit before completion.

### Generic attachment model correction and current qualification

Tagged upstream common attachment validators use the model class's lower-case name (`part`), while generic Parameter uses `ContentTypeField` (`part.part`). The earlier proposed attachment spelling was corrected from primary source before wire qualification. Multipart file requests, metadata validation and tests use `part`; parameter requests retain `part.part`. The attachment storage model's `rename_attachment` records `attachments/<model_type>/<model_id>/<filename>`, grounding the narrow same-origin `/media/attachments/` read policy. Custom/signed/external storage is unsupported and fails closed.

The five focused effects adverse cases now pass, including the corrected multiple-output fake fault. The serialized manual-client union regression passes 1/1; focused frontend create/assessment cases pass 2/2. Additional exact-byte parser tests prove 100 valid returned IDs survive malformed/unsafe siblings, while evidence-only parsing cannot confirm an effect. Strict parser duplicate/reserved/depth/size guards and canonical rules remain unchanged. Source-current full qualification and Part-attachment HTTP/PG/process tests remain pending.

T09 released its first PG/process lease after exact fixture cleanup. Only retained preview PID60739 remained among the reserved ports. The coordinator has now offered the next safe window; acquisition still must be atomic before any new heavy tests or image build.

### Continuation housekeeping after the handover stop

The continuation owner verified the worktree was byte-identical to the stop snapshot before editing. The new files already follow the execution module's flat, prefix-named layout (`effects-*`, `part-attachment-*`), so no module was renamed.

`inventory/tags.ts` mixed tag-name policy with the Part identity read-receipt check. The check moved to `inventory/part-identity.ts`; review preparation and run reconstruction import it from there. The duplicated tag-name rule became one `validTagName` predicate with named name-length and tag-count limits. Refusal behaviour is unchanged.

The readability autofix and Prettier were applied to the new runtime and test TypeScript. Fixtures and migration 0010 keep their byte policy. Modified tracked files are not yet formatted. Afterwards, readability lint on the new files and contracts, server and frontend typechecks passed.

### Apply split and tag audit

`applySupportedEffects` mixed journal authorization, physical send, body materialization, catalogue preconditions and Part-attachment handling in one 700-line function. It now orchestrates named phases, matching the existing attachment apply split: `effects-journal` (intent/result/effect/assessment), `effects-request` (one intent, at most one send, checkpoint), `effects-body` (create payload and confirmed Part PK), `effects-preconditions` (catalogue reads before create), `effects-evidence` (attribution and confirmation), and `applyPartAttachmentEffect` in `part-attachment-apply`. Guard reads, cancel-version aggregates and the source-hold release stay explicit SQL.

Native tags belong to the new-Part create: `POST /api/part/?tags=true` and tagged GET of that instance. The leftover public `tag` effect kind was removed; contracts were regenerated and `contracts:check` is current. Extra observed tags still confirm; missing requested tags do not. Case-duplicate ASCII names refuse. Fast server tests pass 116/116. The five PG two-lot journeys still fail as they did on the pre-conversion snapshot; they need the next PG window.

### Supported-effects journeys and frozen Processing inputs

After the apply split and tagged Part URLs, all six `tests/pg/supported-effects.test.ts` journeys pass, including the shared Part, malformed and multiple attribution, catalogue-incomplete preparation, original-run repair and consumed or deleted stock. The earlier five failures were from that partial tag and Part-output work, not the Drizzle conversion.

Processing `/1`–`/3` inputs no longer embed newer catalogue observations or mapping fields. A create choice on the processing subject or its linked Part, and a `media-inputs/2` descriptor, fail with `unsupported_processing_input`. A currentness check treats that refusal as stale. An unrelated Part's create choice and a category observation do not change another subject's sealed input. Processing model, provenance and research-model tests pass 12/12. History, cancel, exact replay, stale-question ordering, retirement and V3 source admission were not re-run at PostgreSQL in this step.

### Checkpoint and focused qualification

Blank, control, overlong, excessive and missing tag names refuse in the plan and spec checks; `Ω` and `ω` stay distinct. The Part-attachment wire tests and the unconfigured-media plan refusal pass. An apply role can read the effects tables and cannot delete intents, insert operations or update effects. Processing history, lost answer acknowledgement, cancellation, stale questions, retirement of an unrelated lot, source-admission revocation and V3 continuations pass on PostgreSQL. The execution and Processing architecture notes now describe those boundaries. Decoder images, the full tier run, the browser fixture and independent review of the published head remain open.

## Independent review fixes

A fresh read-only review of `73b025d` against `interactive-app` `73ad9ff` (after merging the Drizzle query refactor) found no critical issue and confirmed the Part and stock authority. It raised two important and three minor findings, all fixed:

- Part attachments had no HTTP/PostgreSQL journey. Writing one exposed a real defect: migration 0010 widened the destination check but left `media_attachment_selection.subject_kind` fixed to `lot`, so selecting any Part attachment failed its capture-subject foreign key. Migration 0010 now ties `subject_kind` to `destination`, and `editMedia` writes `part` for a Part attachment. New journeys cover an incomplete attachment response held as unknown, selected verification confirming it without another upload, a selected stock resume, a restarted later round reusing the transfer (1 attachment, 1 Part and 2 stock POSTs; stored bytes match), and a missing prior attachment blocking the later round with `known_attachment_changed` and no upload.
- A Part attachment selected on an `owned-fake-media/1` deployment was silently dropped from the plan. Review and preparation now report `unsupported_part_attachment`.
- Several parameters could cite one category-parameter observation and bypass `parameter_category_incompatible`. Every citing parameter must now use that mapping's template.
- A schema-valid selection above 100 effects or 256 KiB of plan failed as an untyped 500. Preparation now returns a typed `effects_capacity` issue. It also checks the 10-lot and 10-Part plan limits defensively; the scope schema already caps a selection at 10 lots, so those could not be reached.
- A declined or cleared Part attachment moved the scope to `media-inputs/2`, permanently blocking Processing for linked lots. Only a selected Part attachment does so now; non-selected Part attachment rows are omitted from the manifest.

Earlier pending notes in this record about Part-attachment HTTP/PostgreSQL tests are superseded by these journeys. Process and browser coverage of Part attachments is still not added.

A second review of `18a3427` confirmed these fixes and asked for tighter comments and assertions (done in `67a89d2`). It also reported the 10-lot plan limit as unchecked; that limit is unreachable because the scope schema allows at most 10 lots, so the check added for it is defensive only. A third review of `67a89d2` found no code issue. The three new journeys need `INTAKE_MEDIA_DECODER_IMAGE`; they ran with it. Under the `pg-docker` lease on the shared PostgreSQL 17 service, with decoder and probe images rebuilt from `18a3427`, the PostgreSQL tier passed 98/98 and the process tier 32/32 on `18a3427`, with no skips. `tests/pg/supported-effects.test.ts` then passed 9/9 on the `67a89d2` content, which changes no source under `src/media`. The browser fixture was not run.

