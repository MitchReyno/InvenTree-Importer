# Bench Intake client integration

## Prospective plan

The coordinator delegated only generated contract tooling/artifacts, client facades and focused client tests on 2026-11-01. This record precedes implementation. The approved implementation plan and owning T05/T06 handovers govern feature authority; the original inventory remains strictly read-only. Other owners retain DTO modules, backend routes, UI and runtime registration. Preserve all their changes.

Use the existing openapi-typescript 7.13 / openapi-fetch 0.17 public APIs and isolated TypeScript 5.9 generator, keeping application TypeScript 6. No dependency change is expected. The official Node API documents a binary-format transform to a Blob AST type ([official Blob example](https://openapi-ts.dev/node#example-blob-types)); inspect the installed API before adoption. Preserve the existing injected URL/RequestInit seam, AJV validation, CSRF, deadlines, redirect refusal and single-send behavior.

Extract the concrete shared typed-client constructor and idempotency headers into a cohesive runtime module. Add only the owning feature facade and implemented routes in each tree. Generate every path placeholder declaration. T05 advertises private browser binary resources explicitly; JSON policy generation may omit only validated read-only binary resources. Its upload remains raw octet-stream Blob with exact revision and percent-encoded label headers and a JSON receipt; refuse empty/oversized sources before transport using the shared limit. T06 uses exact start/cancellation/answer schemas and truthful retained Activity. Do not copy unpublished sibling schemas.

Verify generated drift, compile-only positive/adverse body and path cases, runtime command/response/error validation, exact bytes/scalars/headers/path escaping and no mutation retries. Use only injected transports and ephemeral owned HTTP servers, no PostgreSQL/provider/inventory calls. Run affected contracts, application types, frontend tests, lint/readability and build checks after stable DTO confirmation. Commit only explicitly owned paths; coordinator handles merges and feature PRs.

## Results and transfer

Implemented the shared `client-runtime.ts` extraction while preserving the public legacy facades. The generator now declares every path placeholder, refuses missing/unbounded JSON policies and unsupported representations, and omits only explicitly marked GET browser resources whose sole 200 representation is recognized binary. The isolated generator uses the official TypeScript AST Blob transform; the application compiler and dependencies are unchanged. Runtime JSON request/response/ErrorDto validation, CSRF, deadlines, redirect refusal and injected URL/RequestInit transport remain in the existing middleware.

### Processing client checkpoint

Added `processingClient.read/start/cancel/answer/activity` with the implemented paths and frozen DTOs from c39cdee. Start/answer use 45 seconds; reads, cancellation and Activity use 10 seconds. Activity requires exact attempt identity and current-input/lane flags. No media schema or sibling-only import was introduced.

Verification: contracts **19 passed** (12 legacy, five processing and two generator-policy tests), all application typechecks, generated drift, frontend **18 passed**, frontend/full readability lint, targeted Prettier, Markdown and build passed. The actual ephemeral Node HTTP start test received one exact payload/key and returned a 202 receipt. Compile-only checks require every job/question path identity. Runtime adverse cases reject numeric revisions, exponent quantities, private fields and incomplete Activity, retain typed 409/412 errors and send no mutation retry. Build reports the existing chunk-size warning. Initial test execution was blocked by sandbox tsx IPC socket denial; the authorized local test run passed.

### Media client checkpoint

Added `mediaClient.snapshot/edit/upload` and generated all implemented media paths. Upload supplies raw Blob through the public bodySerializer hook, preserves exact revision and percent-encoded UTF-8 label, and rejects empty/oversized Blob sources and invalid metadata before transport. Downloads and previews remain native resource URLs, with explicit OpenAPI binary representations and no JSON-client runtime policy. Generation waited for the media owner’s frozen rotated-recipe/optional derivation-id and manual-recovery union signal; no DTO was edited by this owner.

Verification: contracts **19 passed** (12 legacy, five media and two generator-policy tests), all application typechecks, generated drift, frontend **15 passed**, frontend lint, owned-client readability, targeted Prettier, Markdown and build passed. The actual ephemeral Node HTTP upload test received one literal six-byte binary payload, exact revision/UTF-8 headers and a JSON receipt. Compile-only checks prove Blob input and required resource IDs and reject text bodies/numeric revisions. Build reports the existing chunk-size warning.

The first typecheck exposed required OpenAPI header parameters passed only as top-level headers; corrected the upload facade and compile fixture to supply typed params.header, then all types passed. Initial test execution was blocked by sandbox tsx IPC socket denial; the authorized local test run passed. Full T05 readability initially reported two spacing errors in the other owner’s active decoder-runner.ts (lines 56/78), reported to that owner; no unrelated file was changed to fix it.

Owned paths are `contracts/scripts/generate.cjs`, the four existing generated artifacts, `contracts/src/client.ts`, `client-policy.ts`, new `client-runtime.ts`, the feature-specific client and tests, `contracts/tests/client-policy-generation.test.ts`, `tooling/openapi-generator/index.cjs`, and this handover. No manifests, DTO modules, backend routes, runtime configuration, UI, credentials or inventory transport were changed. No PostgreSQL, provider or protected-target request was used.

## Coordinator transfer

These are bounded feature-tree checkpoints, not whole-feature clearance or independent review. The coordinator owns feature PRs, actual prerequisite merges, combined client exports/routes and final whole-feature verification. When merging T05 into T06, preserve both feature route blocks/exports; shared runtime/policy/generator transform changes are intentionally identical. Regenerate from the actually merged schema set, then rerun drift/types/contract tests. The generated diff includes previously ungenerated owning feature DTOs; it is not a new schema vocabulary.

