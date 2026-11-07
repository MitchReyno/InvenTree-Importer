# Package candidates for later phases

This is a researched shortlist for the remaining implementation phases, requested by Mitch during wave 3. These are candidates, not installed dependencies or blanket adoption approval. Each phase owner must assess the exact release, license, dependency cost, declared compatibility and actual behavior before adding a package.

Existing React Hook Form, Drizzle, TypeBox/AJV, DBOS, Sharp and the approved OpenAPI/TanStack Query/Moveable work remain the foundation. A package should remove commodity code while application policy stays explicit.

## Phase shortlist

| Phase | Candidate | Expected simplification | Boundary to retain |
| --- | --- | --- | --- |
| T07 research tools | `@modelcontextprotocol/server` | Maintained tool registration, protocol/lifecycle handling and cancellation for a semantic evidence/inventory-read broker. | Provider protocol compatibility, actor/scope authorization, exact input access and a strict read-only operation allowlist. |
| T07 source fetching | `ipaddr.js` | IPv4/IPv6 parsing, mapped addresses and address-range classification. | DNS pinning/rebinding, redirect policy, byte/time limits and separate protected inventory transport. Address parsing alone is not SSRF protection. |
| T08 navigation | React Router | Declared nested routes, named parameters and guarded SPA navigation as Processing and review views expand. | Preserve existing hash links and pinned IDs, dirty drafts across Back/Forward, and full-page unload protection. Keep TanStack Query responsible for retained reads; avoid adding a second loading/cache model. |
| T08 operator tables | TanStack Table | Sorting, filtering, row selection, column state and bulk-review table mechanics without prescribing presentation. | Stable physical-lot IDs, explicit selected/deferred scope, human drafts and server-side authority. Add virtualization only for demonstrated row-volume needs. |
| T08 rich record pickers | React Aria Components | Combobox/listbox keyboard, focus and selection behavior for asynchronous Part/location/candidate lookup. | Existing styled-components/palette, accessible names, exact observed identities and explicit human selection. Native controls remain suitable for simple fields. |
| T10 live updates | `@fastify/sse` | SSE framing, heartbeats, lifecycle and backpressure. | Commit-ordered retained events, consistent snapshot cursor, bounded replay, expired-history resets, revocation and polling fallback. |
| T10 operations | Existing Fastify/Pino plus `@fastify/under-pressure` | Structured redacted logs and event-loop/memory/readiness monitoring without custom logging/monitor loops. | Explicit sensitive-field redaction, domain health checks and real process/container resource enforcement. A pressure threshold is not hard memory isolation. |
| T11 sessions/identity | `@fastify/session`; `openid-client` only for a qualified OAuth/OIDC route | Server-side session lifecycle and supported standard identity exchanges. | An actual supported InvenTree protocol, server-side credential references, permission discovery/requalification and no fallback after delegated denial. Do not use the default in-memory session store for deployment. |
| T12 browser/accessibility | Playwright Test and `@axe-core/playwright` | Repeatable browser interaction, responsive and automated accessibility regressions. | Browser-harness visual/native checks, manual keyboard assessment, original design references and isolated owned fixtures. Automated scans do not establish full accessibility. |
| T12 edge cases | `fast-check` | Generated cases with reproducible shrinking for exact scalar parsing, crop geometry and domain invariants. | Independent expected properties and literal vectors; real PostgreSQL/process/HTTP fault proof still remains required. |

## Adoption priority

TanStack Table and React Aria offer the clearest next-phase UI simplification. React Router deserves a bounded migration assessment because current navigation repeatedly splits hash strings and updates browser history directly. Its SPA blocker does not handle full document unloads; retain that separate protection and qualify lost-ACK drafts, explicit discard, deep links and browser history before replacing the existing guard.

Virtualization stays conditional on measured row volume. For T09, reuse the existing execution stack rather than adding a workflow package.

## Native-provider integration

Mitch subsequently prohibited actual-model testing or provider-usage consumption while he is away. Use stubs for integration tests until explicit later authorization; no SDK or native route may be exercised with real models merely to assess a package.

Official OpenAI documentation distinguishes the Codex SDK's automation interface from App Server's richer authentication, approvals, history and streamed-event integration. T07 should choose the route that meets the actual product requirements and supported host/authentication boundary. Do not select an SDK merely because it shortens a subprocess wrapper, or substitute paid APIs for an unsupported native route.

Use version-matched generated App Server types/schemas when that route is selected. MCP tools and application questions are different interfaces; native permission handles remain transient and cannot be recovered as application authority. No provider login, credential copy or inference was performed for this shortlist.

## Reuse rather than add

T09 should extend the existing Drizzle/DBOS/executor boundaries. A second workflow engine, in-memory job queue, generic mutation-retry package or state machine must not become another source of truth for journal certainty and selected recovery.

Use existing Node cryptography and qualified byte/canonical helpers rather than replacing them for cosmetic consistency. Backup/restore coherence remains an application protocol even if a later owner selects an archive/stream package. Avoid adding packages for tiny helpers without a concrete maintenance benefit.

## Primary sources

- [MCP server SDK](https://github.com/modelcontextprotocol/typescript-sdk/tree/main/packages/server).
- [IP address parsing](https://github.com/whitequark/ipaddr.js).
- [React Router hash routing](https://reactrouter.com/api/data-routers/createHashRouter) and [navigation blocking](https://reactrouter.com/api/hooks/useBlocker).
- [TanStack Table](https://tanstack.com/table/latest/docs/overview).
- [React Aria ComboBox](https://react-aria.adobe.com/ComboBox).
- [Fastify SSE](https://github.com/fastify/sse).
- [Fastify logging](https://fastify.dev/docs/latest/Reference/Logging/).
- [Fastify under-pressure compatibility and API](https://github.com/fastify/under-pressure).
- [Fastify sessions and store limitations](https://github.com/fastify/session).
- [OpenID client](https://github.com/panva/openid-client).
- [Playwright](https://playwright.dev/docs/intro) and [accessibility testing](https://playwright.dev/docs/accessibility-testing).
- [fast-check](https://github.com/dubzzz/fast-check).
- [Official Codex App Server](https://learn.chatgpt.com/docs/app-server) and [Codex SDK](https://learn.chatgpt.com/docs/codex-sdk).

These sources were read during the shortlist assessment. Current documentation is not proof of compatibility with an installed release; recheck and qualify when the owning phase starts.
