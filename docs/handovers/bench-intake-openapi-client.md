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
