# Typed OpenAPI client uplift

## Prospective plan

The user approved using openapi-typescript and openapi-fetch after reviewing duplicated client/path/request logic. This record precedes implementation and dependency changes. The owner works on an independent branch from actual merged initiative trunk; media, processing, form and readability owners retain their separate changes.

### Scope and ownership

Replace handwritten generic client transport templates with a maintained OpenAPI-typed client while preserving the existing captureClient, manualClient, intakeClient and IntakeRequestError interfaces. Contracts owns the generator, generated artifacts, a focused runtime client policy module if needed, dependency/lock changes, tests and this handover. Runtime schema registration and new media/processing routes remain with the coordinator; no unpublished sibling modules enter this task.

Generate path, request and response types from the existing OpenAPI document. Preserve the generated api.d.ts schema-name exports used by consumers through aliases to generated component schemas. Remove the separate json-schema-to-typescript conversion only if equivalent consumer contracts remain checked. Keep generation deterministic and drift-checkable.

### Policies a library cannot replace

Retain TypeBox/AJV runtime validation, exact string quantities/revisions/IDs, safe error status/code handling, explicit CSRF and payload-bound delivery keys, bounded per-operation deadlines, redirect refusal and injected transport compatibility. No automatic retry is introduced. A failed or uncertain mutation remains visible to its owner.

No inventory effect, SQL/migration, canonical vector, original reference, provider integration or existing domain authority changes are in scope. The real original environment's inventory remains strictly read-only; this task needs no inventory credentials, service or network request to that server.

### Package research and alternatives

Official openapi-typescript documentation supports generating a TypeScript AST from an in-memory OpenAPI object through its Node API and astToString. Official openapi-fetch documentation supports typed paths, native Fetch options, transport injection and middleware. Generated types alone do not validate runtime data.

Registry metadata at research reports openapi-fetch 0.17.0 (MIT, one runtime dependency) and openapi-typescript 7.13.0 (MIT, six generation-time dependencies). The latter declares TypeScript ^5.x, whereas the workspace compiler is 6.0.3. The coordinator selected an isolated private tooling package with declared-compatible TypeScript 5.9.3 for generation; application compilers remain 6.0.3. No broad peer-warning exception is used. The tooling package is a development-only contracts dependency and must not enter the browser runtime graph.

- <https://openapi-ts.dev/node>
- <https://openapi-ts.dev/openapi-fetch/>
- <https://openapi-ts.dev/openapi-fetch/api>
- <https://openapi-ts.dev/openapi-fetch/middleware-auth>

Keeping the current generic fetch wrappers would avoid a dependency but retain separately maintained paths, request/response pairings and client template code. Axios adds transport behavior without deriving the API from the maintained contract. Introducing a new schema framework would duplicate the existing runtime authority and is excluded.

### Implementation sequence

1. Add the isolated tooling workspace package and install exact generation/runtime pins with the existing Node/pnpm toolchain. Prepend both pinned pnpm and Node directories so nested scripts cannot select ambient pnpm.
2. Add complete path parameters to the OpenAPI description and generate paths/component types plus compatible DTO aliases.
3. Implement the existing public client methods through typed OpenAPI calls and one explicit runtime policy boundary. Keep transport injection and safe error behavior stable.
4. Add actual request/response interaction cases and negative type/validation/drift cases; inspect affected consumers before changing signatures.
5. Update owning documentation, run meaningful checks and publish a ready independent PR into interactive-app. A fresh independent reviewer and selected exact-head CI remain coordinator merge gates.

### Verification plan

Verify generated drift, frozen install, contracts/frontend/server typechecks, contracts/server/frontend tests, frontend lint/build and changed-file formatting/Markdown. Test encoded paths, method/body/headers, preserved exact strings, output/ErrorDto validation, malformed responses, transport errors and abort propagation without retries. Use compiler adverse cases for invalid paths, missing parameters and invalid bodies. No PostgreSQL/process tier is required unless implementation changes an unforeseen server behavior boundary.

## Implementation and observed results

Plan recorded before implementation. The coordinator approved narrow ownership of pnpm-workspace.yaml and tooling/openapi-generator for the isolated generator. Dependency installation and implementation follow this checkpoint.


## Implemented boundary

The OpenAPI generator now emits paths, component schemas, existing schema-name aliases and a generated operation-policy map. The old per-schema json-schema-to-typescript conversion and embedded generic fetch templates are removed. Thin compatibility facades call openapi-fetch with inferred route/body/result types; existing imports and URL/RequestInit transport injection remain supported.

Runtime middleware validates the serialized JSON request before transport and validates returned DTOs/errors through existing AJV schemas. It injects CSRF for command methods and applies generated setup/capture/manual deadlines. Safe typed failures preserve IntakeRequestError status/code; setup errors retain their prior generic message. Unexpected transport errors preserve identity, and this layer adds no retry. A JSON body keeps the existing string injection boundary; other transport bytes use ArrayBuffer rather than accidental text decoding.

Input validation before transport is a deliberate tightening of the client boundary; existing server validation and authority remain unchanged. This client is not a replacement for server validation or safe command ownership. Future media upload/download routes need an explicit binary response/request policy extension; this task advertises only existing JSON foundation/capture/manual endpoints.

