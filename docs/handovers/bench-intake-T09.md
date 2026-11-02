# T09 — supported inventory effects and selected recovery

Status: prospective owner plan, written 2026-11-02 before implementation. Base: merged `interactive-app` at `e1a9686c80d8024ce946c893e2948cc9a59c7cc2`. Owner: Codex GPT-6. No Jira ticket is linked. Independent review and hosted CI are future gates.

## Scope and authority

Deliver the approved T09 slice from [the implementation plan](../bench-intake/08-implementation-plan.md): explicit create-or-reuse Part choices; existing mapped category/parameter/company relationships and tags; selected retained media destinations; a tested capability manifest; original-run selected assessment and repair; useful known Part outputs even when dependent work fails. Preserve exact approved bytes, source/contribution identity, physical owner/witness gates and cumulative history.

No taxonomy creation, purchase-order booking, arbitrary overwrites, primary-image replacement, live model calls, real-target mutation, identity redesign, service restart, main merge or deployment. All HTTP mutations use owned loopback fakes. Tests inject settings and never load the original repository environment. Actual InvenTree mutation compatibility remains unqualified.

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

Mitch explicitly answered the coordinator's tag scope question: **require an existing-only tag API first**. Existing InvenTree string-tag writes can implicitly create taxonomy. T09 therefore keeps nonempty requested tags typed-blocked while a separate owner supplies the prerequisite; this is not permission to defer tags or declare T09 complete. No unmerged prerequisite source is consumed.

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