### Compiler isolation and integration

Strict peer installation resolves TypeScript 5.9.3 only within the private generator workspace. Contracts, frontend and intake-server retain TypeScript 6.0.3. Actual generated declarations compile under all three application consumers. No compiler peer warning is suppressed, and the generator is not imported from runtime source.

The owner checkpoint was preserved before a normal merge of actual React Hook Form trunk e592a80. The lockfile merged without conflict and passed a frozen offline install. Existing source references, canonical vectors and migrations are unchanged. This branch has no unpublished sibling dependency.

### Verification at current implementation

- Full frontend/contracts/server typecheck, frontend ESLint and production build pass.
- The merged frontend's 13 tests and existing server's 41 fast/HTTP tests pass.
- The expanded contracts suite passes 12 tests, including nine new client/transport cases. These exercise encoded paths, exact scalars, pre-send rejection, safe/malformed error responses, approval/recovery paths, explicit deadline/abort propagation, original transport error identity, actual loopback HTTP UTF-8 bytes/CSRF/key/redirect refusal, and non-JSON byte preservation.
- Compile-only adverse cases reject nonexistent routes, missing path parameters, numeric revisions and incomplete bodies; the existing facade result remains assignable to CaptureSnapshot.
- Generated drift, changed-source Prettier, Markdown and diff checks pass. The isolated generator/compiler dependency listing matches the intended versions.
- The normal suite completed: backend 2038 passed, 4 known skips and 43 scanner/TUI exclusions. After the last TypeScript-only transport refinements, affected contracts 12/12, server 41/41 and frontend 13/13 were rerun and passed, together with all application types/lint/build. The unchanged Python suite was not redundantly repeated. No PG/process, browser or real inventory capability is claimed from these client checks.

The production entry is 530.32 kB minified / 162.53 kB gzip at the final qualified build, and Vite reports its standard >500 kB advisory. This is an observed build-size result, not a runtime performance measurement or reason to suppress the warning.


## Acceptance and remaining gates

Observed against owned/injected boundaries: exact generated request/response typing, runtime input/output checks, existing consumer compatibility, safe status/code errors, exact string/UTF-8 transport, stable caller-supplied keys, abort/error propagation, redirect refusal and deterministic generation. The actual HTTP case is a local synthetic endpoint, not an inventory API capability test.

Not tested or changed: protected inventory behavior, provider inference/authentication, new media/processing routes, final identity, PostgreSQL ownership/transactions, physical apply or operational deployment. The client refactor grants none of those capabilities.

Fresh independent review and selected hosted CI remain outstanding before the coordinator may merge. No self-review clearance or human GitHub approval is claimed. The coordinator owns all later merges and cross-owner integration; this owner does not merge the PR or alter other worktrees.

## Independent review correction: generator CI coverage

The fresh reviewer did not clear head 7f12936. Its actual selector probe showed that a change only to tooling/openapi-generator/index.cjs or its package.json selected no checks. The current PR happened to select consumers through other changed files, but future generator-only changes could bypass generation drift, application typechecks and consumer tests. This is a behavioral P2, not a documentation nit.

Before correction, the clean implementation head was preserved and actual merged readability trunk f121095 was incorporated with a normal merge. The coordinator expanded this task's ownership narrowly to .github/scripts/ci_paths.py and its selector regressions. Other owners and worktrees remain untouched.

### Prospective correction plan

Treat non-Markdown inputs under the exact tooling/openapi-generator/ boundary as contract-generation inputs, selecting frontend and intake checks just like contracts source. Keep documentation-only paths Markdown-only and near-match/unrelated tooling paths unselected. Add explicit input regressions and actual Git deletion/rename cases so an old generator path cannot disappear from consumer selection.

Run the selector tests with Python 3.12, Ruff on the changed Python files, frozen install, current readability/formatting checks and affected contract/frontend/server types/tests/drift/build. Correct any mechanical style issues in this task's new runtime sources under the merged maintained rules. Do not rerun PostgreSQL or unchanged full Python suites without a new concern. Push the corrected head to the same ready PR and request exact-head re-review; previous independent native-abort success does not clear this CI finding.

### Correction result

The added regressions failed before the fix in all three generator-input subcases and actual Git deletion/rename cases. After classifying the exact generator boundary as a contract input, all 21 selector tests pass. Code/manifest/config select frontend plus intake; Markdown-only generator documentation selects only Markdown; unrelated and near-match tooling paths remain unselected. The existing intake job explicitly runs generated drift and contract/server typechecks, so this selection reaches the required consumers.

Changed Python Ruff checks and formatting pass. Frozen installation, maintained runtime readability checks, seven readability fixtures, all application typechecks, frontend lint/build, generated drift, contracts 12/12, server 41/41 and frontend 13/13 pass after the actual readability-trunk merge. The new client sources already satisfied the checked rules; public facade entries received blank-line separation for the manual object-function readability gate, with no behavior change. The build output remains 530.32 kB minified / 162.53 kB gzip.

The correction does not change runtime request policy or generated artifacts. No PostgreSQL, provider, inventory or full Python rerun was needed. Re-review of the corrected exact head and fresh selected hosted CI remain outstanding; the rejected head stays historical evidence.
